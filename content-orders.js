// The AliSwift button on eBay Seller Hub's order list (/sh/ord). It reads the orders on the page from their text
// (lib/orders.js) and adds the ones the sheet's Orders tab does not have yet, in one go. Idle on every other page.
// It reads the list only from All orders, so no order is missed, and an order already in the tab is never added twice,
// so pressing it again (or on the next page of results) adds only what is new. It changes nothing on eBay.
// Needs lib/panel.js and lib/orders.js (loaded first by the manifest).

(() => {
  const GO_KEY = "aliswift-orders-go"; // set while the button takes the seller to All orders, so the import runs when it opens
  const ORDER_ONLY = /^\s*(\d{2}-\d{5}-\d{5})\s*$/;
  const ORDER_ALL = /(?<!\d)\d{2}-\d{5}-\d{5}(?!\d)/g; // see ORDER_NO in lib/orders.js
  let ui = null;
  let busy = false;
  let collapsed = true;

  const send = (message) => chrome.runtime.sendMessage(message).catch((error) => ({ success: false, error: error.message }));
  const onList = () => /^\/sh\/ord\/?$/.test(location.pathname);

  // The text pieces of a row, in page order: every visible text node, trimmed. Scripts, styles and hidden things stay out.
  function tokensOf(el) {
    const out = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest("script,style,noscript,[hidden],[aria-hidden='true']") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.textContent.replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
    return out;
  }

  // The order rows on the page: for each order number shown on its own, the largest block around it that holds that one
  // order number only (and not more than a screenful of text, so a list of one order does not take the whole page).
  function rowsOnPage() {
    // Every text node that holds an order number, read one node at a time: the text of neighbouring elements can touch
    // ("Oct 1412-34567-89012"), so the numbers are never looked for in a whole block's text.
    const found = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const nos = n.textContent.match(ORDER_ALL);
      if (nos && n.parentElement && !n.parentElement.closest("script,style")) found.push({ node: n, nos });
    }
    const numbersIn = (el) => new Set(found.filter((f) => el.contains(f.node)).flatMap((f) => f.nos));
    const rows = new Map();
    for (const { node, nos } of found) {
      const no = ORDER_ONLY.exec(node.textContent)?.[1];
      if (!no || rows.has(no)) continue;
      let row = node.parentElement;
      while (row.parentElement && !["MAIN", "FORM", "TABLE", "BODY"].includes(row.parentElement.tagName)) {
        const up = row.parentElement;
        if (numbersIn(up).size > 1 || up.textContent.length > 6000) break;
        row = up;
      }
      rows.set(no, tokensOf(row));
    }
    return [...rows.values()];
  }

  // What the page lists, read two ways: by its text, and, only when that finds no item anywhere (the page's wording
  // changed), by asking the AI which piece of each row is which. The AI is shown the rows with every name and address hidden.
  async function readOrders() {
    const rows = rowsOnPage();
    const orders = rows.map((r) => parseOrder(r)).filter(Boolean);
    if (!orders.length || orders.some((o) => o.items.length)) return { orders, ai: false };
    const some = rows.slice(0, 30);
    const res = await send({ action: "aiMap", task: "orders", items: some.map(maskTokens) });
    if (!res.success) return { orders, ai: false, aiError: res };
    return { orders: some.map((r, i) => applyPositions(r, res.answer[i])).filter(Boolean), ai: true };
  }

  // Seller Hub's own status word and tracking number for an order, from its row (tr#orderid_<number>__order-info): the bold
  // word in the status cell, and the first button of the tracking block. Either is "" when the row doesn't show it.
  function rowInfo(orderNumber) {
    const row = document.getElementById(`orderid_${orderNumber}__order-info`);
    const clean = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    // The sell price is eBay's: the first plain amount in the row (its price column), 0 or none when the row shows no price.
    const amount = tokensOf(row ?? document.createElement("tr")).map((t) => /^[^\d\s]{0,3}\s?(\d{1,3}(?:,\d{3})*|\d+)\.\d{2}$/.exec(t)?.[0]).find(Boolean);
    const sell = amount ? Number(amount.replace(/[^\d.]/g, "")) : 0;
    return { status: clean(row?.querySelector(".order-status .sh-bold")), tracking: clean(row?.querySelector(".tracking-info button")), ...(sell > 0 && { sell }) };
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  // Populates the sheet picker from storage, hides it when there is only one sheet.
  async function loadSheets() {
    if (!ui?.sheet) return;
    const { sheets, activeSheetId } = await chrome.storage.sync.get({ sheets: [], activeSheetId: "" });
    ui.sheet.replaceChildren(...sheets.map((s) => {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.name;
      o.selected = s.id === (activeSheetId || sheets[0]?.id);
      return o;
    }));
    ui.sheet.hidden = sheets.length <= 1;
  }

  function say(text, tone = "") {
    ui.say.textContent = text;
    ui.say.dataset.tone = tone;
    ui.skus.hidden = true; // a new message clears the SKU list; the import's own message fills it again
  }

  // What an import's answer means to the seller.
  function outcome(res, read) {
    if (!res.success) {
      if (res.code === "signin") return { tone: "error", text: "Sign in to Google in AliSwift's popup to add orders to your sheet." };
      return { tone: "error", text: res.error ?? "Couldn't add the orders." };
    }
    const range = resultsRange(document.body.innerText);
    const parts = [res.added ? `Added ${plural(res.added, "order")} to your sheet.` : "Nothing new to add."];
    if (res.skipped) parts.push(`${plural(res.skipped, "order")} already there${res.updated ? `, ${plural(res.updated, "cell")} updated with eBay's status or tracking` : ""}.`);
    if (res.rejected) parts.push(`${plural(res.rejected, "item")} skipped: no custom label (SKU) on eBay.`);
    if (read.ai) parts.push("Read with AI, because the page's wording changed.");
    if (range && range.to < range.of) parts.push(`This page shows ${range.from}-${range.to} of ${range.of}: go to the next page and press the button again.`);
    const skus = res.unknownSkus ?? [];
    if (skus.length) parts.push("The sheet does not know the following SKUs from this page, so their cost is blank:");
    else if (res.unknown) parts.push(`${plural(res.unknown, "item")} ${res.unknown === 1 ? "has" : "have"} a SKU the sheet does not know, so the cost is blank.`);
    return { tone: res.added || !res.rejected ? "ok" : "warn", text: parts.join(" "), skus };
  }

  // Brings the first place on the page that shows this SKU into view, and marks it for a moment.
  function showSku(sku) {
    const want = sku.toLowerCase();
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest("script,style,noscript") || n.parentElement?.closest("[data-aliswift-host], #aliswift-orders") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent.toLowerCase().includes(want)) continue;
      const el = n.parentElement;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      const was = el.style.outline;
      el.style.outline = "3px solid #e43d12";
      setTimeout(() => (el.style.outline = was), 2000);
      return;
    }
  }

  // The unknown SKUs under the message, each a button that shows its item on the page.
  function listSkus(skus) {
    ui.skus.replaceChildren(...skus.map((sku) => h("li", {}, h("button", { type: "button", class: "btn btn-quiet btn-sm", text: sku, onclick: (e) => e.isTrusted && showSku(sku) }))));
    ui.skus.hidden = !skus.length;
  }

  async function importNow() {
    if (busy) return;
    busy = true;
    ui.go.setAttribute("aria-disabled", "true");
    ui.go.dataset.state = "loading";
    say("Reading the orders on this page...");
    const read = await readOrders();
    let result;
    if (!read.orders.length) {
      result = { tone: "warn", text: read.aiError?.code === "nokey" ? "Couldn't read this page's orders. Add a Gemini key in AliSwift settings (AI tab) so AI can help, or send the report." : "No orders found on this page." };
    } else {
      for (const o of read.orders) Object.assign(o, rowInfo(o.orderNumber));
      say(`Adding ${plural(read.orders.length, "order")}...`);
      result = outcome(await send({ action: "importOrders", orders: read.orders }), read);
    }
    say(result.text, result.tone);
    listSkus(result.skus ?? []);
    delete ui.go.dataset.state;
    ui.go.removeAttribute("aria-disabled");
    ui.go.textContent = "Add orders again";
    busy = false;
  }

  // The button: on All orders it adds; anywhere else it takes the seller to All orders, and adds when that page opens.
  function press() {
    if (busy) return;
    if (onAllOrders(location.href)) return importNow();
    try {
      sessionStorage.setItem(GO_KEY, "1");
    } catch {
      // storage blocked: the seller presses the button again on All orders
    }
    location.assign(ALL_ORDERS);
  }

  // The panel is a round AliSwift button that opens into a card (lib CSS: .ao in ebay.css). One animation does it: the box grows
  // from the button's size to the card's, the bolt travels from the middle of the button to the card's top-left corner, and
  // the text fades in once there is room for it. Closing runs it backwards from wherever it is. The card's content has a fixed
  // width, so nothing re-wraps while the box grows.
  const BUTTON = 48;
  const BOLT = { shut: { left: "23px", top: "23px" }, open: { left: "30px", top: "28px" } }; // the bolt's centre in the box
  const SLOW = { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };

  function setCollapsed(on, animate = true) {
    collapsed = on;
    const p = ui?.panel;
    if (!p) return;
    // A closed panel is one button: reachable by keyboard, and named for what it does.
    p.setAttribute("role", on ? "button" : "complementary");
    p.setAttribute("aria-label", on ? "Open AliSwift orders panel" : "AliSwift orders");
    if (on) p.setAttribute("tabindex", "0");
    else p.removeAttribute("tabindex");

    if (!animate || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      p.toggleAttribute("data-open", !on);
      return;
    }
    for (const a of ui.anim ?? []) a.cancel();
    const fades = [...p.querySelectorAll(".ao-head, .ao-close, .ao-main, .ao-foot")];
    const size = (w, h, r) => ({ width: `${w}px`, height: `${h}px`, borderRadius: `${r}px` });
    if (!on) {
      p.setAttribute("data-open", "");
      const [w, h] = [p.offsetWidth, p.offsetHeight]; // the card as it will stay
      ui.anim = [
        p.animate([size(BUTTON, BUTTON, BUTTON / 2), size(w, h, 16)], SLOW),
        ui.bolt.animate([BOLT.shut, BOLT.open], SLOW),
        ...fades.map((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: 140, easing: "ease-out", fill: "backwards" })),
      ];
      return;
    }
    const [w, h] = [p.offsetWidth, p.offsetHeight];
    const shut = { ...SLOW, duration: 320, fill: "forwards" };
    ui.anim = [
      p.animate([size(w, h, 16), size(BUTTON, BUTTON, BUTTON / 2)], shut),
      ui.bolt.animate([BOLT.open, BOLT.shut], shut),
      ...fades.map((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: "ease-in", fill: "forwards" })),
    ];
    ui.anim[0].finished
      .then(() => {
        p.removeAttribute("data-open");
        for (const a of ui.anim) a.cancel();
      })
      .catch(() => {}); // cancelled: it was opened again before it finished closing
  }

  function mount() {
    const toggle = h(
      "button",
      {
        type: "button",
        class: "ao-close",
        id: "ali-orders-toggle",
        "aria-label": "Close AliSwift panel",
        onclick: (e) => {
          e.stopPropagation();
          setCollapsed(true, true);
        },
      },
      icon(PATH.close, "", 18),
    );
    ui = {
      toggle,
      bolt: icon(PATH.bolt, "ao-bolt", 20),
      say: h("p", { class: "ao-text", role: "status" }),
      go: h("button", { type: "button", class: "btn", id: "ali-orders-go" }),
      skus: h("ul", { class: "ao-skus", role: "list", hidden: true }),
      sheet: h("select", { class: "ao-sheet", id: "ali-orders-sheet", hidden: true }),
    };
    ui.sheet.addEventListener("change", () => chrome.storage.sync.set({ activeSheetId: ui.sheet.value }));
    ui.go.addEventListener("click", (e) => e.isTrusted && press());
    const panel = h(
      "section",
      { class: "ao", role: "button", "aria-label": "Open AliSwift orders panel" },
      ui.bolt,
      h(
        "div",
        { class: "ao-card" },
        h("header", { class: "ao-head" }, h("strong", { text: "AliSwift" }), h("span", { text: "Orders to your sheet" }), ui.sheet),
        toggle,
        h("div", { class: "ao-main" }, ui.say, ui.skus),
        h("footer", { class: "ao-foot" }, ui.go),
      ),
    );
    ui.panel = panel;
    panel.addEventListener("click", () => {
      if (collapsed) setCollapsed(false, true);
    });
    panel.addEventListener("keydown", (e) => {
      if (collapsed && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        setCollapsed(false, true);
      }
    });
    ui.host = mountPanel("aliswift-orders", panel);
    setCollapsed(true, false);

    document.addEventListener("click", (e) => {
      if (!collapsed && ui?.host && !e.composedPath().includes(ui.host)) {
        setCollapsed(true, true);
      }
    });
  }

  // The first of fn()'s answers that is truthy, tried every 300 ms for up to `ms`; null when none comes.
  async function until(fn, ms) {
    for (const end = Date.now() + ms; ; await new Promise((resolve) => setTimeout(resolve, 300))) {
      const v = fn();
      if (v || Date.now() > end) return v || null;
    }
  }

  // The panel says what the page in front of it needs. Run again whenever the address changes (Seller Hub is a
  // single-page app: its list can open, and change filter, without a page load).
  let shownFor = "";
  async function refresh() {
    if (busy || !onList()) return;
    shownFor = location.href;
    if (!ui) mount();
    ui.host.hidden = false;
    loadSheets();
    if (!onAllOrders(location.href)) {
      say("This list shows only some orders. AliSwift adds from All orders, so none is missed.");
      ui.go.textContent = "Open All orders and add";
      return;
    }
    ui.go.textContent = "Add all orders to sheet";
    let auto = false;
    try {
      auto = sessionStorage.getItem(GO_KEY) === "1";
      sessionStorage.removeItem(GO_KEY);
    } catch {
      // storage blocked: the seller presses the button
    }
    say("Reading the orders on this page...");
    const rows = await until(() => (rowsOnPage().length ? rowsOnPage() : null), 15000);
    if (shownFor !== location.href) return; // the seller moved on while the list loaded
    if (!rows) return say("No orders found on this page yet. Press the button when the list has loaded.");
    say(`${plural(rows.length, "order")} on this page.`);
    if (auto) {
      setCollapsed(false, true);
      importNow();
    }
  }

  refresh();
  setInterval(() => {
    if (ui && !onList()) ui.host.hidden = true; // another page of Seller Hub: out of the way
    else if (location.href !== shownFor) refresh();
  }, 1500);
})();
