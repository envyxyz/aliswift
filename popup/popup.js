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
    if (op === "/") nums.push(b !== 0 ? a / b : 0);
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

document.addEventListener("DOMContentLoaded", async () => {
  const titleEl = document.getElementById("title");
  const priceEl = document.getElementById("price");
  const salePriceEl = document.getElementById("salePrice");
  const linkEl = document.getElementById("link");
  const addBtn = document.getElementById("addBtn");
  const status = document.getElementById("status");
  const themeToggle = document.getElementById("themeToggle");
  const themeIcon = document.getElementById("themeIcon");
  const githubBtn = document.getElementById("githubBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const profileBtn = document.getElementById("profileBtn");

  // SHEET SELECTOR
  function renderSheetDropdown(sheets, activeSheetId) {
    const selectedSheet = document.getElementById("selectedSheet");
    const sheetOptions = document.getElementById("sheetOptions");
    const dropdown = document.getElementById("sheetDropdown");
    const arrow = document.getElementById("dropdownArrow");

    if (!sheets || sheets.length === 0) {
      selectedSheet.textContent = "No sheets configured";
      sheetOptions.innerHTML =
        '<div class="sheet-option">No sheets added yet</div>';
      return;
    }

    const active = sheets.find((s) => s.id === activeSheetId) || sheets[0];
    selectedSheet.textContent = active.name;

    sheetOptions.innerHTML = sheets
      .map(
        (s) => `
      <div class="sheet-option ${s.id === activeSheetId ? "active" : ""}"
           data-id="${s.id}" data-name="${s.name}">
        ${s.name}
      </div>
    `,
      )
      .join("");

    const dropdownToggle = () => {
      const isOpen = sheetOptions.style.display !== "none";
      sheetOptions.style.display = isOpen ? "none" : "block";
      arrow.style.transform = isOpen ? "" : "rotate(180deg)";
    };

    dropdown.onclick = (e) => {
      e.stopPropagation();
      dropdownToggle();
    };

    sheetOptions.querySelectorAll(".sheet-option[data-id]").forEach((opt) => {
      opt.onclick = (e) => {
        e.stopPropagation();
        const id = opt.dataset.id;
        const name = opt.dataset.name;
        chrome.storage.sync.set({ activeSheetId: id });
        selectedSheet.textContent = name;
        sheetOptions
          .querySelectorAll(".sheet-option")
          .forEach((o) => o.classList.remove("active"));
        opt.classList.add("active");
        sheetOptions.style.display = "none";
        arrow.style.transform = "";
      };
    });

    document.addEventListener("click", () => {
      sheetOptions.style.display = "none";
      arrow.style.transform = "";
    });
  }

  async function loadSheets() {
    const storage = await new Promise((r) =>
      chrome.storage.sync.get({ sheets: [], activeSheetId: "" }, r),
    );
    renderSheetDropdown(storage.sheets, storage.activeSheetId);
  }

  await loadSheets();

  // THEME
  const savedTheme = await new Promise((r) =>
    chrome.storage.local.get({ theme: "dark" }, r),
  );
  applyTheme(savedTheme.theme);

  function applyTheme(theme) {
    document.body.className = "theme-" + theme;
    themeIcon.innerHTML =
      theme === "dark"
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 18C8.68629 18 6 15.3137 6 12C6 8.68629 8.68629 6 12 6C15.3137 6 18 8.68629 18 12C18 15.3137 15.3137 18 12 18ZM12 16C14.2091 16 16 14.2091 16 12C16 9.79086 14.2091 8 12 8C9.79086 8 8 9.79086 8 12C8 14.2091 9.79086 16 12 16ZM11 1H13V4H11V1ZM11 20H13V23H11V20ZM3.51472 4.92893L4.92893 3.51472L7.05025 5.63604L5.63604 7.05025L3.51472 4.92893ZM16.9497 18.364L18.364 16.9497L20.4853 19.0711L19.0711 20.4853L16.9497 18.364ZM19.0711 3.51472L20.4853 4.92893L18.364 7.05025L16.9497 5.63604L19.0711 3.51472ZM5.63604 16.9497L7.05025 18.364L4.92893 20.4853L3.51472 19.0711L5.63604 16.9497ZM23 11V13H20V11H23ZM4 11V13H1V11H4Z"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M10 7C10 10.866 13.134 14 17 14C18.9584 14 20.729 13.1957 21.9995 11.8995C22 11.933 22 11.9665 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C12.0335 2 12.067 2 12.1005 2.00049C10.8043 3.27098 10 5.04157 10 7ZM4 12C4 16.4183 7.58172 20 12 20C15.0583 20 17.7158 18.2839 19.062 15.7621C18.3945 15.9187 17.7035 16 17 16C13.134 16 10 12.866 10 9C10 8.29648 10.0813 7.60547 10.2379 6.938C7.71611 8.28423 6 10.9417 6 14C6 14 5 12.5 4 12Z"/></svg>';
  }

  themeToggle.addEventListener("click", () => {
    const isDark = document.body.classList.contains("theme-dark");
    const newTheme = isDark ? "light" : "dark";
    chrome.storage.local.set({ theme: newTheme });
    applyTheme(newTheme);
  });

  // FOOTER BUTTONS
  githubBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://github.com/envyxyz/aliswift" });
  });

  settingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  profileBtn.addEventListener("click", () => {
    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
      if (chrome.runtime.lastError) return;
      try {
        const res = await fetch(
          "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
          { headers: { Authorization: "Bearer " + token } },
        );
        const user = await res.json();
        if (user.picture) {
          const img = document.createElement("img");
          img.src = user.picture;
          img.style.cssText =
            "width:22px;height:22px;border-radius:50%;object-fit:cover;";
          profileBtn.innerHTML = "";
          profileBtn.appendChild(img);
        }
      } catch (e) {
        // silently fail — non-critical UI enhancement
      }
    });
  });

  // SCRAPE WITH RETRY
  async function scrapeWithRetry(tabId, maxAttempts = 5) {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: "scrape" }, (r) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(r);
        });
      });
      if (response && response.title) return response;
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return null;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  titleEl.value = "Loading...";

  const response = await scrapeWithRetry(tab.id);
  if (!response) {
    titleEl.value = "";
    return;
  }

  titleEl.value = response.title || "";
  priceEl.value = response.price || "";
  linkEl.value = response.link || "";

  // FIX: read pricing settings from the active sheet object, not global keys.
  const storageData = await new Promise((r) =>
    chrome.storage.sync.get({ sheets: [], activeSheetId: "" }, r),
  );
  const activeSheet = storageData.sheets.find(
    (s) => s.id === storageData.activeSheetId,
  );
  const sheetSettings = Object.assign(
    {
      pricingMethod: "formula",
      formulaValue: "costPrice * 1.7",
      marginPercent: 25,
      includeSalePrice: true,
      roundToNinetyNine: false,
      extraCost: 0,
    },
    activeSheet || {},
  );

  const rawPrice = (response.price || "").replace(/[^0-9.]/g, "");
  const costPrice = parseFloat(rawPrice);
  if (!isNaN(costPrice) && costPrice > 0 && sheetSettings.includeSalePrice !== false) {
    const extraCost = parseFloat(sheetSettings.extraCost) || 0;
    const totalCost = costPrice + extraCost;
    let salePrice = 0;
    if (sheetSettings.pricingMethod === "margin") {
      salePrice = totalCost * (1 + Number(sheetSettings.marginPercent) / 100);
    } else {
      const result = safeCalc(sheetSettings.formulaValue || "costPrice * 1.7", totalCost);
      if (result !== null) salePrice = result;
    }
    if (sheetSettings.roundToNinetyNine && salePrice > 0) {
      salePrice = Math.floor(salePrice) + 0.99;
    }
    if (salePrice > 0) salePriceEl.value = salePrice.toFixed(2);
  }

  // ADD TO SHEET
  addBtn.addEventListener("click", async () => {
    addBtn.disabled = true;
    addBtn.innerHTML =
      '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.4);border-top-color:white;border-radius:50%;animation:aliswift-spin 0.7s linear infinite;margin-right:8px;vertical-align:middle;"></span>Adding...';
    const data = {
      title: titleEl.value,
      price: priceEl.value,
      salePrice: salePriceEl.value,
      link: linkEl.value,
    };

    const result = await chrome.runtime.sendMessage({
      action: "appendToSheet",
      data,
    });

    if (result && result.success) {
      addBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="white" style="vertical-align:middle;margin-right:6px;">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>Added`;
      addBtn.classList.add("btn-success");
      status.textContent = "";
    } else {
      addBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="white" style="vertical-align:middle;margin-right:6px;">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>Error`;
      addBtn.classList.add("btn-error");
      status.textContent = result?.error || "Something went wrong";
    }

    setTimeout(() => {
      addBtn.innerHTML = "Add to Sheet";
      addBtn.classList.remove("btn-success", "btn-error");
      addBtn.disabled = false;
      status.textContent = "";
    }, 3000);
  });
});
