// The AliSwift panel on eBay's listing form (/lstng). It shows the products that have a listing (or one being written),
// fills the title, custom label, description and price from the one the seller picks, then the item specifics (the
// listing's own first, then the AI through the worker), and shows everything it could not fill as a row to copy. Each
// step keeps its own result, and the footer follows them (endState in lib/errors.js). Idle on every other eBay page. It never presses
// List it, Save for later or Preview, and never touches Condition. Needs lib/panel.js and lib/ebayform.js (loaded first
// by the manifest). The names of eBay's boxes come from a saved copy of its form (test/fixtures/ebay-form-basics.html).

reportCrashes(); // lib/errors.js

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

  let ctx = null; // the worker's answer to ebayContext: { target, listing, queued? }
  let ui = null; // the panel's elements, once it is on the page
  let phase = "idle"; // idle, reading, writing, asking, filling or done
  let notice = null; // { tone, text }: a message outside the Fill steps (a card that couldn't be picked, Listed)
  let logsNote = ""; // what Send logs did
  let asking = 0; // fields sent to the AI in this pass
  let dismissed = false;
  let collapsed = false;
  let timer;
  let tick; // the Try again countdown
  let resizer;
  let products = []; // the cards the worker offers: { sheetId, key, sku, title, price, currency, state }
  let current = null; // { sheetId, key } of the card in use
  let choosing = false; // a card was clicked and the worker hasn't answered
  let ai = null; // the AI's reading of this form, asked at most once per Fill press: { list, pick } or {}
  const found = {}; // intent -> "page" | "ai" | "missing", for the report
  const rows = new Map(); // id -> { id, label, value, status, field?, hint? }
  const results = {}; // step (write, basics, specifics) -> true, or the failed reply: one per step, never overwritten by another
  const saved = {}; // the page's own bottom padding, put back on Done
  const cardEls = new Map(); // "sheetId:key" -> { sig, el }: a card is drawn again only when its data changed

  // A page left open across an extension reload throws at once (not a rejected promise): that is "reloaded".
  const send = async (message) => {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      const gone = !chrome.runtime?.id || /context invalidated/i.test(error.message);
      return { success: false, error: error.message, ...(gone && { code: "reloaded" }) };
    }
  };

  /* State */

  const STEPS = ["write", "basics", "specifics"];
  const BASICS = ["title", "sku", "description", "price", "format", "condition"];
  const stepOf = (id) => (BASICS.includes(id) ? "basics" : "specifics");
  const end = () => endState(Object.fromEntries(STEPS.filter((s) => s in results).map((s) => [s, results[s]]))); // lib/errors.js

  const ready = () => Boolean(ctx?.target); // a product is chosen; with no listing yet, Write now writes it first
  const running = () => ["reading", "writing", "asking", "filling"].includes(phase);
  const counts = () => {
    const c = { filled: 0, copy: 0, needs: 0 };
    for (const r of rows.values()) if (r.status in c) c[r.status]++;
    return c;
  };
  const row = (id, label, value, status, extra = {}) => rows.set(id, { id, label, value, status, ...extra });

  function summary() {
    if (!ctx?.success) return ctx?.code === "reloaded" ? errorView(ctx).text : "AliSwift didn't answer. Reload this page.";
    if (!ctx.target) return products.length ? "Choose the product to list." : "No listings yet.";
    if (phase === "reading") return "Reading the form...";
    if (phase === "writing") return "Writing the listing...";
    if (phase === "asking") return `Asking AI to match ${asking} fields...`;
    if (phase === "filling") return "Filling the form...";
    if (phase === "done") {
      const { filled: f, copy: c, needs: n } = counts();
      const need = n ? `, ${n} need you` : "";
      return !f ? `Nothing filled, ${c} to copy${need}.` : !c && !n ? `All ${f} fields filled.` : `${f} filled, ${c} to copy${need}`;
    }
    if (ctx.listing) return ""; // the rows and the Fill form button say it all
    const q = ctx.queued;
    if (q?.failed) return `The listing isn't written yet. ${q.code ? errorView({ step: "write", code: q.code }).text : ""}`.trim();
    if (!q) return "No listing yet. Press Write now.";
    const mins = Math.max(1, Math.ceil((q.at - Date.now()) / 60000));
    return `Writing the listing, ready in about ${mins} ${mins === 1 ? "minute" : "minutes"}.`;
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

  // A card's tag: its sell price once the listing is written, else where the listing stands.
  const cardTag = (card) => (card.state === "queued" ? "Writing listing…" : card.state === "failed" ? "Not written" : money(card));

  function cardEl(card) {
    const tag = cardTag(card);
    return h(
      "li",
      {},
      h(
        "button",
        { type: "button", class: "ali-card", "aria-pressed": String(isCurrent(card)), onclick: () => choose(card) },
        h("span", { class: "ali-card-top" }, h("strong", { text: card.sku }), tag && h("span", { class: "tag", text: tag })),
        h("span", { class: "ali-card-title", text: card.title }),
      ),
    );
  }

  function renderCards() {
    const els = products.map((c) => {
      const sig = JSON.stringify([c, isCurrent(c)]);
      const id = `${c.sheetId}:${c.key}`;
      let kept = cardEls.get(id);
      if (kept?.sig !== sig) cardEls.set(id, (kept = { sig, el: cardEl(c) }));
      return kept.el;
    });
    const now = ui.cards.children;
    if (els.length !== now.length || els.some((el, i) => now[i] !== el)) ui.cards.replaceChildren(...els);
    ui.pickNote.textContent = !products.length
      ? "Products you add from AliExpress show here once their listing is written."
      : "";
  }

  // The cards come from AliSwift's storage, their price and status from one read per sheet; the old cards show meanwhile.
  async function loadProducts() {
    const res = await send({ action: "ebayProducts" });
    products = res.success ? res.products : [];
    current = res.success ? res.current : null;
    if (ui) render();
  }

  // The seller clicked a card: the worker makes it the product and answers its context, and the panel starts over with it.
  // The card is pressed at once; the worker's answer (one sheet read for the price) follows.
  async function choose(card) {
    if (running() || choosing) return;
    const was = current;
    choosing = true;
    current = { sheetId: card.sheetId, key: card.key };
    renderCards();
    const res = await send({ action: "ebaySelect", sheetId: card.sheetId, key: card.key });
    choosing = false;
    if (!res.success) {
      current = was;
      notice = { tone: "error", text: res.code ? errorView(res).text : res.error ?? "Couldn't pick that product." };
      return render();
    }
    adopt(res);
  }

  // A product's context becomes the panel's, which starts over with it.
  function adopt(res) {
    ctx = res;
    rows.clear();
    for (const s of Object.keys(results)) delete results[s];
    if (ready()) idleRows();
    phase = "idle";
    notice = null;
    logsNote = "";
    ui.pickOpen = false;
    render();
  }

  // The worker says the products changed (a listing written, a product sent from the dashboard): the cards are read
  // again, and a product picked elsewhere, or the picked one's listing just written, is taken up without a reload.
  let refreshing;
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action !== "ebayRefresh" || !ui) return;
    clearTimeout(refreshing);
    refreshing = setTimeout(async () => {
      const was = current?.key;
      await loadProducts();
      if (!ui || running() || choosing || (current?.key === was && !(ready() && !ctx.listing))) return;
      const res = await send({ action: "ebayContext" });
      if (ui && res.success && (current?.key !== was || res.listing)) adopt(res);
    }, 400);
  });

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
      const meta = btn.closest(".copy-row").querySelector(".copy-meta");
      meta.textContent = "Press Ctrl+C";
      meta.style.cssText = "width:auto;padding:0 8px";
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
      h("span", { class: "tag copy-meta", role: "img", title: word, "aria-label": word, ...(tone && { "data-tone": tone }) }, icon(PATH[glyph], r.status === "filling" && "spin", 12)),
      acts,
      h("div", { class: "copy-value", text: r.value || "–" }),
      r.hint && h("p", { class: "ali-hint", text: r.hint }),
    );
  }

  /* Motion. One easing for everything that moves, Apple's kind: quick to start, long to settle. */

  const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const moving = () => ui.panel.dataset.anim !== undefined || ui.slide?.playState === "running";

  // Draws, and slides the panel from its old height to the new one (it grows upward: it is anchored to the bottom). The
  // product list has its own animation (showList), so a draw that opens or closes it does not slide the panel too.
  function render() {
    if (!ui) return;
    const slide = ui.painted && !collapsed && !moving() && !calm();
    const from = ui.panel.offsetHeight;
    const listMoved = draw(ui.painted && !collapsed && !calm());
    ui.painted = true;
    const to = ui.panel.offsetHeight;
    if (slide && !listMoved && from !== to) {
      ui.slide = ui.panel.animate({ height: [`${from}px`, `${to}px`] }, { duration: 320, easing: EASE });
      ui.slide.finished.then(reserve, () => {});
    }
  }

  // The list of products grows from nothing (the panel's top edge rises with it), then its cards fade in one after
  // another; closing folds it away. Started again from wherever it is when pressed mid-way.
  function showList(open, animate) {
    const el = ui.pickList;
    const from = el.hidden ? 0 : el.offsetHeight;
    ui.listAnim?.cancel();
    el.hidden = false;
    if (!animate) {
      el.hidden = !open;
      return;
    }
    const to = open ? el.offsetHeight : 0;
    el.style.overflow = "hidden";
    ui.listAnim = el.animate({ height: [`${from}px`, `${to}px`] }, { duration: open ? 420 : 300, easing: EASE });
    if (open) {
      [...ui.cards.children].slice(0, 8).forEach((card, i) =>
        card.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 280, delay: 90 + i * 45, easing: EASE, fill: "backwards" }),
      );
    }
    ui.listAnim.finished
      .then(() => {
        el.style.overflow = "";
        el.hidden = !open;
        reserve();
      })
      .catch(() => {}); // pressed again mid-way: the next animation takes over
  }

  // True when the product list opened or closed.
  function draw(animate) {
    const { target } = ctx ?? {};
    const text = summary();
    ui.say.textContent = ui.mini.textContent = text;
    ui.summary.hidden = !text && !running();
    ui.spin.toggleAttribute("hidden", !running());
    ui.panel.dataset.phase = phase;

    // The product: the card in use, and the list to change it (closed until pressed, chosen or not).
    const open = ui.pickOpen;
    const listMoved = open !== ui.listOpen;
    ui.pickBtn.setAttribute("aria-expanded", String(open));
    ui.pickNow.textContent = ready() ? target.sku || target.title : "Choose a product";
    renderCards();
    if (listMoved) {
      ui.listOpen = open;
      showList(open, animate);
    }

    const all = [...rows.values()];
    ui.list.replaceChildren(...["needs", "copy", "pending", "filling"].flatMap((s) => all.filter((r) => r.status === s)).map(rowEl));
    const filledRows = all.filter((r) => r.status === "filled");
    ui.filled.hidden = !filledRows.length;
    ui.filledCount.textContent = filledRows.length;
    ui.filledList.replaceChildren(...filledRows.map(rowEl));

    // The message: the first failed step's (lib/errors.js) once a Fill is done, else a note outside the steps.
    const done = phase === "done";
    const state = done ? end() : null;
    const failedBefore = !ctx?.success && ctx?.code === "reloaded" ? errorView(ctx) : null;
    const shown = state?.text
      ? { tone: "warn", text: state.text, fixes: state.fixes }
      : failedBefore ? { tone: "error", text: failedBefore.text, fixes: failedBefore.buttons }
      : notice ?? (otherSite() && !done ? { tone: "warn", text: `This product is for ${ctx.target.host}. You are on ${location.hostname}, so its price is not typed in.` } : null);
    ui.notice.hidden = !shown;
    ui.notice.replaceChildren();
    if (shown) {
      ui.notice.dataset.tone = shown.tone;
      ui.notice.append(icon(shown.tone === "error" ? PATH.error : PATH.warn, "", 16), h("div", { text: shown.text }, logsNote && h("p", { class: "ali-hint", text: logsNote })));
      for (const fix of shown.fixes ?? []) if (FIXES[fix]) ui.notice.append(h("button", { type: "button", class: "btn btn-quiet btn-sm", text: FIXES[fix][0], onclick: FIXES[fix][1] }));
    }

    // The footer: one button at rest; once done, Done, Try again, or Send logs and Try again (endState).
    const busy = running();
    const foot = state?.footer ?? [];
    ui.fill.hidden = done;
    ui.done.hidden = !foot.includes("done");
    ui.logs.hidden = !foot.includes("logs");
    ui.retry.hidden = !foot.includes("retry");
    const secs = Math.ceil(((state?.retryAt ?? 0) - Date.now()) / 1000);
    clearTimeout(tick);
    if (!ui.retry.hidden && secs > 0) tick = setTimeout(render, 1000);
    ui.retry.textContent = secs > 0 ? `Try again in ${secs} s` : "Try again";
    ui.retry.setAttribute("aria-disabled", String(secs > 0));
    ui.fill.textContent = !ready() ? (products.length ? "Choose a product" : "Open dashboard") : busy ? "Working..." : ctx.listing ? "Fill form" : "Write now";
    ui.fill.setAttribute("aria-disabled", String(busy));
    if (busy) ui.fill.dataset.state = "loading";
    else delete ui.fill.dataset.state;
    return listMoved;
  }

  // The buttons a message offers to fix what failed (the table's settings, keys, signin, reload): [words, action].
  const openSettings = () => send({ action: "openPage", page: "settings" });
  const FIXES = {
    settings: ["Open settings", openSettings],
    keys: ["Get API keys", openSettings],
    signin: ["Open settings", openSettings],
    reload: ["Reload page", () => location.reload()],
  };

  // Try again runs only the steps that failed; all of them when the listing or the form itself was the failure.
  function retry() {
    if (running() || ui.retry.getAttribute("aria-disabled") === "true") return;
    const failed = STEPS.filter((s) => s in results && results[s] !== true);
    fillForm(failed.includes("write") || results.basics?.code === "noform" ? null : new Set(failed));
  }

  // Send logs: this run's report goes to the developer, with a reference to quote; when it can't be sent it is copied.
  async function sendLogs() {
    const res = await send({ action: "sendLogs", report: report() });
    const copied = !res.success && (await copyToClipboard(res.report ?? JSON.stringify(report(), null, 1)));
    logsNote = res.success ? `Sent. Quote ${res.ref} if you write to the developer.` : copied ? errorView({ code: "logs-unsent" }).text : "The report couldn't be sent or copied.";
    render();
  }

  // Room below the form for a narrow window, where the panel sits over its end: padding at the bottom of <html>, the only
  // change made to eBay's layout. It only lengthens the page, so nothing on it moves; never set mid-animation.
  function reserve() {
    if (!ui || moving()) return;
    document.documentElement.style.paddingBottom = wide.matches ? saved.bottom : `${collapsed ? 64 : ui.panel.offsetHeight + 32}px`;
  }

  // Opening: the ball grows into the panel (its content already at the open width, hidden), and once it has its size the
  // content fades in, part after part. Closing: the content fades out, then the panel shrinks back into the ball. Either
  // starts from wherever the other one is when pressed mid-way.
  function setCollapsed(on, animate = true) {
    collapsed = on;
    ui.collapsible.inert = on;
    ui.toggle.setAttribute("aria-expanded", String(!on));
    ui.toggle.setAttribute("aria-label", `${on ? "Expand" : "Collapse"} AliSwift panel`);
    const p = ui.panel;
    const [w0, h0] = [p.offsetWidth, p.offsetHeight]; // where it is now, mid-animation included
    const r0 = getComputedStyle(p).borderRadius;
    for (const a of ui.anim ?? []) a.cancel();
    ui.slide?.cancel();
    if (!animate || calm()) {
      p.toggleAttribute("data-collapsed", on);
      delete p.dataset.anim;
      return reserve();
    }
    const box = (w, h, r) => ({ width: `${w}px`, height: `${h}px`, borderRadius: r });
    const bolt = (at) => ({ left: `${at}px`, top: `${at}px` });
    const parts = () => [ui.title, ui.toggle, ...[...ui.body.children].filter((el) => !el.hidden), ui.foot];
    const done = (a) => a.finished.then(() => {
      delete p.dataset.anim;
      reserve();
    }, () => {}); // pressed again mid-way: the next animation takes over
    if (!on) {
      p.removeAttribute("data-collapsed");
      const [w, h] = [p.offsetWidth, p.offsetHeight]; // the panel as it will stay
      p.style.setProperty("--open-w", `${p.clientWidth}px`);
      p.dataset.anim = "";
      const grow = { duration: 560, easing: EASE };
      ui.anim = [
        p.animate([box(w0, h0, r0), box(w, h, getComputedStyle(p).borderRadius)], grow),
        ui.bolt.animate([bolt(23), bolt(24)], grow),
        ...parts().map((el, i) => el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 340, delay: 380 + Math.min(i, 6) * 50, easing: EASE, fill: "backwards" })),
      ];
      return done(ui.anim[0]);
    }
    if (!p.dataset.anim) p.style.setProperty("--open-w", `${p.clientWidth}px`);
    p.dataset.anim = "";
    const shut = { duration: 400, delay: 110, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" };
    ui.anim = [
      p.animate([box(w0, h0, r0), box(48, 48, "24px")], shut),
      ui.bolt.animate([bolt(24), bolt(23)], shut),
      ...parts().map((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: "ease-in", fill: "forwards" })),
    ];
    ui.anim[0].finished.then(() => {
      p.setAttribute("data-collapsed", "");
      for (const a of ui.anim) a.cancel();
    }, () => {});
    done(ui.anim[0]);
  }

  function mount() {
    const toggle = h("button", { type: "button", class: "icon-btn", id: "ali-toggle", "aria-controls": "ali-panel", "aria-expanded": "true", "aria-label": "Collapse AliSwift panel" }, icon(PATH.more));
    ui = {
      toggle,
      pickOpen: false,
      say: h("span"),
      mini: h("span", { class: "ali-mini" }),
      spin: icon(PATH.spin, "spin", 14),
      notice: h("div", { class: "notice", role: "alert", hidden: true }),
      pickNow: h("span", { class: "ali-pick-now" }),
      bolt: icon(PATH.bolt, "bolt"),
      cards: h("ul", { class: "ali-cards", role: "list" }),
      pickNote: h("p", { class: "ali-hint" }),
      list: h("ul", { class: "ali-rows", role: "list" }),
      filledCount: h("span", { class: "muted" }),
      filledList: h("ul", { class: "ali-rows", role: "list" }),
      fill: h("button", { type: "button", class: "btn btn-sm", id: "ali-fill" }),
      done: h("button", { type: "button", class: "btn btn-sm", id: "ali-done", text: "Done", hidden: true, onclick: finish }),
      logs: h("button", { type: "button", class: "btn btn-quiet btn-sm", id: "ali-logs", text: "Send logs", title: "Sends this run's report (the form's boxes and what happened, never your keys) to the developer", hidden: true, onclick: sendLogs }),
      retry: h("button", { type: "button", class: "btn btn-sm", id: "ali-retry", text: "Try again", hidden: true, onclick: retry }),
    };
    ui.pickBtn = h("button", { type: "button", class: "ali-pick-btn", "aria-controls": "ali-pick-list" }, ui.pickNow, icon(PATH.more));
    ui.pickList = h("div", { class: "ali-pick-list", id: "ali-pick-list" }, ui.cards, ui.pickNote);
    ui.filled = h("details", { class: "disclosure ali-filled", hidden: true }, h("summary", {}, "Filled ", ui.filledCount), ui.filledList);
    ui.collapsible = h(
      "div",
      { class: "ali-collapsible", id: "ali-panel" },
      h(
        "div",
        { class: "ali-inner" },
        (ui.body = h(
          "div",
          { class: "ali-body" },
          h("section", { class: "ali-pick", "aria-label": "Product" }, ui.pickBtn, ui.pickList),
          (ui.summary = h("p", { class: "ali-summary", role: "status" }, ui.spin, ui.say)),
          ui.notice,
          ui.list,
          ui.filled,
        )),
        (ui.foot = h(
          "footer",
          { class: "ali-foot" },
          h("div", { class: "actions" }, ui.logs, ui.retry, ui.done, ui.fill),
        )),
      ),
    );
    ui.panel = h(
      "section",
      { class: "ali", role: "complementary", "aria-label": "AliSwift" },
      h("header", { class: "ali-head" }, ui.bolt, (ui.title = h("div", { class: "ali-title" }, h("strong", { text: "AliSwift" }), ui.mini)), toggle),
      ui.collapsible,
    );
    ui.panel.addEventListener("click", () => {
      if (collapsed) {
        setCollapsed(false, true);
        try {
          sessionStorage.setItem(COLLAPSED_KEY, "0");
        } catch {}
      }
    });
    ui.host = mountPanel("aliswift-host", ui.panel);
    ui.fill.addEventListener("click", () => {
      if (!ready()) {
        if (!products.length) send({ action: "openPage", page: "dashboard" });
        else if (!ui.pickOpen) ui.pickBtn.click(); // "Choose a product" opens the list
      } else if (!running()) fillForm();
    });
    ui.pickBtn.addEventListener("click", () => {
      ui.pickOpen = !ui.pickOpen;
      if (ui.pickOpen) loadProducts();
      render();
    });
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      setCollapsed(!collapsed, true);
      try {
        sessionStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
      } catch {
        // storage can be blocked: the choice just isn't remembered
      }
    });

    saved.bottom = document.documentElement.style.paddingBottom;
    let stored = null;
    try {
      stored = sessionStorage.getItem(COLLAPSED_KEY);
    } catch {
      // see above
    }
    setCollapsed(stored === null ? true : stored === "1", false);
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
    row("title", "Title", l?.title ?? t.title, "pending");
    if (t.sku) row("sku", "Custom label", t.sku, "pending");
    row("description", "Description", l?.description ?? "", "pending");
    row("price", `Price (${t.currency})`, t.price, "pending");
  }

  function finish() {
    dismissed = true;
    clearInterval(timer);
    clearTimeout(tick);
    resizer.disconnect();
    wide.removeEventListener("change", reserve);
    document.documentElement.style.paddingBottom = saved.bottom;
    ui.host.remove();
    ui = null;
    send({ action: "ebayDone" });
  }

  // What Send logs sends: this form's boxes (names and words, never what is typed in them) and what the pass did.
  function report() {
    return {
      report: "AliSwift form report",
      page: `${location.hostname}${location.pathname}`,
      target: ctx?.target ? { host: ctx.target.host, currency: ctx.target.currency } : null,
      steps: Object.fromEntries(Object.entries(results).map(([s, r]) => [s, r === true ? "ok" : r.code ?? "unknown"])),
      found,
      rows: [...rows.values()].map((r) => [r.id, r.status]),
      controls: listControls(document).map(({ el, ...c }) => c),
    };
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
      if (!res.success) {
        found.aiError = [res.code, res.status, res.model, res.error].filter(Boolean).join(" | ");
      }
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

  // True when a box with a value couldn't be filled (the step failed; its rows are there to copy).
  async function fillBasics() {
    const { target: t, listing: l } = ctx;
    let missed = false;
    const basics = [
      ["title", "Title", l.title, () => locate("title"), fillBasic],
      ["sku", "Custom label", t.sku, customLabel, fillBasic],
      ["description", "Description", l.description, () => locate("description"), async (box) => (l.html ? fillDescription(box, l.html) : false)],
      // A price for another marketplace is never typed in.
      ["price", `Price (${t.currency})`, t.price, () => (otherSite() || !t.price ? null : priceBox()), fillBasic],
    ];
    for (const [id, label, value, find, fill] of basics) {
      if (dismissed) return missed;
      if (rows.get(id)?.status === "filled" || (!value && id === "sku")) continue; // a second pass leaves what it filled alone
      row(id, label, value, "filling");
      render();
      const field = await find();
      const ok = Boolean(value && field && (await fill(field, value).catch(() => false)));
      const hint = !value ? "Choose a value on eBay." : id === "price" && otherSite() ? `This is ${location.hostname}, the product is for ${t.host}: type the price yourself if it applies.` : !field ? "AliSwift couldn't find this box. Copy it." : undefined;
      row(id, label, value, ok ? "filled" : value ? "copy" : "needs", { field, ...(hint && { hint }) });
      if (value && !ok && !(id === "price" && otherSite())) missed = true;
    }
    const cond = q('button[name="condition"]');
    const shown = clean(cond?.textContent);
    if (cond && !/^new/i.test(shown)) row("condition", "Condition", shown, "needs", { field: cond, hint: "Check that this is right." });
    render();
    return missed;
  }

  // Lazily drawn parts of the form (the price, the description) only exist once they have scrolled into view.
  async function reveal() {
    const top = scrollY;
    scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    await wait(400);
    scrollTo({ top, behavior: "instant" });
  }

  // A Fill press, or Try again with `only` the steps that failed (rows and results of the other steps stay). The listing
  // is written first when the product has none yet (Write now).
  async function fillForm(only = null) {
    const runs = (step) => !only || only.has(step);
    for (const [id, r] of rows) if (r.status !== "filled" && runs(stepOf(id))) rows.delete(id);
    for (const s of Object.keys(results)) if (runs(s)) delete results[s];
    phase = "reading";
    notice = null;
    logsNote = "";
    ai = null;
    for (const k of Object.keys(found)) delete found[k];
    render();
    const fresh = await send({ action: "ebayContext" }); // asked again: another product may have been picked
    if (!fresh.success) {
      results.basics = fresh; // the worker is gone (reloaded) or didn't answer
      phase = "done";
      return render();
    }
    ctx = fresh;
    if (ready() && !ctx.listing) {
      phase = "writing";
      render();
      const made = await send({ action: "ebayWriteNow" });
      if (!made.success) {
        found.aiError = [made.code, made.provider, made.error].filter(Boolean).join(" | ");
        results.write = made; // Try again writes it again, then fills
        phase = "done";
        return render();
      }
      ctx = await send({ action: "ebayContext" });
      rows.clear();
      if (ready() && ctx.listing) idleRows();
    }
    if (!ready() || !ctx.listing) {
      phase = "idle";
      return render();
    }
    await reveal();
    if (!(await locate("title", 6000))) {
      results.basics = { code: "noform" };
      phase = "done";
      return render();
    }
    // Show more first, so every item specific is drawn; eBay redraws them for it while the basics are filled.
    if (runs("specifics")) await showAllSpecifics(document);
    if (runs("basics")) results.basics = (await fillBasics()) ? { code: "unfilled" } : true;

    if (runs("specifics")) {
      // Typing the basics makes eBay save the draft and redraw the item specifics about 3 s later; a field read or set
      // before that redraw is lost. So wait for it (when the basics ran) and for the specifics to be still.
      phase = "reading";
      render();
      if (runs("basics")) await redrawn(document, 4500);
      await settled(document);
      const cat = q('button[name="categoryId"]');
      const category = clean(`${cat?.textContent ?? ""} ${cat?.parentElement?.querySelector(".value-secondary")?.textContent ?? ""}`);
      const tried = new Set();
      results.specifics = true;
      // One more look after filling, for fields that weren't on the form the first time: a value can reveal one (Metal
      // reveals Metal Purity). ponytail: one extra pass, not a loop.
      if (await fillSpecifics(category, tried)) {
        await wait(500);
        await fillSpecifics(category, tried);
      }
    }
    phase = "done";
    render();
  }

  // One look at the form's item specifics: the AI is asked about the empty ones that weren't on the form at an earlier
  // look, and what it answers is filled. A failure goes into results.specifics (the first one stays). True when it asked
  // and got an answer (so a second look may find more).
  async function fillSpecifics(category, tried) {
    if (dismissed) return false;
    let { fields } = extractFields(document);
    if (!fields.length && (await settled(document))) ({ fields } = extractFields(document)); // caught mid-redraw
    const open = fields.filter((f) => !f.value && !tried.has(f.name));
    for (const f of fields) tried.add(f.name);
    const failed = (r) => results.specifics === true && (results.specifics = r);
    if (!fields.length) failed({ code: "noform" });
    if (!open.length) return false;
    phase = "asking";
    asking = open.length;
    render();
    const wire = open.map(({ el, block, ...f }) => f); // what leaves the page holds no element
    const plan = await send({ action: "planFill", fields: wire, category });
    const why = plan.success ? plan.aiError : plan;
    if (why) found.aiError = [why.code, why.provider, why.error].filter(Boolean).join(" | "); // for the report
    if (!plan.success) {
      failed(plan);
      for (const s of ctx.listing.specifics ?? []) row(`spec:${s.name}`, s.name, s.value, "copy");
      for (const f of open) if (f.required) row(f.name, f.label, "", "needs", { field: f.el, hint: "Required. Choose a value on eBay." });
      return false;
    }
    if (why) failed(why); // the listing's own specifics were filled, the AI's part failed
    if (!(await applyPlan(open, plan.answers))) failed({ code: "unfilled" });
    return true;
  }

  // True when every answer went into its box.
  async function applyPlan(open, reply) {
    phase = "filling";
    let all = true;
    const byName = new Map(open.map((f) => [f.name, f]));
    const answers = reply.filter((a) => byName.has(a.name)); // the worker has checked these; a name it never sent is skipped anyway
    for (const { name, value } of answers) row(name, byName.get(name).label, value, "pending", { field: byName.get(name).el });
    render();
    // ponytail: three menus in a row that take no value mean the menu mechanism itself fails: the rest are copy rows at once.
    let misses = 0;
    for (const { name, value } of answers) {
      if (dismissed) return all;
      const f = byName.get(name);
      const menu = f.kind === "menu" || f.kind === "multi";
      const give = !menu || misses < 3;
      row(name, f.label, value, give ? "filling" : "copy", { field: f.el });
      render();
      const ok = give && (await fillSpecific(f, value));
      if (menu) misses = ok ? 0 : misses + 1;
      all &&= ok;
      row(name, f.label, value, ok ? "filled" : "copy", { field: f.el });
      render();
    }
    // One more try for what didn't take, once the page is quiet: a redraw mid-way loses a click, not the value.
    const missed = answers.filter(({ name }) => rows.get(name)?.status === "copy");
    if (missed.length && !dismissed) {
      await wait(800);
      all = true;
      for (const { name, value } of missed) {
        const f = byName.get(name);
        const ok = await fillSpecific(f, value);
        all &&= ok;
        row(name, f.label, value, ok ? "filled" : "copy", { field: f.el });
        render();
      }
      const left = missed.filter(({ name }) => rows.get(name)?.status === "copy").map(({ name }) => byName.get(name));
      if (left.length) send({ action: "diagFill", fields: left.map((f) => ({ label: f.label, kind: f.kind, custom: f.custom, listed: f.options.length })) });
    }
    for (const f of open) if (f.required && !rows.has(f.name)) row(f.name, f.label, "", "needs", { field: f.el, hint: "Required. Choose a value on eBay." });
    return all;
  }

  /* Listed: the product becomes Listed only after eBay says it is published. The confirmation page is recognised by its words,
     an item link, and the product's own SKU or title on it (so another listing's page never counts). When eBay words that
     page differently, the status is set on the dashboard. Unverified on live eBay. */

  async function markListed() {
    const res = await send({ action: "ebayListed" });
    if (!ui || !res.success) return;
    notice = { tone: "info", text: "Marked as Listed on the dashboard." };
    render();
  }

  let published = false;
  async function watchPublished() {
    if (published || dismissed || q('input[name="title"]')) return; // the form itself is not a confirmation
    const body = document.body?.innerText ?? "";
    if (!/(your (item|listing) (is|has been) (now )?(live|listed|published)|(listing|item) (is )?(now )?live|successfully listed|congratulations)/i.test(body) || !q('a[href*="/itm/"]')) return;
    const { target, listing } = await send({ action: "ebayContext" });
    const mine = [target?.sku, (listing?.title ?? target?.title ?? "").slice(0, 30)].filter((x) => x && x.length > 3);
    if (!mine.some((x) => body.toLowerCase().includes(x.toLowerCase()))) return;
    published = true;
    await markListed();
  }
  setInterval(watchPublished, 3000);

  /* Add from AliExpress: a button under eBay's "Upload from computer" opens a window with the picked product's photos. The
     ones the seller picks are saved to a folder in Downloads by the worker, to drag into eBay's photo box from there. */

  let photos = null; // the window's parts once built: { host, dialog, grid, variants, ... }

  // eBay draws its photo box late and may draw it again, so the button is put back whenever it is missing.
  // ponytail: a one-second look; a MutationObserver if a redraw ever leaves it missing for long enough to matter.
  function placePhotoButton() {
    if (dismissed || !location.pathname.startsWith("/lstng")) return;
    // eBay's box: <div class="upload-buttons"> holds the icon, "Drag and drop files" and <div class="upload-buttons__buttons">
    // with the Upload from computer button (seen live, 2026-10-18). The new button goes under that row.
    const words = document.evaluate("//button[normalize-space(.)='Upload from computer']", document.body, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    const upload = document.querySelector(".upload-buttons__buttons") ?? words;
    if (!upload) return;
    // eBay redraws the box and may keep the old button somewhere else: it must sit right under the row, else it is put back.
    const mine = document.getElementById("aliswift-photo-btn");
    if (mine?.previousElementSibling === upload) return;
    mine?.remove();
    const btn = h("button", { type: "button", class: "ali-ae-btn" }, icon(PATH.bolt, "", 16), "Add from AliExpress");
    aeDone = h("p", { class: "ali-ae-done", role: "status", hidden: true });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation(); // the photo box opens the file picker on a click anywhere in it
      openPhotos();
    });
    const host = shadowHost("aliswift-photo-btn", h("div", { class: "ali-ae-wrap" }, btn, aeDone));
    host.style.cssText += ";display:block;margin-top:12px;text-align:center";
    upload.after(host);
  }
  setInterval(placePhotoButton, 1000);

  // The one line under the button once photos were saved: "Downloaded 3 images", with a tick. It fades away after a while.
  let aeDone;
  let aeTimer;
  function showDone(text) {
    if (!aeDone) return;
    clearTimeout(aeTimer);
    aeDone.replaceChildren(icon(PATH.check, "", 14), text);
    aeDone.hidden = false;
    requestAnimationFrame(() => aeDone.toggleAttribute("data-shown", true));
    aeTimer = setTimeout(() => aeDone.removeAttribute("data-shown"), 8000);
  }

  // How many photos the form holds: its "3/25" counter, else its thumbnails.
  const onForm = () => Number(/(\d+)\s*\//.exec(q(".uploader-thumbnails-ux__header__photo-count")?.textContent ?? "")?.[1] ?? photoCount(document));

  // The saved photos go onto the listing too: the worker hands each one over at full size (the page cannot read
  // AliExpress's image host), and they are given to eBay's file box, else dropped on its drop zone, the way a seller's own
  // files are. True when the form's count went up.
  async function attachPhotos(urls) {
    const got = await Promise.all(urls.map((url) => send({ action: "ebayThumb", url, full: true })));
    const files = got
      .map((res) => res.success && res.image)
      .filter(Boolean)
      .map(({ mime, data }, i) => new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], `img-${String(i + 1).padStart(2, "0")}.${mime.split("/")[1].replace("jpeg", "jpg")}`, { type: mime }));
    if (!files.length) return false;
    const input = photoBox(document);
    const zone = photoZone(document);
    for (const give of [input && (() => giveFiles(input, files)), zone && (() => dropFiles(zone, files))].filter(Boolean)) {
      const before = onForm();
      give();
      if (await until(() => onForm() > before, 12000)) return true;
    }
    return false;
  }

  const pickedUrls = () => [...photos.dialog.querySelectorAll('.ali-ph[aria-pressed="true"]')].map((b) => b.dataset.url);

  // One photo tile: pressed means picked. Its small copy is fetched by the worker and fades in when it arrives.
  function photoTile(url, picked, name) {
    const img = h("img", { alt: name ?? "", draggable: "false" });
    const tile = h("button", { type: "button", class: "ali-ph", "aria-pressed": String(picked), "aria-label": name ?? "Product photo", "data-url": url }, img, h("span", { class: "ali-ph-check" }, icon(PATH.check, "", 14)));
    tile.addEventListener("click", () => {
      tile.setAttribute("aria-pressed", String(tile.getAttribute("aria-pressed") !== "true"));
      photoCounts();
    });
    send({ action: "ebayThumb", url }).then((res) => {
      const pic = res.success && res.image;
      if (!pic || !photos) return tile.classList.add("ali-ph-none");
      const bytes = Uint8Array.from(atob(pic.data), (c) => c.charCodeAt(0));
      img.src = URL.createObjectURL(new Blob([bytes], { type: pic.mime }));
      photos.blobs.push(img.src);
      img.addEventListener("load", () => img.toggleAttribute("data-loaded", true), { once: true });
      img.addEventListener("error", () => tile.classList.add("ali-ph-none"), { once: true }); // the page may refuse blob: images
    });
    return h("li", {}, tile, name && h("span", { class: "ali-ph-name", text: name }));
  }

  // The words that follow the picks: how many, where they go, and what the Download button says.
  function photoCounts() {
    const n = pickedUrls().length;
    const all = photos.dialog.querySelectorAll(".ali-ph").length;
    photos.count.textContent = `${n} of ${all} picked`;
    photos.toggleAll.textContent = n === all ? "Select none" : "Select all";
    const dir = photos.folder.value.trim().replace(/[\\/]+$/, "") || photos.defaultFolder;
    photos.where.textContent = photos.sort.checked
      ? `Saves to Downloads\\${dir}\\${photos.sku}\\, each variant in a folder of its own.`
      : `Saves straight into Downloads\\${dir}\\, each file named after ${photos.sku}.`;
    photos.save.textContent = n ? `Download ${n} ${n === 1 ? "photo" : "photos"}` : "Download";
    photos.save.disabled = !n || !photos.allowed;
  }

  function buildPhotos() {
    const close = () => photos.dialog.close();
    photos = {
      blobs: [],
      title: h("p", { class: "dialog-sub" }),
      count: h("span"),
      toggleAll: h("button", { type: "button", class: "btn btn-quiet btn-sm" }),
      grid: h("ul", { class: "ali-ph-grid", role: "list" }),
      variants: h("ul", { class: "ali-ph-grid", role: "list" }),
      folder: h("input", { type: "text", "aria-label": "Folder in Downloads", spellcheck: "false", maxlength: "180" }),
      sort: h("input", { type: "checkbox" }),
      where: h("p", { class: "ali-hint" }),
      note: h("div", { class: "notice", role: "status", hidden: true }),
      save: h("button", { type: "button", class: "btn" }),
    };
    photos.variantsHead = h("h3", { class: "ali-ph-head", text: "Variants" });
    photos.dialog = h(
      "dialog",
      { class: "ali-photos", "aria-labelledby": "ali-ph-title" },
      h(
        "form",
        { onsubmit: (e) => e.preventDefault() },
        h("div", { class: "dialog-head", "data-close": "" }, h("div", {}, h("h2", { id: "ali-ph-title", text: "Add from AliExpress" }), photos.title), h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: close }, icon(PATH.close))),
        h(
          "div",
          { class: "dialog-body" },
          h("div", { class: "ali-ph-bar" }, photos.count, photos.toggleAll),
          photos.grid,
          photos.variantsHead,
          photos.variants,
          h("div", { class: "ali-ph-save" }, h("label", { class: "ali-ph-label", text: "Save to" }), h("div", { class: "ali-ph-path" }, h("span", { text: "Downloads\\" }), photos.folder), h("label", { class: "inline" }, photos.sort, "Auto-sort downloads"), photos.where),
          photos.note,
        ),
        h("div", { class: "dialog-foot actions" }, h("button", { type: "button", class: "btn btn-quiet", text: "Cancel", onclick: close }), photos.save),
      ),
    );
    photos.toggleAll.addEventListener("click", () => {
      const all = photos.toggleAll.textContent === "Select all";
      for (const t of photos.dialog.querySelectorAll(".ali-ph")) t.setAttribute("aria-pressed", String(all));
      photoCounts();
    });
    for (const el of [photos.folder, photos.sort]) el.addEventListener("input", photoCounts);
    photos.save.addEventListener("click", savePicked);
    photos.dialog.addEventListener("close", () => {
      for (const src of photos.blobs.splice(0)) URL.revokeObjectURL(src);
    });
    photos.host = mountPanel("aliswift-photos", photos.dialog);
  }

  function photoNote(tone, text, fix) {
    photos.note.hidden = !text;
    photos.note.dataset.tone = tone;
    photos.note.replaceChildren(icon(tone === "error" ? PATH.error : tone === "ok" ? PATH.check : PATH.warn, "", 16), h("div", { text }));
    if (fix) photos.note.append(h("button", { type: "button", class: "btn btn-quiet btn-sm", text: "Open settings", onclick: openSettings }));
  }

  async function openPhotos() {
    if (!photos) buildPhotos();
    const res = await send({ action: "ebayPhotoList" });
    photos.grid.replaceChildren();
    photos.variants.replaceChildren();
    photoNote("", "");
    photos.save.hidden = false;
    if (!res.success) {
      photos.title.textContent = "";
      photos.allowed = false;
      photos.sku = "";
      photos.defaultFolder = "AliSwift";
      photoNote("warn", res.error ?? "Couldn't read this product's photos.");
      photoCounts();
      return photos.dialog.showModal();
    }
    Object.assign(photos, { allowed: res.allowed, sku: res.sku, defaultFolder: res.defaultFolder });
    photos.title.textContent = `${res.sku}: pick the photos to save to your computer.`;
    photos.grid.append(...res.photos.map((url) => photoTile(url, true)));
    photos.variants.append(...res.variants.map((v) => photoTile(v.url, false, v.name)));
    photos.variantsHead.hidden = photos.variants.hidden = !res.variants.length;
    photos.folder.value = res.folder || res.defaultFolder;
    photos.sort.checked = res.sort;
    if (!res.allowed) photoNote("warn", "Allow downloads in AliSwift settings first (General tab), then open this again.", true);
    photoCounts();
    photos.dialog.showModal();
    // The tiles arrive one after another.
    [...photos.dialog.querySelectorAll(".ali-ph-grid > li")].slice(0, 16).forEach((li, i) =>
      li.animate([{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "none" }], { duration: 300, delay: 60 + i * 30, easing: EASE, fill: "backwards" }),
    );
  }

  async function savePicked() {
    const urls = pickedUrls();
    const folder = photos.folder.value.trim();
    photos.save.dataset.state = "loading";
    photos.save.disabled = true;
    const res = await send({ action: "ebayPhotosSave", urls, folder: folder === photos.defaultFolder ? "" : folder, sort: photos.sort.checked });
    delete photos.save.dataset.state;
    if (!res.success) {
      photoNote("error", res.error ?? "The photos couldn't be saved.", res.code === "permission");
      return photoCounts();
    }
    photos.dialog.close();
    const words = `Downloaded ${res.saved} ${res.saved === 1 ? "image" : "images"}`;
    showDone(`${words}, adding to the listing...`);
    showDone((await attachPhotos(urls)) ? words : `${words}. Drag them into the photo box.`);
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
