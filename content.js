function getTitle() {
  const titleEl = document.querySelector('h1[data-pl="product-title"]');
  const fullTitle = titleEl?.textContent?.trim() ?? "";
  const words = fullTitle.split(" ").filter(w => w.length > 0).slice(0, 8);
  return words.join(" ");
}

function getPrice() {
  const priceEl = document.querySelector('[class*="price--current"]');
  return priceEl?.textContent?.trim() ?? "";
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
    link: getLink()
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scrape") {
    sendResponse(scrapeProduct());
  }
});