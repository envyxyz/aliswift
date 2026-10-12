// The AliSwift panel on eBay's listing form (/lstng). It shows the products that have a listing, fills the title, custom
// label, description and price from the one the seller picks, then the item specifics through Gemini (the worker does the
// asking), and shows everything it could not fill as a row to copy. Idle on every other eBay page. It never presses
// List it, Save for later or Preview, and never touches Condition. Needs lib/panel.js and lib/ebayform.js (loaded first
// by the manifest). The names of eBay's boxes come from a saved copy of its form (test/fixtures/ebay-form-basics.html).

(() => {
  // Row status -> [word, tag tone, icon]
  const STATUS = {
    pending: ["Pending", "", "ring"],
    filling: ["Filling", "", "spin"],
    filled: ["Filled", "green", "check"],
    needs: ["Needs you", "amber", "warn"],
    copy: ["Copy manually", "blue", "copy"],
  };
  const COLLAPSED_KEY = "aliswift-collapsed";
  const wide = matchMedia("(min-width:1180px)");
  const q = (selector) => document.querySelector(selector);

  let ctx = null; // the worker's answer to ebayContext: { target, listing }
  let ui = null; // the panel's elements, once it is on the page
  let phase = "idle"; // idle, reading, asking, filling or done
  let notice = null; // { tone, text, retry?, settings? }
  let asking = 0; // fields sent to the AI in this pass
  let dismissed = false;
  let collapsed = false;
  let timer;
  let resizer;
  let products = []; // the cards the worker offers: { sheetId, key, sku, title, price, currency }
  let current = null; // { sheetId, key } of the card in use
  let ai = null; // the AI's reading of this form, asked at most once per Fill press: { list, pick } or {}
  const found = {}; // intent -> "page" | "ai" | "missing", for the report
  const rows = new Map(); // id -> { id, label, value, status, field?, hint? }
  const saved = {}; // the page's own padding, put back on Done

  const send = (message) => chrome.runtime.sendMessage(message).catch((error) => ({ success: false, error: error.message }));

  /* State */

  const ready = () => Boolean(ctx?.target && ctx.listing);
  const running = () => ["reading", "asking", "filling"].includes(phase);
  const counts = () => {
    const c = { filled: 0, copy: 0, needs: 0 };
    for (const r of rows.values()) if (r.status in c) c[r.status]++;
    return c;
  };
  const row = (id, label, value, status, extra = {}) => rows.set(id, { id, label, value, status, ...extra });

  function summary() {
    if (!ctx?.success) return "AliSwift didn't answer. Reload this page.";
    if (!ctx.target) return products.length ? "Choose the product to list." : "No product has a listing yet.";
    if (!ctx.listing) return "That product has no saved listing. Pick another, or create one on the dashboard.";
    if (phase === "reading") return "Reading the form...";
    if (phase === "asking") return `Asking AI to match ${asking} fields...`;
    if (phase === "filling") return "Filling the form...";
    if (phase === "done") {
      const { filled: f, copy: c, needs: n } = counts();
      const need = n ? `, ${n} need you` : "";
      return !f ? `Nothing filled, ${c} to copy${need}.` : !c && !n ? `All ${f} fields filled.` : `${f} filled, ${c} to copy${need}`;
    }
    return "Pick your category on eBay, then press Fill form.";
  }

  // A product picked for another marketplace than the one this form is on: its price is never typed in.
  const otherSite = () => ready() && location.hostname !== ctx.target.host;

  /* The product cards */

  const money = (card) => {
    if (card.price == null) return "";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: card.currency }).format(card.price);
    } catch {
      return `${card.currency} ${card.price.toFixed(2)}`.trim();
    }
  };

  const isCurrent = (card) => current?.sheetId === card.sheetId && current?.key === card.key;

  function cardEl(card) {
    const price = money(card);
    return h(
      "li",
      {},
      h(
        "button",
        { type: "button", class: "ali-card", "aria-pressed": String(isCurrent(card)), onclick: () => choose(card) },
        h("span", { class: "ali-card-top" }, h("strong", { text: card.sku }), price && h("span", { class: "tag", text: price })),
        h("span", { class: "ali-card-title", text: card.title }),
      ),
    );
  }

  function renderCards() {
    const words = ui.search.value.trim().toLowerCase();
    const shown = products.filter((c) => !words || `${c.sku} ${c.title}`.toLowerCase().includes(words));
    ui.search.hidden = products.length < 6;
    ui.cards.replaceChildren(...shown.map(cardEl));
    ui.pickNote.textContent = !products.length
      ? "Press Create Listing on an AliExpress product page, or create a listing on the dashboard."
      : !shown.length ? "Nothing matches." : "";
  }

  async function loadProducts() {
    const res = await send({ action: "ebayProducts" });
    products = res.success ? res.products : [];
    current = res.success ? res.current : null;
    if (ui) render();
  }

  // The seller clicked a card: the worker makes it the product, and the panel starts over with it.
  async function choose(card) {
    if (running()) return;
    const res = await send({ action: "ebaySelect", sheetId: card.sheetId, key: card.key });
    if (!res.success) {
      notice = { tone: "error", text: res.error ?? "Couldn't pick that product." };
      return render();
    }
    current = { sheetId: card.sheetId, key: card.key };
    ctx = await send({ action: "ebayContext" });
    rows.clear();
    if (ready()) idleRows();
    phase = "idle";
    notice = null;
    ui.pickOpen = false;
    render();
  }

  /* Rows and the panel */

  const go = (field) => {
    field.scrollIntoView({ block: "center" });
    field.focus();
  };

  async function copyValue(btn, r) {
    if (await copyToClipboard(r.value)) {
      btn.dataset.copied = "";
      setTimeout(() => delete btn.dataset.copied, 1500);
    } else {
      btn.closest(".copy-row").querySelector(".copy-meta").textContent = "Press Ctrl+C";
      setTimeout(render, 2000);
    }
  }

  function rowEl(r) {
    const [word, tone, glyph] = STATUS[r.status];
    const acts = h("span", { class: "ali-acts" });
    if (r.value && r.status === "copy") {
      const btn = h("button", { type: "button", class: "icon-btn", "aria-label": `Copy ${r.label}` }, icon(PATH.copy, "i-copy"), icon(PATH.check, "i-check"));
      btn.addEventListener("click", () => copyValue(btn, r));
      acts.append(btn);
    }
    if (r.field && (r.status === "needs" || r.status === "copy")) {
      acts.append(h("button", { type: "button", class: "icon-btn", "aria-label": `Go to ${r.label} on the form`, onclick: () => go(r.field) }, icon(PATH.go)));
    }
    return h(
      "li",
      { class: "copy-row" },
      h("span", { class: "copy-label", text: r.label }),
      h("span", { class: "tag copy-meta", ...(tone && { "data-tone": tone }) }, icon(PATH[glyph], r.status === "filling" && "spin", 12), word),
      acts,
      h("div", { class: "copy-value", text: r.value || "–" }),
      r.hint && h("p", { class: "ali-hint", text: r.hint }),
    );
  }

  function render() {
    if (!ui) return;
    const { target } = ctx ?? {};
    ui.prod.textContent = ready() ? `${target.sku ? `${target.sku} · ` : ""}${target.title}` : "No product chosen";
    const text = summary();
    ui.say.textContent = ui.mini.textContent = text;
    ui.spin.toggleAttribute("hidden", !running());
    ui.panel.dataset.phase = phase;

    // The product: the card in use, and the list to change it (open while none is chosen).
    const open = ui.pickOpen || !ready();
    ui.pickList.hidden = !open;
    ui.pickBtn.setAttribute("aria-expanded", String(open));
    ui.pickBtn.replaceChildren(h("span", { class: "ali-pick-now", text: ready() ? `${target.sku ? `${target.sku} · ` : ""}${target.title}` : "Choose a product" }), icon(PATH.more));
    renderCards();

    const all = [...rows.values()];
    ui.list.replaceChildren(...["needs", "copy", "pending", "filling"].flatMap((s) => all.filter((r) => r.status === s)).map(rowEl));
    const done = all.filter((r) => r.status === "filled");
    ui.filled.hidden = !done.length;
    ui.filledCount.textContent = done.length;
    ui.filledList.replaceChildren(...done.map(rowEl));

    const shown = notice ?? (otherSite() && phase !== "done" ? { tone: "warn", text: `This product is for ${ctx.target.host}. You are on ${location.hostname}, so its price is not typed in.` } : null);
    ui.notice.hidden = !shown;
    ui.notice.replaceChildren();
    if (shown) {
      ui.notice.dataset.tone = shown.tone;
      ui.notice.append(icon(shown.tone === "error" ? PATH.error : PATH.warn, "", 16), h("div", { text: shown.text }));
      if (shown.settings) ui.notice.append(h("button", { type: "button", class: "btn btn-quiet btn-sm", text: "Open settings", onclick: () => send({ action: "openPage", page: "settings" }) }));
    }

    const busy = running();
    ui.fill.textContent = !ready() ? (products.length ? "Choose a product" : "Open dashboard") : busy ? "Filling..." : notice?.retry ? "Try again" : phase === "done" && !notice?.settings ? "Fill again" : "Fill form";
    ui.fill.setAttribute("aria-disabled", String(busy || (!ready() && products.length > 0)));
    if (busy) ui.fill.dataset.state = "loading";
    else delete ui.fill.dataset.state;
  }

  // Room for the panel so it never covers the form: padding on <html>, the only change made to eBay's layout.
  function reserve() {
    const s = document.documentElement.style;
    s.paddingRight = wide.matches && !collapsed ? "352px" : saved.right;
    s.paddingBottom = wide.matches ? saved.bottom : `${collapsed ? 64 : ui.panel.offsetHeight + 32}px`;
  }

  function setCollapsed(on) {
    collapsed = on;
    ui.panel.toggleAttribute("data-collapsed", on);
    ui.collapsible.inert = on;
    ui.toggle.setAttribute("aria-expanded", String(!on));
    ui.toggle.setAttribute("aria-label", `${on ? "Expand" : "Collapse"} AliSwift panel`);
    reserve();
  }

  function mount() {
    const toggle = h("button", { type: "button", class: "icon-btn", id: "ali-toggle", "aria-controls": "ali-panel", "aria-expanded": "true", "aria-label": "Collapse AliSwift panel" }, icon(PATH.more));
    ui = {
      toggle,
      pickOpen: false,
      say: h("span"),
      prod: h("span", { class: "ali-prod" }),
      mini: h("span", { class: "ali-mini" }),
      spin: icon(PATH.spin, "spin", 14),
      notice: h("div", { class: "notice", role: "alert", hidden: true }),
      pickBtn: h("button", { type: "button", class: "ali-pick-btn", "aria-controls": "ali-pick-list" }),
      search: h("input", { type: "search", class: "textbox__control ali-search", placeholder: "Search SKU or name", "aria-label": "Search products", hidden: true }),
      cards: h("ul", { class: "ali-cards", role: "list" }),
      pickNote: h("p", { class: "ali-hint" }),
      list: h("ul", { class: "ali-rows", role: "list" }),
      filledCount: h("span", { class: "muted" }),
      filledList: h("ul", { class: "ali-rows", role: "list" }),
      fill: h("button", { type: "button", class: "btn btn-sm", id: "ali-fill" }),
      report: h("button", { type: "button", class: "btn btn-quiet btn-sm", id: "ali-report", text: "Copy report", title: "Copies the form's boxes and what happened, to send with a bug report" }),
    };
    ui.pickList = h("div", { class: "ali-pick-list", id: "ali-pick-list" }, ui.search, ui.cards, ui.pickNote);
    ui.filled = h("details", { class: "disclosure ali-filled", hidden: true }, h("summary", {}, "Filled ", ui.filledCount), ui.filledList);
    ui.collapsible = h(
      "div",
      { class: "ali-collapsible", id: "ali-panel" },
      h(
        "div",
        { class: "ali-inner" },
        h(
          "div",
          { class: "ali-body" },
          h("section", { class: "ali-pick", "aria-label": "Product" }, ui.pickBtn, ui.pickList),
          h("p", { class: "ali-summary", role: "status" }, ui.spin, ui.say),
          ui.notice,
          ui.list,
          ui.filled,
        ),
        h(
          "footer",
          { class: "ali-foot" },
          h("div", { class: "actions" }, ui.report, h("button", { type: "button", class: "btn btn-quiet btn-sm", id: "ali-done", text: "Done", onclick: finish }), ui.fill),
        ),
      ),
    );
    ui.panel = h(
      "section",
      { class: "ali", role: "complementary", "aria-label": "AliSwift" },
      h("header", { class: "ali-head" }, icon(PATH.bolt, "bolt"), h("div", { class: "ali-title" }, h("strong", { text: "AliSwift" }), ui.prod, ui.mini), toggle),
      ui.collapsible,
    );
    ui.host = mountPanel("aliswift-host", ui.panel);
    ui.fill.addEventListener("click", () => {
      if (!ready()) {
        if (!products.length) send({ action: "openPage", page: "dashboard" });
      } else if (!running()) fillForm();
    });
    ui.pickBtn.addEventListener("click", () => {
      ui.pickOpen = !ui.pickOpen;
      if (ui.pickOpen) loadProducts();
      render();
    });
    ui.search.addEventListener("input", renderCards);
    ui.report.addEventListener("click", async () => {
      const ok = await copyToClipboard(report());
      ui.report.textContent = ok ? "Copied" : "Press Ctrl+C";
      setTimeout(() => (ui.report.textContent = "Copy report"), 1800);
    });
    toggle.addEventListener("click", () => {
      setCollapsed(!collapsed);
      try {
        sessionStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
      } catch {
        // storage can be blocked: the choice just isn't remembered
      }
    });

    Object.assign(saved, { right: document.documentElement.style.paddingRight, bottom: document.documentElement.style.paddingBottom });
    let stored = null;
    try {
      stored = sessionStorage.getItem(COLLAPSED_KEY);
    } catch {
      // see above
    }
    setCollapsed(stored === null ? !wide.matches : stored === "1");
    wide.addEventListener("change", reserve);
    resizer = new ResizeObserver(reserve);
    resizer.observe(ui.panel);
    if (ready()) idleRows();
    render();
    loadProducts();
  }

  // The fields the panel fills itself, shown as Pending before anything is pressed.
  function idleRows() {
    const { target: t, listing: l } = ctx;
    row("title", "Title", l.title, "pending");
    if (t.sku) row("sku", "Custom label", t.sku, "pending");
    row("description", "Description", l.description, "pending");
    row("price", `Price (${t.currency})`, t.price, "pending");
    if (ctx.photos?.count) row("photos", "Photos", photoWords(ctx.photos.count), "pending");
  }

  function finish() {
    dismissed = true;
    clearInterval(timer);
    resizer.disconnect();
    wide.removeEventListener("change", reserve);
    Object.assign(document.documentElement.style, { paddingRight: saved.right, paddingBottom: saved.bottom });
    ui.host.remove();
    ui = null;
    send({ action: "ebayDone" });
  }

  // What to send with a bug report: this form's boxes (names and words, never what is typed in them) and what the pass did.
  function report() {
    return JSON.stringify(
      {
        report: "AliSwift form report",
        page: `${location.hostname}${location.pathname}`,
        target: ctx?.target ? { host: ctx.target.host, currency: ctx.target.currency } : null,
        photos: ctx?.photos ? { on: ctx.photos.on, count: ctx.photos.count } : null,
        found,
        rows: [...rows.values()].map((r) => [r.id, r.status]),
        controls: listControls(document).map(({ el, ...c }) => c),
      },
      null,
      1,
    );
  }

  /* Filling */

  const plain = (html) => clean(new DOMParser().parseFromString(html, "text/html").body.textContent);
  const squash = (s) => String(s ?? "").replace(/\s+/g, "");

  // The AI's reading of this form, asked once per pass and only when a box was not found the usual ways. It answers with
  // positions in the list of boxes sent, so all it can do is point at one of them.
  async function viaAI(intent) {
    if (ai === null) {
      const list = listControls(document);
      const res = await send({ action: "aiMap", task: "controls", items: list.map(({ el, ...c }) => c) });
      ai = res.success ? { list, pick: res.answer } : {};
    }
    const el = ai.list?.[ai.pick?.[intent]]?.el ?? null;
    if (el) found[intent] = "ai";
    return el;
  }

  // A box of the form: its usual name or label (waiting for the form to draw it), then the AI.
  async function locate(intent, ms = 4000) {
    const el = await until(() => findBasic(document, intent), ms);
    if (el) found[intent] = "page";
    return el ?? (await viaAI(intent)) ?? ((found[intent] = "missing"), null);
  }

  // The custom label box only exists while its switch is on, and the switch sits in the title's options menu.
  async function customLabel() {
    const box = () => findBasic(document, "sku");
    if (box()) return box();
    const toggle = await locate("skuSwitch", 1500);
    if (toggle && !toggle.checked) press(toggle);
    const el = await until(box, 5000);
    if (el) found.sku = "page";
    return el ?? (await viaAI("sku"));
  }

  // A box eBay may re-draw after it was set: the value must be there a moment later too, and is typed in if it is not.
  async function fillBasic(box, value) {
    if (await fillText(box, value)) {
      await wait(300);
      if (matches(box.value, value)) return true;
    }
    return typeIn(box, value);
  }

  // The price goes in the Buy It Now box, which is the price only in the fixed-price format: in an auction it is an
  // optional extra that must beat the starting bid. So the format is set first (and said, as a row).
  async function priceBox() {
    const set = await useFixedPrice(document);
    if (set === "set") row("format", "Format", "Buy It Now", "filled");
    else if (set === "failed") row("format", "Format", "Buy It Now", "needs", { hint: "Choose Buy It Now yourself, then paste the price." });
    return set === "failed" ? null : locate("price");
  }

  // The description has a rich editor (an iframe) and a raw-HTML box behind the "Show HTML code" checkbox: switch to the
  // raw box, set it, switch back so the rich editor reads it, then check that both hold it. When the editor did not
  // take it, it is written into the editor itself, the way a pasted text is.
  async function fillDescription(box, html) {
    const mode = await locate("htmlSwitch", 1500);
    if (!mode) return false;
    const want = squash(plain(html));
    const wasHtml = mode.checked;
    if (!wasHtml) press(mode);
    await wait(250);
    setValue(box, html);
    await wait(200);
    const held = () => squash(plain(box.value)) === want;
    const stuck = held() || ((await typeIn(box, html)) && held());
    if (!wasHtml) press(mode);
    if (!stuck) return false;
    const editor = () => q('iframe[title="Description"]')?.contentDocument;
    const shows = () => squash(editor()?.body?.textContent) === want;
    if (!editor()) return true; // the frame can't be reached: the HTML box holds it
    if (await until(shows, 2500)) return true;
    const rich = editor().querySelector('[contenteditable="true"]');
    if (!rich) return false;
    rich.focus();
    editor().execCommand("selectAll");
    editor().execCommand("insertHTML", false, html);
    return Boolean(await until(shows, 1500));
  }

  async function fillBasics() {
    const { target: t, listing: l } = ctx;
    const basics = [
      ["title", "Title", l.title, () => locate("title"), fillBasic],
      ["sku", "Custom label", t.sku, customLabel, fillBasic],
      ["description", "Description", l.description, () => locate("description"), (box) => fillDescription(box, l.html)],
      // A price for another marketplace is never typed in.
      ["price", `Price (${t.currency})`, t.price, () => (otherSite() || !t.price ? null : priceBox()), fillBasic],
    ];
    for (const [id, label, value, find, fill] of basics) {
      if (dismissed) return;
      if (rows.get(id)?.status === "filled" || (!value && id === "sku")) continue; // a second pass leaves what it filled alone
      row(id, label, value, "filling");
      render();
      const field = await find();
      const ok = Boolean(value && field && (await fill(field, value).catch(() => false)));
      const hint = !value ? "Choose a value on eBay." : id === "price" && otherSite() ? `This is ${location.hostname}, the product is for ${t.host}: type the price yourself if it applies.` : !field ? "AliSwift couldn't find this box. Copy it, or send the report." : undefined;
      row(id, label, value, ok ? "filled" : value ? "copy" : "needs", { field, ...(hint && { hint }) });
    }
    const cond = q('button[name="condition"]');
    const shown = clean(cond?.textContent);
    if (cond && !/^new/i.test(shown)) row("condition", "Condition", shown, "needs", { field: cond, hint: "Check that this is right." });
    render();
  }

  /* Photos (the setting "Include images"). They go to eBay's own uploader as files, the way a seller's choice in the file
     picker does; when the form does not take them, the worker saves them to a folder in Downloads for the seller to drag in. */

  const photoWords = (n) => `${n} ${n === 1 ? "photo" : "photos"}`;
  const toFile = ({ mime, data, name }) => new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], name, { type: mime });

  // A variant's photo has no place on the form of a single listing, so those are always saved, one folder per variant.
  async function saveVariants(n) {
    const saved = await send({ action: "ebayPhotosSave", variantsOnly: true });
    const hint = saved.success
      ? `Saved to Downloads\\${saved.folder}, one folder per variant.`
      : saved.code === "permission" ? "Allow Downloads in AliSwift settings to save them to folders." : saved.error ?? "Couldn't save them.";
    row("variants", "Variant photos", `${n} ${n === 1 ? "variant" : "variants"}`, saved.success ? "filled" : "needs", { hint });
  }

  async function addPhotos() {
    const count = ctx.photos.count;
    const variants = ctx.photos.variants ?? 0;
    row("photos", "Photos", photoWords(count), "filling");
    render();
    const files = [];
    for (let n = 0; n < count && !dismissed; n++) {
      const res = await send({ action: "ebayPhoto", n });
      if (res.success && res.image) files.push(toFile(res.image));
    }
    if (dismissed) return;
    const input = await until(() => photoBox(document), 4000);
    const zone = photoZone(document);
    // The file box first, then a drop on the drop zone. A try counts when the form shows more photos than before.
    const tries = [input && (() => giveFiles(input, files)), zone && (() => dropFiles(zone, files))].filter(Boolean);
    let ok = false;
    for (const give of files.length ? tries : []) {
      const before = photoCount(document);
      give();
      ok = Boolean(await until(() => photoCount(document) > before, 12000));
      if (ok) break;
    }
    found.photos = ok ? "attached" : "not attached";
    if (ok) {
      row("photos", "Photos", photoWords(files.length), "filled");
      if (variants) await saveVariants(variants);
      return;
    }
    const saved = await send({ action: "ebayPhotosSave" });
    const more = variants ? ` The ${variants === 1 ? "variant's photo is" : "variants' photos are"} in folders named after ${variants === 1 ? "it" : "them"}.` : "";
    const hint = saved.success
      ? `The form didn't take them. ${saved.saved} saved to Downloads\\${saved.folder}: drag them into the photo box.${more}`
      : saved.code === "permission"
        ? "The form didn't take them, and Downloads isn't allowed, so they couldn't be saved. Allow it in AliSwift settings, or add them yourself."
        : `The form didn't take them. ${saved.error ?? "Add them yourself."}`;
    found.photos += saved.success ? ", saved to a folder" : ", not saved";
    row("photos", "Photos", photoWords(count), "needs", { field: zone, hint });
  }

  // Lazily drawn parts of the form (the price, the description) only exist once they have scrolled into view.
  async function reveal() {
    const top = scrollY;
    scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    await wait(400);
    scrollTo({ top, behavior: "instant" });
  }

  // Why the AI step failed, as the panel says it.
  function failure(res) {
    if (res.code === "nokey" || res.code === "invalid-key") return { tone: "error", text: "AI isn't set up. Check your Gemini key in AliSwift settings.", settings: true };
    if (res.code === "rate") return { tone: "warn", text: "Gemini is busy or over its limit. Try again in a minute.", retry: true };
    const why = { timeout: "Gemini took too long.", network: "Couldn't reach Gemini." }[res.code] ?? (res.error ? `Gemini said: ${res.error}` : "");
    return { tone: "warn", text: `AI couldn't match this form. ${why} Your listing's own fields are filled; the rest are ready to copy.`.replace("  ", " "), retry: true };
  }

  async function fillForm() {
    for (const [id, r] of rows) if (r.status !== "filled") rows.delete(id);
    phase = "reading";
    notice = null;
    ai = null;
    for (const k of Object.keys(found)) delete found[k];
    render();
    ctx = await send({ action: "ebayContext" }); // asked again: another product may have been picked
    if (!ready()) {
      phase = "idle";
      return render();
    }
    await reveal();
    if (!(await locate("title", 6000))) {
      phase = "done";
      notice = { tone: "error", text: "Couldn't find the listing form. Choose a category on eBay, then press Fill form again.", retry: true };
      return render();
    }
    await fillBasics();

    const cat = q('button[name="categoryId"]');
    const category = clean(`${cat?.textContent ?? ""} ${cat?.parentElement?.querySelector(".value-secondary")?.textContent ?? ""}`);
    const tried = new Set();
    // One more look after filling: a value can reveal a field (Metal reveals Metal Purity). ponytail: one extra pass, not a loop.
    if (await fillSpecifics(category, tried)) {
      await wait(500);
      await fillSpecifics(category, tried);
    }
    if (ctx.photos?.count && !dismissed && rows.get("photos")?.status !== "filled") {
      phase = "filling";
      await addPhotos();
    }
    phase = "done";
    render();
  }

  // One look at the form's item specifics: the AI is asked about the empty ones not tried yet, and what it answers is
  // filled. True when it asked and got an answer (so a second look may find more).
  async function fillSpecifics(category, tried) {
    if (dismissed) return false;
    const { fields } = extractFields(document);
    const open = fields.filter((f) => !f.value && !tried.has(f.name));
    if (!fields.length) notice = { tone: "warn", text: "No item specifics found. Choose a category on eBay, then press Fill form again.", retry: true };
    if (!open.length) return false;
    for (const f of open) tried.add(f.name);
    phase = "asking";
    asking = open.length;
    render();
    const wire = open.map(({ el, block, ...f }) => f); // what leaves the page holds no element
    const plan = await send({ action: "planFill", fields: wire, category });
    if (!plan.success) {
      found.aiError = [plan.code, plan.status, plan.model, plan.error].filter(Boolean).join(" | "); // for the report
      notice = failure(plan);
      for (const s of ctx.listing.specifics ?? []) row(`spec:${s.name}`, s.name, s.value, "copy");
      for (const f of open) if (f.required) row(f.name, f.label, "", "needs", { field: f.el, hint: "Required. Choose a value on eBay." });
      return false;
    }
    await applyPlan(open, plan.answers);
    return true;
  }

  async function applyPlan(open, reply) {
    phase = "filling";
    const byName = new Map(open.map((f) => [f.name, f]));
    const answers = reply.filter((a) => byName.has(a.name)); // the worker has checked these; a name it never sent is skipped anyway
    for (const { name, value } of answers) row(name, byName.get(name).label, value, "pending", { field: byName.get(name).el });
    render();
    // ponytail: three menus in a row that take no value mean the menu mechanism itself fails: the rest are copy rows at once.
    let misses = 0;
    for (const { name, value } of answers) {
      if (dismissed) return;
      const f = byName.get(name);
      const menu = f.kind === "menu" || f.kind === "multi";
      const give = !menu || misses < 3;
      row(name, f.label, value, give ? "filling" : "copy", { field: f.el });
      render();
      const ok = give && (await fillSpecific(f, value));
      if (menu) misses = ok ? 0 : misses + 1;
      row(name, f.label, value, ok ? "filled" : "copy", { field: f.el });
      render();
    }
    for (const f of open) if (f.required && !rows.has(f.name)) row(f.name, f.label, "", "needs", { field: f.el, hint: "Required. Choose a value on eBay." });
  }

  /* Start: idle until the page is the listing form. eBay may reach /lstng from /sl/... without a page load, so look again. */

  let starting = false;
  async function start() {
    if (dismissed || ui || starting || !location.pathname.startsWith("/lstng")) return;
    starting = true;
    ctx = await send({ action: "ebayContext" });
    starting = false;
    if (dismissed || ui) return;
    mount();
    clearInterval(timer);
  }
  // ponytail: a one-second look while on /sl pages; switch to the Navigation API if it ever shows up in a profile.
  timer = setInterval(start, 1000);
  start();
})();
