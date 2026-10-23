// Runs on AliExpress product pages. Depends on lib/shared.js and lib/errors.js (loaded first by the manifest).

reportCrashes();

const PRICE_SELECTORS = [
  '[class*="price-default--current"]',
  '[class*="price--current"]',
  ".uniform-banner-box-price",
];
const SHIPPING_SELECTORS = [
  '[class*="shipping-cost"]',
  '[class*="shippingCost"]',
  '[class*="logistics-cost"]',
  '[class*="dynamic-shipping"]',
];
// Where a click saves: "sheet", or "local" (the on-device library) when signed out or without a sheet.
// authState is asked on inject and when the tab becomes visible; the library lives in storage a page can't read.
const LABELS = { sheet: "Add to Sheet", local: "Save to library" };
const REMOVE = { sheet: "Remove from Sheet", local: "Remove from library" };
let dest = "sheet";
let inSheet = false; // the product on this page is saved where a click goes: the first button removes it
let sheetName = ""; // the active sheet's name, for the messages ("SKU-04 added to sheet Store")
let confirmUntil = 0; // Remove's second click counts until then
let resetTimer;
let recheck; // a look at the sheet that failed is tried again, a few times

// A page left open while the extension reloads or updates is cut off from it: sendMessage then throws at once (a .catch on
// its promise doesn't see that), so every ask goes through here and gets null.
const ask = (message) => {
  try {
    return chrome.runtime.sendMessage(message).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
};

// Where a click saves, and whether the product is already there (the sheet's own word, through the worker's index, so
// it is right even after a row was deleted by hand).
async function refreshDest(attempt = 0) {
  clearTimeout(recheck);
  const state = await ask({ action: "authState" });
  if (!state) return; // the worker didn't answer: keep what is known
  const sheet = await getActiveSheet();
  dest = destination(state.signedIn, sheet);
  sheetName = sheet?.name ?? "";
  const found = await ask({ action: "inSheet", link: getLink(), dest });
  // A look that failed (Google busy, offline) says nothing about the product: the button keeps its state and asks again,
  // else a product that is in the sheet would be offered for adding.
  if (found?.success) inSheet = Boolean(found.inSheet);
  else if (attempt < 3) recheck = setTimeout(() => refreshDest(attempt + 1), 3000 * (attempt + 1));
  const btn = document.getElementById("aliswift-page-btn");
  if (btn && !btn.dataset.state) showLabel(btn); // never over a Saving... or result text
}

function showLabel(btn) {
  btn.textContent = (inSheet ? REMOVE : LABELS)[dest];
  btn.dataset.mode = inSheet ? "remove" : "add";
}

// First number found in the first matching element, with the text it came from (the currency is read
// from that text). Text matching `ignore` (e.g. "Free shipping over $10") counts as 0 instead of a price.
function firstNumber(selectors, ignore) {
  for (const sel of selectors) {
    const text = document.querySelector(sel)?.textContent ?? "";
    if (ignore?.test(text)) return { n: 0, text };
    const n = parsePrice(text);
    if (!Number.isNaN(n)) return { n, text };
  }
  return { n: NaN, text: "" };
}

function getTitle(maxWords, excludeKeywords) {
  const title = document.querySelector('h1[data-pl="product-title"]')?.textContent ?? "";
  const excluded = excludeKeywords
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  return title
    .split(/\s+/)
    .filter((w) => w && !excluded.includes(w.toLowerCase()))
    .slice(0, maxWords)
    .join(" ");
}

// The product photo: the page's share image (og:image / twitter:image / structured data) or primary gallery photo.
function getImage() {
  const meta =
    document.querySelector('meta[property="og:image"]')?.content ||
    document.querySelector('meta[name="og:image"]')?.content ||
    document.querySelector('meta[property="twitter:image"]')?.content ||
    document.querySelector('meta[name="twitter:image"]')?.content ||
    document.querySelector('link[rel="image_src"]')?.href;
  const fromMeta = httpsUrl(meta, location.href);
  if (fromMeta) return fullSizePhoto(fromMeta);

  for (const s of document.querySelectorAll?.('script[type="application/ld+json"]') ?? []) {
    try {
      const data = JSON.parse(s.textContent || "");
      const items = Array.isArray(data) ? data : [data];
      for (const it of items) {
        const raw = it?.image || (it?.["@type"] === "Product" && it?.image);
        const list = Array.isArray(raw) ? raw : [raw];
        for (const r of list) {
          const u = httpsUrl(typeof r === "string" ? r : r?.url, location.href);
          if (u) return fullSizePhoto(u);
        }
      }
    } catch {}
  }

  const mainSel = '[class*="magnifier"] img, [class*="image-view"] img, [class*="slider--img"] img, [class*="slider--wrap"] img, [class*="gallery"] img, [data-pl="product-image"] img, [class*="sku-item--image"] img';
  for (const img of document.querySelectorAll?.(mainSel) ?? []) {
    const src = img.currentSrc || img.src || img.getAttribute?.("data-src") || img.getAttribute?.("src");
    const u = httpsUrl(src, location.href);
    if (u) return fullSizePhoto(u);
  }

  for (const img of document.querySelectorAll?.("img") ?? []) {
    const src = img.currentSrc || img.src || img.getAttribute?.("data-src") || img.getAttribute?.("src");
    if (src && /alicdn\.com|aliexpress-media\.com/i.test(src) && /\/kf\//.test(src)) {
      const u = httpsUrl(src, location.href);
      if (u) return fullSizePhoto(u);
    }
  }

  return "";
}

function getLink() {
  const url = location.href;
  return url.match(/^(https:\/\/.+?\.html)/)?.[1] ?? url;
}

// What the listing writer is given besides the sheet's short name: the page's full title, its specifications, its
// photos (the share image first, then the gallery's, at full size) and its summary. Whatever a page does not have
// is left out; the worker caps and cleans all of it. Read on a click only, never for the popup.
// ponytail: the specification and gallery class names are AliExpress's today; when they change this finds less and
// the listing is written from the title and the first photo, as before.
function getDetails() {
  const all = (sel) => [...(document.querySelectorAll?.(sel) ?? [])];
  const pick = (el, sel) => el.querySelector(sel)?.textContent ?? "";
  // The options that have a photo of their own (a colour or a style), one per picture in a property block: its name is the
  // picture's alt text, its property ("Color") the part of the block's title before the colon. Size and other text-only
  // options have no picture, so they are not here. Nothing is clicked: the page keeps the seller's own choice.
  const variants = all('[class*="sku-item--property"]').flatMap((prop) => {
    const group = pick(prop, '[class*="sku-item--title"]').split(":")[0].trim();
    return [...prop.querySelectorAll('[class*="sku-item--image"] img')].map((img) => ({ group, name: (img.alt || img.title || "").trim(), image: fullSizePhoto(img.src) }));
  });
  // Every choice the buyer has (sizes, colours, styles), with or without a photo: { name: "Ring Size", choices: ["6", "7"] }.
  // The listing writer needs them: "Main Stone Color: Red" is a fact the specifications may not hold.
  const options = all('[class*="sku-item--property"]').map((prop) => ({
    name: pick(prop, '[class*="sku-item--title"]').split(":")[0].trim(),
    choices: [...prop.querySelectorAll('[class*="sku-item--image"] img, [class*="sku-item--text"]')].map((el) => (el.alt || el.title || el.textContent || "").trim()),
  }));
  const specs = all('[class*="specification--prop"]').slice(0, 50).map((p) => [pick(p, '[class*="specification--title"]'), pick(p, '[class*="specification--desc"]')]);
  const gallery = all('[class*="slider--img"] img, [class*="image-view"] img, [class*="slider--wrap"] img').map((img) => fullSizePhoto(img.src));
  return {
    fullTitle: document.querySelector('h1[data-pl="product-title"]')?.textContent ?? "",
    specs,
    description: document.querySelector('meta[name="description"]')?.content ?? "",
    images: [...new Set([getImage(), ...gallery].filter(Boolean))],
    variants,
    options,
  };
}

// The pieces of the page that hold a price: a leaf element whose text has a currency mark and a number, with its
// font size, whether it is struck through and the words around it. What the AI fallback is asked to choose from.
function priceCandidates() {
  const found = [];
  const mark = /(?:US\s?\$|[$£€₽]|\b[A-Z]{3}\b)\s?\d[\d.,]*|\d[\d.,]*\s?(?:[$£€₽]|\b[A-Z]{3}\b)/;
  for (const el of document.querySelectorAll?.("span,div,b,strong,p") ?? []) {
    const text = (el.childElementCount ? "" : el.textContent ?? "").trim();
    if (!text || text.length > 40 || !mark.test(text) || !el.offsetParent) continue;
    const style = getComputedStyle(el);
    found.push({
      text, size: parseFloat(style.fontSize) || 0, struck: /line-through/.test(style.textDecorationLine) || /line-through/.test(getComputedStyle(el.parentElement).textDecorationLine),
      near: (el.parentElement?.textContent ?? "").trim().slice(0, 100),
    });
    if (found.length >= 40) break;
  }
  return found;
}

// The AI fallback: when the price selectors above find nothing (AliExpress changed its page), Gemini is shown the
// price-looking pieces and points at the price and the shipping. Only the page's own text comes back out of this.
async function aiPrices() {
  const candidates = priceCandidates();
  if (!candidates.length) return null;
  const title = document.querySelector('h1[data-pl="product-title"]')?.textContent ?? document.title;
  const res = await ask({ action: "aiMap", task: "product", items: { title, candidates } });
  const a = res?.success ? res.answer : null;
  const price = candidates[a?.price];
  if (!price || !(parsePrice(price.text) > 0)) return null;
  const shipping = candidates[a.shipping];
  return { price: { n: parsePrice(price.text), text: price.text }, shipping: a.freeShipping || !shipping ? 0 : parsePrice(shipping.text) || 0 };
}

// The product on the page. `currency` is what price and salePrice are in ("" when the page's currency is
// unknown); `kind` says how the page relates to the sheet (see currencyKind). When the page's currency is not
// the sheet's, `fx` holds the raw amounts and the rate. With no rate (fx.rate null: the live rate couldn't
// be fetched) price is the raw page amount and nothing may be saved. For the library (`where` is "local") there is no
// sheet to compare with: prices stay as shown (cost = price + shipping, no sell price), with their currency, and
// are converted and priced by the sheet's own rules when the product is moved to a sheet.
async function scrapeRow(where = dest) {
  const sheet = (await getActiveSheet()) ?? SHEET_DEFAULTS;
  const row = {
    title: getTitle(sheet.titleLength, sheet.excludeKeywords),
    link: getLink(),
    image: getImage(),
    price: "",
    salePrice: "",
    currency: "",
    kind: "unknown",
  };
  let { n: price, text } = firstNumber(PRICE_SELECTORS);
  let shipping = firstNumber(SHIPPING_SELECTORS, /free/i).n || 0;
  if (!(price > 0)) {
    const found = await aiPrices();
    if (found) {
      price = found.price.n;
      text = found.price.text;
      shipping = found.shipping;
    }
  }
  if (price > 0) {
    const from = detectCurrency(document.cookie, text, document.documentElement.lang);
    const to = where === "local" ? "" : (REGIONS[sheet.region]?.currency ?? "");
    row.kind = currencyKind(from, to);
    let rate = 1;
    if (row.kind === "convert") {
      const found = await ask({ action: "rate", data: { from, to } });
      rate = found?.rate || null;
      row.fx = { from, to, price, shipping, rate, source: found?.source, at: found?.at };
    }
    // Pricing runs in the sheet's currency: extraCost and the formula are written for it.
    if (rate && where !== "local") Object.assign(row, priceProduct(price / rate, shipping / rate, sheet));
    else row.price = (price + shipping).toFixed(2);
    row.currency = row.kind === "same" || (row.kind === "convert" && rate) ? to : from;
  }
  return row;
}

/* The two buttons: Add to Sheet, which is Remove from Sheet while the product is in the sheet (the worker writes its
   listing in the background a few minutes after an add), and Download Photos (gallery and variant images to a folder).
   What a failure says comes from lib/errors.js. */

const ACTIONS = {
  add: { id: "aliswift-page-btn", busy: { sheet: "Adding...", local: "Saving..." }, done: "Added" },
  download: { id: "aliswift-dl-btn", busy: { sheet: "Saving...", local: "Saving..." }, done: "Saved", icon: true },
};
const STEPS = { add: "add", download: "download" };

// A failed reply's sentence: lib/errors.js's for its code; one with no code is the worker's or this page's own sentence.
const failText = (result, step) => (result?.code ? errorView({ step, ...result }).text : result?.error ?? errorView({ step }).text);
const buttons = () => Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, document.getElementById(a.id)]));
const note = (text, tone = "") => {
  const el = document.getElementById("aliswift-note");
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = tone;
};

