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
const LABEL = "Add to Sheet";
let resetTimer;

// First number found in the first matching element. Text matching `ignore`
// (e.g. "Free shipping over $10") counts as 0 instead of being read as a price.
function firstNumber(selectors, ignore) {
  for (const sel of selectors) {
    const text = document.querySelector(sel)?.textContent ?? "";
    if (ignore?.test(text)) return 0;
    const n = parsePrice(text);
    if (!Number.isNaN(n)) return n;
  }
  return NaN;
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

function getLink() {
  const url = location.href;
  return url.match(/^(https:\/\/.+?\.html)/)?.[1] ?? url;
}

async function scrapeRow() {
  const sheet = (await getActiveSheet()) ?? SHEET_DEFAULTS;
  const row = {
    title: getTitle(sheet.titleLength, sheet.excludeKeywords),
    link: getLink(),
    price: "",
    salePrice: "",
  };
  const price = firstNumber(PRICE_SELECTORS);
  if (price > 0) {
    Object.assign(row, priceProduct(price, firstNumber(SHIPPING_SELECTORS, /free/i) || 0, sheet));
  }
  return row;
}

function setState(btn, state, text) {
  btn.dataset.state = state;
  btn.textContent = text;
  btn.disabled = state === "loading";
}

async function addToSheet(btn) {
  clearTimeout(resetTimer);
  setState(btn, "loading", "Adding...");
  let result;
  try {
    const row = await scrapeRow();
    result =
      row.title && row.price
        ? await chrome.runtime.sendMessage({ action: "appendToSheet", data: row })
        : { error: "Couldn't read this product. Reload the page." };
  } catch (e) {
    result = { error: e.message };
  }
  if (result?.success) {
    setState(btn, "success", result.sku ? `Added as ${result.sku}` : "Added");
  } else {
    setState(btn, "error", result?.error ?? "Something went wrong");
  }
  resetTimer = setTimeout(() => setState(btn, "", LABEL), result?.success ? 3000 : 4000); // long enough to read the SKU
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
  btn.textContent = LABEL;
  btn.addEventListener("click", () => addToSheet(btn));
  wrapper.prepend(btn);
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== "scrape") return;
  scrapeRow().then(sendResponse);
  return true;
});
