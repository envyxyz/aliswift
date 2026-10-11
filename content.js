// Runs on AliExpress product pages. Depends on lib/shared.js (loaded first by the manifest).

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
let dest = "sheet";
let resetTimer;

async function refreshDest() {
  const state = await chrome.runtime.sendMessage({ action: "authState" }).catch(() => null);
  if (!state) return; // the worker didn't answer: keep what is known
  dest = destination(state.signedIn, await getActiveSheet());
  const btn = document.getElementById("aliswift-page-btn");
  if (btn && !btn.dataset.state) btn.textContent = LABELS[dest]; // never over a Saving... or result text
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

// The product photo: the page's share image. ponytail: AliExpress's own gallery selectors are not verified, so only this is read.
function getImage() {
  return httpsUrl(document.querySelector('meta[property="og:image"]')?.content, location.href);
}

function getLink() {
  const url = location.href;
  return url.match(/^(https:\/\/.+?\.html)/)?.[1] ?? url;
}

// The product on the page. `currency` is what price and salePrice are in ("" when the page's currency is
// unknown); `kind` says how the page relates to the sheet (see currencyKind). When the page's currency is not
// the sheet's, `fx` holds the raw amounts and the rate. With no rate (fx.rate null) price is the raw page
// amount and nothing may be saved until the user supplies one. For the library (`where` is "local") there is no
// sheet to compare with: prices stay as shown, with their currency, and are converted if the product is moved to a sheet.
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
  const { n: price, text } = firstNumber(PRICE_SELECTORS);
  if (price > 0) {
    const shipping = firstNumber(SHIPPING_SELECTORS, /free/i).n || 0;
    const from = detectCurrency(document.cookie, text, document.documentElement.lang);
    const to = where === "local" ? "" : (REGIONS[sheet.region]?.currency ?? "");
    row.kind = currencyKind(from, to);
    let rate = 1;
    if (row.kind === "convert") {
      const found = await chrome.runtime.sendMessage({ action: "rate", data: { sheetId: sheet.id, from, to } }).catch(() => null);
      rate = found?.rate || null;
      row.fx = { from, to, price, shipping, rate, source: found?.source, at: found?.at };
    }
    // Pricing runs in the sheet's currency: extraCost and the formula are written for it.
    if (rate) Object.assign(row, priceProduct(price / rate, shipping / rate, sheet));
    else row.price = (price + shipping).toFixed(2);
    row.currency = row.kind === "same" || (row.kind === "convert" && rate) ? to : from;
  }
  return row;
}

function setState(btn, state, text) {
  btn.dataset.state = state;
  btn.textContent = text;
  btn.disabled = state === "loading";
}

async function save(btn) {
  clearTimeout(resetTimer);
  const where = dest;
  setState(btn, "loading", where === "local" ? "Saving..." : "Adding...");
  let result;
  let row = {};
  try {
    row = await scrapeRow(where);
    const { title, price, salePrice, link, currency, image } = row;
    if (!title || !price) result = { error: "Couldn't read this product. Reload the page." };
    else if (row.fx && !row.fx.rate) {
      result = { error: `Prices are ${row.fx.from}, sheet is ${row.fx.to}. Set a rate in the popup.` };
    } else result = await chrome.runtime.sendMessage({ action: "appendToSheet", data: { title, price, salePrice, link, currency, image, dest: where } });
  } catch (e) {
    result = { error: e.message };
  }
  if (result?.success && where === "local") {
    setState(btn, "success", result.sku ? `Saved to library as ${result.sku}` : "Saved to library");
  } else if (result?.success) {
    const symbol = row.fx && (Object.values(REGIONS).find((r) => r.currency === row.fx.to)?.symbol ?? `${row.fx.to} `);
    const note = row.fx
      ? `, converted to ${symbol}${row.price}`
      : row.kind === "unset"
        ? `, ${row.currency}`
        : row.kind === "unknown"
          ? ". Currency unknown."
          : "";
    setState(btn, "success", (result.sku ? `Added as ${result.sku}` : "Added") + note);
  } else if (result?.code === "signin") {
    // The label was stale: signed out here or elsewhere. Nothing was written; the next click saves to the library.
    dest = "local";
    setState(btn, "error", "Signed out. Click again to save to your library.");
  } else {
    setState(btn, "error", result?.error ?? "Something went wrong");
  }
  resetTimer = setTimeout(() => setState(btn, "", LABELS[dest]), result?.success ? 3000 : 4000); // long enough to read the SKU
}

function injectButton() {
  if (document.getElementById("aliswift-page-btn")) return true;
  const wrapper = document.querySelector('[class*="action--stickyWrap"]');
  if (!wrapper) return false;

  const btn = document.createElement("button");
  btn.id = "aliswift-page-btn";
  btn.className = "aliswift-btn";
  btn.type = "button";
  btn.setAttribute("aria-live", "polite");
  btn.textContent = LABELS[dest];
  btn.addEventListener("click", () => save(btn));
  wrapper.prepend(btn);
  refreshDest();
  return true;
}

let injectTimer;

function showButton(show) {
  clearInterval(injectTimer);
  if (!show) return document.getElementById("aliswift-page-btn")?.remove();
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
  scrapeRow(request.dest).then(sendResponse);
  return true;
});
