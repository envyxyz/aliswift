document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("settingsForm");
  const saveBtn = document.getElementById("saveBtn");
  const saveStatus = document.getElementById("saveStatus");
  const addSheetBtn = document.getElementById("addSheetBtn");
  const addSheetModal = document.getElementById("addSheetModal");
  const modalOverlay = document.getElementById("modalOverlay");
  const cancelSheetBtn = document.getElementById("cancelSheetBtn");
  const saveSheetBtn = document.getElementById("saveSheetBtn");
  const newSheetName = document.getElementById("newSheetName");
  const newSheetId = document.getElementById("newSheetId");
  const sheetNuggets = document.getElementById("sheetNuggets");
  const noSheetsMsg = document.getElementById("noSheetsMsg");

  const keywordsColInput = document.getElementById("keywordsCol");
  const priceColInput = document.getElementById("priceCol");
  const salePriceColInput = document.getElementById("salePriceCol");
  const linkColInput = document.getElementById("linkCol");
  const startRowInput = document.getElementById("startRow");
  const showPageButtonInput = document.getElementById("showPageButton");
  const methodFormulaRadio = document.getElementById("methodFormula");
  const methodMarginRadio = document.getElementById("methodMargin");
  const formulaValueInput = document.getElementById("formulaValue");
  const marginPercentInput = document.getElementById("marginPercent");

  function togglePricingInputs() {
    if (methodFormulaRadio.checked) {
      document.getElementById("formulaInput").style.display = "block";
      document.getElementById("marginInput").style.display = "none";
    } else {
      document.getElementById("formulaInput").style.display = "none";
      document.getElementById("marginInput").style.display = "block";
    }
  }

  document.querySelectorAll('input[name="pricingMethod"]').forEach(radio => {
    radio.addEventListener("change", togglePricingInputs);
  });

  async function renderNuggets() {
    const storage = await new Promise(r =>
      chrome.storage.sync.get({ sheets: [], activeSheetId: "" }, r)
    );

    sheetNuggets.innerHTML = "";
    noSheetsMsg.style.display = storage.sheets.length === 0 ? "block" : "none";

    storage.sheets.forEach((sheet, idx) => {
      const nugget = document.createElement("div");
      nugget.className = "nugget" + (sheet.id === storage.activeSheetId ? " active" : "");
      nugget.innerHTML = `${sheet.name}<button type="button" class="delete-nugget" data-idx="${idx}">×</button>`;

      nugget.addEventListener("click", (e) => {
        if (!e.target.classList.contains("delete-nugget")) {
          chrome.storage.sync.set({ activeSheetId: sheet.id }, renderNuggets);
        }
      });

      nugget.querySelector(".delete-nugget").addEventListener("click", (e) => {
        e.stopPropagation();
        storage.sheets.splice(idx, 1);
        if (sheet.id === storage.activeSheetId) {
          storage.activeSheetId = storage.sheets.length > 0 ? storage.sheets[0].id : "";
        }
        chrome.storage.sync.set(
          { sheets: storage.sheets, activeSheetId: storage.activeSheetId },
          renderNuggets
        );
      });

      sheetNuggets.appendChild(nugget);
    });
  }

  addSheetBtn.addEventListener("click", () => {
    console.log("[AliSwift Options] Add Sheet clicked");
    addSheetModal.style.display = "block";
    modalOverlay.style.display = "block";
  });

  cancelSheetBtn.addEventListener("click", () => {
    addSheetModal.style.display = "none";
    modalOverlay.style.display = "none";
    newSheetName.value = "";
    newSheetId.value = "";
  });

  saveSheetBtn.addEventListener("click", async () => {
    const name = newSheetName.value.trim();
    const id = newSheetId.value.trim();

    if (!name || !id) {
      alert("Please fill in both fields");
      return;
    }

    const storage = await new Promise(r =>
      chrome.storage.sync.get({ sheets: [], activeSheetId: "" }, r)
    );

    storage.sheets.push({ name, id });
    if (!storage.activeSheetId) {
      storage.activeSheetId = id;
    }

    chrome.storage.sync.set(
      { sheets: storage.sheets, activeSheetId: storage.activeSheetId },
      () => {
        addSheetModal.style.display = "none";
        modalOverlay.style.display = "none";
        newSheetName.value = "";
        newSheetId.value = "";
        renderNuggets();
      }
    );
  });

  chrome.storage.sync.get({
    sheets: [],
    activeSheetId: "",
    keywordsCol: "A",
    priceCol: "B",
    salePriceCol: "C",
    linkCol: "D",
    startRow: "2",
    showPageButton: true,
    pricingMethod: "formula",
    formulaValue: "costPrice * 1.7",
    marginPercent: 25,
  }, (settings) => {
    keywordsColInput.value = settings.keywordsCol;
    priceColInput.value = settings.priceCol;
    salePriceColInput.value = settings.salePriceCol;
    linkColInput.value = settings.linkCol;
    startRowInput.value = settings.startRow;
    showPageButtonInput.checked = settings.showPageButton;

    const method = settings.pricingMethod || "formula";
    document.querySelector(`input[name="pricingMethod"][value="${method}"]`).checked = true;
    formulaValueInput.value = settings.formulaValue || "costPrice * 1.7";
    marginPercentInput.value = settings.marginPercent || 25;

    document.getElementById("formulaInput").style.display = method === "formula" ? "block" : "none";
    document.getElementById("marginInput").style.display = method === "margin" ? "block" : "none";

    togglePricingInputs();
    renderNuggets();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    chrome.storage.sync.get({ sheets: [], activeSheetId: "" }, (current) => {
      const settings = {
        sheets: current.sheets,
        activeSheetId: current.activeSheetId,
        keywordsCol: keywordsColInput.value.trim().toUpperCase() || "A",
        priceCol: priceColInput.value.trim().toUpperCase() || "B",
        salePriceCol: salePriceColInput.value.trim().toUpperCase() || "C",
        linkCol: linkColInput.value.trim().toUpperCase() || "D",
        startRow: startRowInput.value.trim() || "2",
        showPageButton: showPageButtonInput.checked,
        pricingMethod: document.querySelector('input[name="pricingMethod"]:checked').value || "formula",
        formulaValue: formulaValueInput.value.trim() || "costPrice * 1.7",
        marginPercent: parseInt(marginPercentInput.value) || 25,
      };

      chrome.storage.sync.set(settings, () => {
        saveStatus.textContent = "✓ Settings saved";
        saveStatus.style.color = "#2e7d32";
        setTimeout(() => {
          saveStatus.textContent = "";
        }, 2000);
      });
    });
  });
});
