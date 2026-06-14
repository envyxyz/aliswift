function getTitle() {
  const titleEl = document.querySelector('h1[data-pl="product-title"]');
  const fullTitle = titleEl?.textContent?.trim() ?? "";
  const words = fullTitle
    .split(" ")
    .filter((w) => w.length > 0)
    .slice(0, 8);
  return words.join(" ");
}

function getPrice() {
  const selectors = [
    '[class*="price-default--current"]',
    '[class*="price--current"]',
    ".uniform-banner-box-price",
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim()) {
      const match = el.textContent.trim().match(/[\d,]+\.?\d*/);
      return match ? match[0] : "";
    }
  }
  return "";
}

function getLink() {
  const fullUrl = window.location.href;
  const match = fullUrl.match(/^(https:\/\/.+?\.html)/);
  return match ? match[1] : fullUrl;
}

function scrapeProduct() {
  return {
    title: getTitle(),
    price: getPrice(),
    link: getLink(),
  };
}

function injectButton() {
  if (document.getElementById("aliswift-page-btn")) return;
  const wrapper = document.querySelector('[class*="action--stickyWrap"]');
  if (!wrapper) return false;

  const btn = document.createElement("button");
  btn.id = "aliswift-page-btn";
  btn.textContent = "Add to Sheet";
  btn.style.cssText = `
    display: block;
    width: 100%;
    padding: 14px;
    margin: 4px 0 0 0;
    background: #ff4f00;
    color: white;
    border: none;
    border-radius: 0px;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    max-height: 44px;
    font-family: TT Norms Pro, -apple-system, BlinkMacSystemFont, sans-serif;
  `;

  btn.addEventListener("click", () => {
    const data = scrapeProduct();
    chrome.runtime.sendMessage({ action: "appendToSheet", data }, (result) => {
      btn.textContent = result?.success ? "Added" : "✖ Error";
      setTimeout(() => {
        btn.textContent = "Add to Sheet";
      }, 2000);
    });
  });

  wrapper.insertBefore(btn, wrapper.firstChild);
  return true;
}

// Retry every 500ms for up to 10 seconds
let attempts = 0;
const interval = setInterval(() => {
  attempts++;
  if (injectButton() || attempts >= 20) clearInterval(interval);
}, 500);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scrape") {
    sendResponse(scrapeProduct());
  }
});