function setState(btn, state, text) {
  btn.dataset.state = state;
  if (!btn.dataset.icon) btn.textContent = text;
  btn.disabled = state === "loading";
}

// "converted to £4.77", ". Currency unknown." and the like: what the saved price needs said about it.
function priceNote(row) {
  if (row.fx) {
    const symbol = Object.values(REGIONS).find((r) => r.currency === row.fx.to)?.symbol ?? `${row.fx.to} `;
    return `, converted to ${symbol}${row.price}`;
  }
  return row.kind === "unset" ? `, ${row.currency}` : row.kind === "unknown" ? ". Currency unknown." : "";
}

const whereIs = (where) => (where === "local" ? "your library" : sheetName ? `sheet ${sheetName}` : "your sheet");

// Where a product went, in words: "SKU-04 added to sheet Store", "SKU-04 saved to your library", or "SKU-04 is already in
// sheet Store" (with `existed`).
function placed(sku, where, existed) {
  const name = whereIs(where);
  const what = sku || (existed ? "This product" : "Product");
  return existed ? `${what} is already in ${name}` : `${what} ${where === "local" ? "saved to" : "added to"} ${name}`;
}

// Remove asks for a second click, saying first when an order uses the product's SKU; the second click clears the
// product's cells in the sheet (or takes it out of the library).
let removeSku = ""; // the SKU the first click found, for the message after the second
async function remove(btn) {
  const place = whereIs(dest);
  if (Date.now() > confirmUntil) {
    btn.disabled = true;
    const check = dest === "local" ? null : await ask({ action: "removeCheck", link: getLink(), dest });
    removeSku = check?.sku ?? "";
    confirmUntil = Date.now() + 6000;
    setState(btn, "confirm", "Click again to remove");
    const warn = check?.orderSku ? `An order uses ${check.orderSku}. Removing this product can mix up records later. Remove anyway?` : "";
    note(warn || `Click again to remove ${removeSku || "it"} from ${place}.`, warn ? "error" : "");
    resetTimer = setTimeout(reset, 6000);
    return;
  }
  confirmUntil = 0;
  setState(btn, "loading", "Removing...");
  const result = (await ask({ action: "removeFromSheet", link: getLink(), dest })) ?? { code: "reloaded" };
  if (result.success) inSheet = false;
  setState(btn, result.success ? "success" : "error", result.success ? "Removed" : "Try again");
  note(result.success ? `${removeSku || "Product"} removed from ${place}.` : failText(result, "remove"), result.success ? "ok" : "error");
  resetTimer = setTimeout(() => (reset(), refreshDest()), result.success ? 3500 : 6000);
}

