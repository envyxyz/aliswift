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

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  function say(text, tone = "") {
    ui.say.textContent = text;
    ui.say.dataset.tone = tone;
  }

  // What an import's answer means to the seller.
  function outcome(res, read) {
    if (!res.success) {
      if (res.code === "signin") return { tone: "error", text: "Sign in to Google in AliSwift's popup to add orders to your sheet." };
      return { tone: "error", text: res.error ?? "Couldn't add the orders." };
    }
    const range = resultsRange(document.body.innerText);
    const parts = [res.added ? `Added ${plural(res.added, "order")} to your sheet.` : "Nothing new to add."];
    if (res.skipped) parts.push(`${plural(res.skipped, "order")} already there.`);
    if (res.rejected) parts.push(`${plural(res.rejected, "item")} skipped: no custom label (SKU) on eBay.`);
    if (res.unknown) parts.push(`${plural(res.unknown, "item")} ${res.unknown === 1 ? "has" : "have"} a SKU the sheet does not know, so the cost is blank.`);
    if (read.ai) parts.push("Read with AI, because the page's wording changed.");
    if (range && range.to < range.of) parts.push(`This page shows ${range.from}-${range.to} of ${range.of}: go to the next page and press the button again.`);
    return { tone: res.added || !res.rejected ? "ok" : "warn", text: parts.join(" ") };
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
      say(`Adding ${plural(read.orders.length, "order")}...`);
      result = outcome(await send({ action: "importOrders", orders: read.orders }), read);
    }
    say(result.text, result.tone);
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

  function mount() {
    ui = {
      say: h("p", { class: "ali-summary", role: "status" }),
      go: h("button", { type: "button", class: "btn btn-sm", id: "ali-orders-go" }),
    };
    ui.go.addEventListener("click", (e) => e.isTrusted && press());
    const panel = h(
      "section",
      { class: "ali ali-orders", role: "complementary", "aria-label": "AliSwift orders" },
      h("header", { class: "ali-head" }, icon(PATH.bolt, "bolt"), h("div", { class: "ali-title" }, h("strong", { text: "AliSwift" }), h("span", { class: "ali-prod", text: "Orders to your sheet" }))),
      h("div", { class: "ali-body" }, ui.say),
      h("footer", { class: "ali-foot" }, h("div", { class: "actions" }, h("button", { type: "button", class: "btn btn-quiet btn-sm", text: "Hide", onclick: () => ui.host.remove() }), ui.go)),
    );
    ui.host = mountPanel("aliswift-orders", panel);
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
    if (auto) importNow();
  }

  refresh();
  setInterval(() => {
    if (ui && !onList()) ui.host.hidden = true; // another page of Seller Hub: out of the way
    else if (location.href !== shownFor) refresh();
  }, 1500);
})();
