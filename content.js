function safeCalc(formula, costPrice) {
  const expr = formula.replace(/costPrice/g, costPrice);
  if (!/^[\d\s\+\-\*\/\.\(\)]+$/.test(expr)) return null;
  const tokens = expr.match(/[\d\.]+|[\+\-\*\/\(\)]/g);
  if (!tokens) return null;
  const nums = [],
    ops = [];
  const prec = { "+": 1, "-": 1, "*": 2, "/": 2 };
  const apply = () => {
    const b = nums.pop(),
      a = nums.pop(),
      op = ops.pop();
    if (op === "+") nums.push(a + b);
    if (op === "-") nums.push(a - b);
    if (op === "*") nums.push(a * b);
    if (op === "/") nums.push(a / b);
  };
  for (const t of tokens) {
    if (!isNaN(t)) {
      nums.push(parseFloat(t));
    } else if ("+-*/".includes(t)) {
      while (ops.length && prec[ops[ops.length - 1]] >= prec[t]) apply();
      ops.push(t);
    }
  }
  while (ops.length) apply();
  return nums[0] ?? null;
}

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

  if (!document.getElementById("aliswift-styles")) {
    const style = document.createElement("style");
    style.id = "aliswift-styles";
    style.textContent =
      "@keyframes aliswift-spin { to { transform: rotate(360deg); } }";
    document.head.appendChild(style);
  }

  const btn = document.createElement("button");
  btn.id = "aliswift-page-btn";
  btn.textContent = "Add to Sheet";
  btn.style.cssText = `
  display: block;
  width: 100%;
  padding: 12px;
  margin: 8px 0 0 0;
  background: #1db058;
  color: white;
  border: none;
  border-radius: 0px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  font-family: TT Norms Pro, -apple-system, sans-serif;
  letter-spacing: 0.3px;
`;

  btn.addEventListener("click", () => {
    const data = scrapeProduct();

    btn.innerHTML =
      '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:aliswift-spin 0.7s linear infinite;margin-right:6px;vertical-align:middle;"></span>Adding...';
    btn.disabled = true;

    chrome.storage.sync.get(
      {
        pricingMethod: "formula",
        formulaValue: "costPrice * 1.7",
        marginPercent: 25,
      },
      (settings) => {
        const costPrice = parseFloat(data.price.replace(/[^0-9.]/g, ""));
        if (!isNaN(costPrice) && costPrice > 0) {
          if (settings.pricingMethod === "margin") {
            data.salePrice = (
              costPrice *
              (1 + settings.marginPercent / 100)
            ).toFixed(2);
          } else {
            try {
              data.salePrice = String(
                safeCalc(settings.formulaValue, costPrice)?.toFixed(2) ?? "",
              );
            } catch (e) {
              data.salePrice = "";
            }
          }
        }

        chrome.runtime.sendMessage(
          { action: "appendToSheet", data },
          (result) => {
            if (result?.success) {
              btn.style.background = "#27ae60";
              btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="white" style="vertical-align:middle;margin-right:6px;display:inline-block;"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>Added!`;
            } else {
              btn.style.background = "#c0392b";
              btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="white" style="vertical-align:middle;margin-right:6px;display:inline-block;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>Error`;
            }
            setTimeout(() => {
              btn.textContent = "Add to Sheet";
              btn.style.background = "#1db058";
              btn.disabled = false;
            }, 2000);
          },
        );
      },
    );
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