async function run(kind) {
  clearTimeout(resetTimer);
  if (kind === "add" && inSheet) return remove(buttons().add);
  const action = ACTIONS[kind];
  const all = buttons();
  const btn = all[kind];
  const where = dest;
  for (const b of Object.values(all)) if (b) b.disabled = true;
  setState(btn, "loading", action.busy[where]);
  note(kind === "download" ? "Downloading photos..." : "");
  let result;
  let row = {};
  try {
    if (kind === "download") {
      const details = getDetails();
      const title = document.querySelector('h1[data-pl="product-title"]')?.textContent ?? "";
      const image = getImage() || details.images?.[0] || "";
      result = await chrome.runtime.sendMessage({ action: "downloadPhotos", data: { link: getLink(), image, title, details, dest: where } });
    } else {
      row = await scrapeRow(where);
      const { title, price, salePrice, link, currency, image } = row;
      if (!title || !price) result = { error: "Couldn't read this product. Reload the page." };
      else if (row.fx && !row.fx.rate) {
        result = { error: `Prices are ${row.fx.from}, sheet is ${row.fx.to}. Set a rate in the popup.` };
      } else {
        const details = getDetails();
        const finalImage = image || details.images?.[0] || details.variants?.[0]?.image || "";
        result = await chrome.runtime.sendMessage({
          action: "appendToSheet",
          data: { title, price, salePrice, link, currency, image: finalImage, dest: where, details },
        });
      }
    }
  } catch (e) {
    result = /context invalidated/i.test(e.message) ? { code: "reloaded" } : { error: e.message };
  }

  let message;
  if (result?.success) {
    setState(btn, "success", action.done);
    if (kind === "download") {
      message = `Saved ${result.saved} of ${result.total} photo${result.total === 1 ? "" : "s"} to ${result.folder}.`;
    } else {
      inSheet = true;
      sheetName = (await getActiveSheet())?.name ?? sheetName;
      message = `${placed(result.sku, where, result.existed)}${result.existed ? "." : priceNote(row)}`;
    }
  } else if (result?.code === "permission") {
    setState(btn, "error", "Permission");
    const el = document.getElementById("aliswift-note");
    if (el) {
      el.textContent = "";
      el.dataset.tone = "error";
      const span = document.createElement("span");
      span.textContent = `${errorView({ step: "download", code: "permission" }).text} `;
      const link = document.createElement("button");
      link.type = "button";
      link.textContent = "Open Settings to Allow";
      link.className = "aliswift-note-link";
      link.onclick = () => chrome.runtime.sendMessage({ action: "openOptions", tab: "general" });
      el.append(span, link);
    }
    for (const b of Object.values(all)) if (b) b.disabled = false;
    resetTimer = setTimeout(() => reset(), 10000);
    return;
  } else if (result?.code === "signin") {
    dest = "local";
    setState(btn, "error", "Signed out");
    message = "Signed out. Click again to save to your library.";
  } else {
    setState(btn, "error", "Try again");
    message = failText(result ?? { code: "reloaded" }, STEPS[kind]);
  }
  for (const b of Object.values(all)) if (b) b.disabled = false;
  note(message, result?.success ? "ok" : "error");
  resetTimer = setTimeout(() => reset(), result?.success ? 3500 : 6000);
}

