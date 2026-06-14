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
  const profileIcon = document.getElementById("profileIcon");

  // THEME
  const savedTheme = await new Promise(r =>
    chrome.storage.local.get({ theme: "dark" }, r)
  );
  applyTheme(savedTheme.theme);

  function applyTheme(theme) {
    document.body.className = "theme-" + theme;
    themeIcon.textContent = theme === "dark" ? "light_mode" : "dark_mode";
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
      if (chrome.runtime.lastError) {
        console.warn("Auth not ready:", chrome.runtime.lastError.message);
        return;
      }
      try {
        const res = await fetch(
          "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
          { headers: { Authorization: "Bearer " + token } }
        );
        const user = await res.json();
        if (user.picture) {
          const img = document.createElement("img");
          img.src = user.picture;
          img.style.cssText = "width:22px;height:22px;border-radius:50%;object-fit:cover;";
          profileIcon.replaceWith(img);
        }
      } catch(e) {
        console.warn("Profile fetch failed:", e);
      }
    });
  });

  // SCRAPE
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { action: "scrape" }, async (response) => {
    if (chrome.runtime.lastError) return;
    if (!response) return;

    titleEl.value = response.title || "";
    priceEl.value = response.price || "";
    linkEl.value = response.link || "";

    const settings = await new Promise(r =>
      chrome.storage.sync.get({
        pricingMethod: "formula",
        formulaValue: "costPrice * 1.7",
        marginPercent: 25
      }, r)
    );

    const costPrice = parseFloat((response.price || "").replace(/[^0-9.]/g, ""));
    if (!isNaN(costPrice) && costPrice > 0) {
      if (settings.pricingMethod === "margin") {
        salePriceEl.value = (costPrice * (1 + settings.marginPercent / 100)).toFixed(2);
      } else {
        try {
          const result = eval(settings.formulaValue.replace(/costPrice/g, costPrice));
          salePriceEl.value = parseFloat(result).toFixed(2);
        } catch(e) { salePriceEl.value = ""; }
      }
    }
  });

  // ADD TO SHEET
  addBtn.addEventListener("click", async () => {
    addBtn.disabled = true;
    const data = {
      title: titleEl.value,
      price: priceEl.value,
      salePrice: salePriceEl.value,
      link: linkEl.value
    };

    const result = await chrome.runtime.sendMessage({ action: "appendToSheet", data });

    if (result && result.success) {
      addBtn.innerHTML = '<span class="material-icons" style="font-size:16px">check_circle</span> Added';
      addBtn.classList.add("btn-success");
      status.textContent = "";
    } else {
      addBtn.innerHTML = '<span class="material-icons" style="font-size:16px">close</span> Error';
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
