// The AliSwift panel on eBay's listing form (/lstng). It fills the title, custom label, description and price from the
// product picked on the dashboard, then the item specifics through Gemini (the worker does the asking), and shows
// everything it could not fill as a row to copy. Idle on every other eBay page. It never presses List it, Save for
// later or Preview, and never touches Condition. Needs lib/ebayform.js (loaded first by the manifest).
// Layout, copy and states: design-p2-6.md, surface 10. Not verified against the live site: see the build report.

(() => {
  const NS = "http://www.w3.org/2000/svg";
  const PATH = {
    bolt: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
    more: "M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z",
    ring: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z",
    check: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
    warn: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
    error: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z",
    copy: "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z",
    go: "M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z",
    spin: "M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  };
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
  const rows = new Map(); // id -> { id, label, value, status, field?, hint? }
  const saved = {}; // the page's own padding, put back on Done

  const send = (message) => chrome.runtime.sendMessage(message).catch((error) => ({ success: false, error: error.message }));

  // Elements are built here, never from markup strings: every text goes in as text.
  const h = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
    }
    e.append(...kids.filter(Boolean));
    return e;
  };
  const icon = (d, cls, size = 18) => {
    const svg = document.createElementNS(NS, "svg");
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": "true", width: size, height: size, ...(cls && { class: cls }) })) svg.setAttribute(k, v);
    svg.append(path);
    return svg;
  };

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
    if (!ctx.target) return "Choose a product on the dashboard first.";
    if (!ctx.listing) return "That product has no saved listing. Create one on the dashboard.";
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

  /* Rows and the panel */

  const go = (field) => {
    field.scrollIntoView({ block: "center" });
    field.focus();
  };

  async function copyValue(btn, r) {
    let ok = true;
    try {
      await navigator.clipboard.writeText(r.value);
    } catch {
      // eBay's permissions policy may refuse the clipboard: copy through a text box instead.
      const box = h("textarea", { style: "position:fixed;opacity:0" });
      box.value = r.value;
      document.body.append(box);
      box.select();
      ok = document.execCommand("copy");
      box.remove();
    }
    if (ok) {
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

    const all = [...rows.values()];
    ui.list.replaceChildren(...["needs", "copy", "pending", "filling"].flatMap((s) => all.filter((r) => r.status === s)).map(rowEl));
    const done = all.filter((r) => r.status === "filled");
    ui.filled.hidden = !done.length;
    ui.filledCount.textContent = done.length;
    ui.filledList.replaceChildren(...done.map(rowEl));

    ui.notice.hidden = !notice;
    ui.notice.replaceChildren();
    if (notice) {
      ui.notice.dataset.tone = notice.tone;
      ui.notice.append(icon(notice.tone === "error" ? PATH.error : PATH.warn, "", 16), h("div", { text: notice.text }));
      if (notice.settings) ui.notice.append(h("button", { type: "button", class: "btn btn-quiet btn-sm", text: "Open settings", onclick: () => send({ action: "openPage", page: "settings" }) }));
    }

    const busy = running();
    ui.fill.textContent = !ready() ? "Open dashboard" : busy ? "Filling..." : notice?.retry ? "Try again" : phase === "done" && !notice?.settings ? "Fill again" : "Fill form";
    ui.fill.setAttribute("aria-disabled", String(busy));
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
    const host = h("div", { id: "aliswift-host" });
    const root = host.attachShadow({ mode: "closed" });
    const toggle = h("button", { type: "button", class: "icon-btn", id: "ali-toggle", "aria-controls": "ali-panel", "aria-expanded": "true", "aria-label": "Collapse AliSwift panel" }, icon(PATH.more));
    ui = {
      host, toggle,
      say: h("span"),
      prod: h("span", { class: "ali-prod" }),
      mini: h("span", { class: "ali-mini" }),
      spin: icon(PATH.spin, "spin", 14),
      notice: h("div", { class: "notice", role: "alert", hidden: true }),
      list: h("ul", { class: "ali-rows", role: "list" }),
      filledCount: h("span", { class: "muted" }),
      filledList: h("ul", { class: "ali-rows", role: "list" }),
      fill: h("button", { type: "button", class: "btn btn-sm", id: "ali-fill" }),
    };
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
          h("p", { class: "ali-summary", role: "status" }, ui.spin, ui.say),
          ui.notice,
          ui.list,
          ui.filled,
        ),
        h(
          "footer",
          { class: "ali-foot" },
          h("div", { class: "actions" }, h("button", { type: "button", class: "btn btn-quiet btn-sm", id: "ali-done", text: "Done", onclick: finish }), ui.fill),
        ),
      ),
    );
    ui.panel = h(
      "section",
      { class: "ali", role: "complementary", "aria-label": "AliSwift" },
      h("header", { class: "ali-head" }, icon(PATH.bolt, "bolt"), h("div", { class: "ali-title" }, h("strong", { text: "AliSwift" }), ui.prod, ui.mini), toggle),
      ui.collapsible,
    );
    ui.fill.addEventListener("click", () => {
      if (!ready()) send({ action: "openPage", page: "dashboard" });
      else if (!running()) fillForm();
    });
    toggle.addEventListener("click", () => {
      setCollapsed(!collapsed);
      try {
        sessionStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
      } catch {
        // storage can be blocked: the choice just isn't remembered
      }
    });

    root.append(h("link", { rel: "stylesheet", href: chrome.runtime.getURL("lib/ui.css") }), h("link", { rel: "stylesheet", href: chrome.runtime.getURL("ebay.css") }), ui.panel);
    document.body.prepend(host);

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
  }

  // The four fields the panel fills itself, shown as Pending before anything is pressed.
  function idleRows() {
    const { target: t, listing: l } = ctx;
    row("title", "Title", l.title, "pending");
    if (t.sku) row("sku", "Custom label", t.sku, "pending");
    row("description", "Description", l.description, "pending");
    row("price", `Price (${t.currency})`, t.price, "pending");
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

  /* Filling */

  const plain = (html) => clean(new DOMParser().parseFromString(html, "text/html").body.textContent);

  // The custom label box only exists while its switch is on.
  async function customLabel() {
    const box = q('input[name="customLabel"]');
    if (box) return box;
    const toggle = q('input[name="customLabelPref"]');
    if (!toggle) return null;
    if (!toggle.checked) press(toggle);
    return until(() => q('input[name="customLabel"]'));
  }

  // The description has a rich editor and a raw-HTML box behind a checkbox: switch to the raw box, set it, switch back
  // so the rich editor reads it, then check both (the editor too, when its frame can be reached).
  async function fillDescription(box, html) {
    const mode = q('input[name="descriptionEditorMode"]');
    if (!mode) return false;
    const wasHtml = mode.checked;
    if (!wasHtml) press(mode);
    await wait(250);
    setValue(box, html);
    await wait(150);
    const stuck = box.value === html;
    if (!wasHtml) press(mode);
    const body = () => q('iframe[title="Description"]')?.contentDocument?.body;
    return stuck && (!body() || Boolean(await until(() => clean(body().textContent) === plain(html), 2000)));
  }

  async function fillBasics() {
    const { target: t, listing: l } = ctx;
    const basics = [
      ["title", "Title", l.title, async () => q('input[name="title"]'), fillText],
      ["sku", "Custom label", t.sku, customLabel, fillText],
      ["description", "Description", l.description, async () => q('textarea[name="description"]'), (box) => fillDescription(box, l.html)],
      // A price for another marketplace is never typed in.
      ["price", `Price (${t.currency})`, t.price, async () => q('input[name="price"]'), async (box, v) => location.hostname === t.host && (await fillText(box, v))],
    ];
    for (const [id, label, value, find, fill] of basics) {
      if (dismissed) return;
      if (rows.get(id)?.status === "filled" || (!value && id === "sku")) continue; // a second pass leaves what it filled alone
      row(id, label, value, "filling");
      render();
      const field = await find();
      const ok = Boolean(value && field && (await fill(field, value).catch(() => false)));
      row(id, label, value, ok ? "filled" : value ? "copy" : "needs", { field, ...(!value && { hint: "Choose a value on eBay." }) });
    }
    const cond = q('button[name="condition"]');
    const shown = clean(cond?.textContent);
    if (cond && !/^new/i.test(shown)) row("condition", "Condition", shown, "needs", { field: cond, hint: "Check that this is right." });
    render();
  }

  // Why the AI step failed, as the panel says it.
  function failure(res) {
    if (res.code === "nokey" || res.code === "invalid-key") return { tone: "error", text: "AI isn't set up. Check your Gemini key in AliSwift settings.", settings: true };
    if (res.code === "rate") return { tone: "warn", text: "Gemini is busy or over its limit. Try again in a minute.", retry: true };
    return { tone: "warn", text: "AI couldn't match this form. Your listing's own fields are filled; the rest are ready to copy.", retry: true };
  }

  async function fillForm() {
    for (const [id, r] of rows) if (r.status !== "filled") rows.delete(id);
    phase = "reading";
    notice = null;
    render();
    ctx = await send({ action: "ebayContext" }); // asked again: the dashboard may have picked another product
    if (!ready()) {
      phase = "idle";
      return render();
    }
    if (!q('input[name="title"]')) {
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