// All buttons back to their words, and the note emptied.
function reset() {
  const all = buttons();
  confirmUntil = 0;
  if (all.add) {
    setState(all.add, "", "");
    showLabel(all.add);
  }
  if (all.download) setState(all.download, "", "");
  note("");
}

function injectButton() {
  if (document.getElementById("aliswift-bar")) return true;
  const wrapper = document.querySelector('[class*="action--stickyWrap"]');
  if (!wrapper) return false;

  const bar = document.createElement("div");
  bar.id = "aliswift-bar";
  bar.className = "aliswift-bar";
  const row = document.createElement("div");
  row.className = "aliswift-row";
  for (const kind of Object.keys(ACTIONS)) {
    const btn = document.createElement("button");
    btn.id = ACTIONS[kind].id;
    btn.type = "button";
    if (kind === "download") {
      btn.className = "aliswift-btn aliswift-btn-dl";
      btn.dataset.icon = "1";
      btn.setAttribute("aria-label", "Download photos");
      // Download/image icon (Material: file_download)
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "18");
      svg.setAttribute("height", "18");
      svg.setAttribute("fill", "currentColor");
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z");
      svg.append(path);
      btn.append(svg);
    } else {
      btn.className = "aliswift-btn";
      showLabel(btn);
    }
    // A click the page's own script makes (element.click()) is not the seller's: it must not save, write or open anything.
    btn.addEventListener("click", (e) => e.isTrusted && run(kind));
    row.append(btn);
  }
  const status = document.createElement("p");
  status.id = "aliswift-note";
  status.className = "aliswift-note";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  bar.append(row, status);
  wrapper.prepend(bar);
  refreshDest();
  return true;
}

let injectTimer;

function showButton(show) {
  clearInterval(injectTimer);
  if (!show) return document.getElementById("aliswift-bar")?.remove();
  // The page renders late: retry every 500ms for up to 10 seconds.
  let attempts = 0;
  injectTimer = setInterval(() => {
    if (injectButton() || ++attempts >= 20) clearInterval(injectTimer);
  }, 500);
}

chrome.storage.sync.get({ showPageButton: true }, ({ showPageButton }) => showButton(showPageButton));

// The settings page toggles the button without a page reload.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.showPageButton) showButton(changes.showPageButton.newValue ?? true);
});

document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshDest());

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== "scrape") return;
  // The popup saves what it shows, with the details the listing writer uses (read here, where the page is).
  scrapeRow(request.dest).then((row) => {
    const details = getDetails();
    const image = row.image || details.images?.[0] || details.variants?.[0]?.image || "";
    sendResponse({ ...row, image, details });
  });
  return true;
});
