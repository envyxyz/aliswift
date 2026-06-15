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
  const newSheetTab = document.getElementById("newSheetTab");
  const sheetNuggets = document.getElementById("sheetNuggets");
  const noSheetsMsg = document.getElementById("noSheetsMsg");

  const keywordsColInput = document.getElementById("keywordsCol");
  const priceColInput = document.getElementById("priceCol");
  const salePriceColInput = document.getElementById("salePriceCol");
  const linkColInput = document.getElementById("linkCol");
  const sheetTabInput = document.getElementById("sheetTabInput");
  const startRowInput = document.getElementById("startRow");
  const showPageButtonInput = document.getElementById("showPageButton");
  const methodFormulaRadio = document.getElementById("methodFormula");
  const methodMarginRadio = document.getElementById("methodMargin");
  const formulaValueInput = document.getElementById("formulaValue");
  const marginPercentInput = document.getElementById("marginPercent");
  const titleLengthInput = document.getElementById("titleLength");
  const excludeKeywordsInput = document.getElementById("excludeKeywords");
  const includeSalePriceInput = document.getElementById("includeSalePrice");
  const roundToNinetyNineInput = document.getElementById("roundToNinetyNine");
  const extraCostInput = document.getElementById("extraCost");

  function togglePricingInputs() {
    if (methodFormulaRadio.checked) {
      document.getElementById("formulaInput").style.display = "block";
      document.getElementById("marginInput").style.display = "none";
    } else {
      document.getElementById("formulaInput").style.display = "none";
      document.getElementById("marginInput").style.display = "block";
    }
  }

  document.querySelectorAll('input[name="pricingMethod"]').forEach((radio) => {
    radio.addEventListener("change", togglePricingInputs);
  });

  // Loads per-sheet fields (column mapping + sheet tab) from a sheet object.
  function loadSheetColumnSettings(sheet) {
    keywordsColInput.value = sheet.keywordsCol || "B";
    priceColInput.value = sheet.priceCol || "D";
    salePriceColInput.value = sheet.salePriceCol || "E";
    linkColInput.value = sheet.linkCol || "C";
    sheetTabInput.value = sheet.sheetTab || "Sheet1";
  }

  // Loads per-sheet behavior + pricing fields from a sheet object.
  function loadSheetBehaviorSettings(sheet) {
    titleLengthInput.value = sheet.titleLength || 8;
    excludeKeywordsInput.value = sheet.excludeKeywords || "";
    includeSalePriceInput.checked = sheet.includeSalePrice !== false;
    roundToNinetyNineInput.checked = sheet.roundToNinetyNine || false;
    extraCostInput.value = sheet.extraCost || 0;
    const method = sheet.pricingMethod || "formula";
    document.querySelector(
      `input[name="pricingMethod"][value="${method}"]`,
    ).checked = true;
    formulaValueInput.value = sheet.formulaValue || "costPrice * 1.7";
    marginPercentInput.value = sheet.marginPercent || 25;
    togglePricingInputs();
  }

  function openModal() {
    // FIX: explicitly clear all three modal fields every time the modal opens.
    newSheetName.value = "";
    newSheetId.value = "";
    newSheetTab.value = "";
    addSheetModal.style.display = "block";
    modalOverlay.style.display = "block";
  }

  function closeModal() {
    addSheetModal.style.display = "none";
    modalOverlay.style.display = "none";
    newSheetName.value = "";
    newSheetId.value = "";
    newSheetTab.value = "";
  }

  async function renderNuggets() {
    const storage = await new Promise((r) =>
      chrome.storage.sync.get({ sheets: [], activeSheetId: "" }, r),
    );

    sheetNuggets.innerHTML = "";
    noSheetsMsg.style.display = storage.sheets.length === 0 ? "block" : "none";

    storage.sheets.forEach((sheet, idx) => {
      const nugget = document.createElement("div");
      nugget.className =
        "nugget" + (sheet.id === storage.activeSheetId ? " active" : "");
      nugget.innerHTML = `${sheet.name}<button type="button" class="delete-nugget" data-idx="${idx}">×</button>`;

      nugget.addEventListener("click", (e) => {
        if (!e.target.classList.contains("delete-nugget")) {
          chrome.storage.sync.set({ activeSheetId: sheet.id }, renderNuggets);
          loadSheetColumnSettings(sheet);
          loadSheetBehaviorSettings(sheet);
        }
      });

      nugget.querySelector(".delete-nugget").addEventListener("click", (e) => {
        e.stopPropagation();
        storage.sheets.splice(idx, 1);
        if (sheet.id === storage.activeSheetId) {
          storage.activeSheetId =
            storage.sheets.length > 0 ? storage.sheets[0].id : "";
        }
        chrome.storage.sync.set(
          { sheets: storage.sheets, activeSheetId: storage.activeSheetId },
          renderNuggets,
        );
      });

      sheetNuggets.appendChild(nugget);
    });
  }

  addSheetBtn.addEventListener("click", openModal);

  // Close on overlay click.
  modalOverlay.addEventListener("click", closeModal);

  cancelSheetBtn.addEventListener("click", closeModal);

  saveSheetBtn.addEventListener("click", async () => {
    const name = newSheetName.value.trim();
    const id = newSheetId.value.trim();

    if (!name || !id) {
      alert("Please fill in both Sheet Name and Sheet ID.");
      return;
    }

    const storage = await new Promise((r) =>
      chrome.storage.sync.get({ sheets: [], activeSheetId: "" }, r),
    );

    // Guard against duplicate sheet IDs.
    if (storage.sheets.some((s) => s.id === id)) {
      alert("A sheet with this ID already exists.");
      return;
    }

    storage.sheets.push({
      name,
      id,
      sheetTab: newSheetTab.value.trim() || "Sheet1",
      keywordsCol: keywordsColInput.value.trim().toUpperCase() || "B",
      priceCol: priceColInput.value.trim().toUpperCase() || "D",
      salePriceCol: salePriceColInput.value.trim().toUpperCase() || "E",
      linkCol: linkColInput.value.trim().toUpperCase() || "C",
      titleLength: parseInt(titleLengthInput.value) || 8,
      excludeKeywords: excludeKeywordsInput.value.trim(),
      includeSalePrice: includeSalePriceInput.checked,
      roundToNinetyNine: roundToNinetyNineInput.checked,
      extraCost: parseFloat(extraCostInput.value) || 0,
      pricingMethod:
        document.querySelector('input[name="pricingMethod"]:checked').value ||
        "formula",
      formulaValue: formulaValueInput.value.trim() || "costPrice * 1.7",
      marginPercent: parseInt(marginPercentInput.value) || 25,
    });

    if (!storage.activeSheetId) {
      storage.activeSheetId = id;
    }

    chrome.storage.sync.set(
      { sheets: storage.sheets, activeSheetId: storage.activeSheetId },
      () => {
        closeModal();
        renderNuggets();
      },
    );
  });

  // Initial load: populate UI from storage.
  chrome.storage.sync.get(
    {
      sheets: [],
      activeSheetId: "",
      // Fallback globals (only used when there is no active sheet).
      startRow: "2",
      showPageButton: true,
    },
    (settings) => {
      startRowInput.value = settings.startRow;
      showPageButtonInput.checked = settings.showPageButton;

      const activeSheet = settings.sheets.find(
        (s) => s.id === settings.activeSheetId,
      );

      if (activeSheet) {
        loadSheetColumnSettings(activeSheet);
        loadSheetBehaviorSettings(activeSheet);
      } else {
        // No active sheet: show safe defaults.
        keywordsColInput.value = "B";
        priceColInput.value = "D";
        salePriceColInput.value = "E";
        linkColInput.value = "C";
        sheetTabInput.value = "";
        titleLengthInput.value = 8;
        excludeKeywordsInput.value = "";
        includeSalePriceInput.checked = true;
        roundToNinetyNineInput.checked = false;
        extraCostInput.value = 0;
        methodFormulaRadio.checked = true;
        formulaValueInput.value = "costPrice * 1.7";
        marginPercentInput.value = 25;
        togglePricingInputs();
      }

      renderNuggets();
    },
  );

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    chrome.storage.sync.get({ sheets: [], activeSheetId: "" }, (current) => {
      const updatedSheets = current.sheets.map((sheet) => {
        if (sheet.id === current.activeSheetId) {
          return {
            ...sheet,
            // Per-sheet column + tab settings.
            keywordsCol: keywordsColInput.value.trim().toUpperCase() || "B",
            priceCol: priceColInput.value.trim().toUpperCase() || "D",
            salePriceCol: salePriceColInput.value.trim().toUpperCase() || "E",
            linkCol: linkColInput.value.trim().toUpperCase() || "C",
            sheetTab: sheetTabInput.value.trim() || "Sheet1",
            // Per-sheet behavior + pricing settings.
            titleLength: parseInt(titleLengthInput.value) || 8,
            excludeKeywords: excludeKeywordsInput.value.trim(),
            includeSalePrice: includeSalePriceInput.checked,
            roundToNinetyNine: roundToNinetyNineInput.checked,
            extraCost: parseFloat(extraCostInput.value) || 0,
            pricingMethod:
              document.querySelector('input[name="pricingMethod"]:checked')
                .value || "formula",
            formulaValue: formulaValueInput.value.trim() || "costPrice * 1.7",
            marginPercent: parseInt(marginPercentInput.value) || 25,
          };
        }
        return sheet;
      });

      // Only truly global settings that apply regardless of sheet.
      chrome.storage.sync.set(
        {
          sheets: updatedSheets,
          activeSheetId: current.activeSheetId,
          showPageButton: showPageButtonInput.checked,
          startRow: startRowInput.value,
        },
        () => {
          saveStatus.textContent = "✓ Settings saved";
          saveStatus.style.color = "#2e7d32";
          setTimeout(() => {
            saveStatus.textContent = "";
          }, 2000);
        },
      );
    });
  });
});
