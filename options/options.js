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
          keywordsColInput.value = sheet.keywordsCol || "B";
          priceColInput.value = sheet.priceCol || "D";
          salePriceColInput.value = sheet.salePriceCol || "E";
          linkColInput.value = sheet.linkCol || "C";
          document.getElementById("sheetTabInput").value =
            sheet.sheetTab || "Sheet1";
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
    document.getElementById("newSheetTab").value = "";
  });

  saveSheetBtn.addEventListener("click", async () => {
    const name = newSheetName.value.trim();
    const id = newSheetId.value.trim();

    if (!name || !id) {
      alert("Please fill in both fields");
      return;
    }

    const storage = await new Promise((r) =>
      chrome.storage.sync.get({ sheets: [], activeSheetId: "" }, r),
    );

    storage.sheets.push({
      name,
      id,
      sheetTab: document.getElementById("newSheetTab").value.trim() || "Sheet1",
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
        addSheetModal.style.display = "none";
        modalOverlay.style.display = "none";
        newSheetName.value = "";
        newSheetId.value = "";
        document.getElementById("newSheetTab").value = "";
        renderNuggets();
      },
    );
  });

  chrome.storage.sync.get(
    {
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
      titleLength: 8,
      excludeKeywords: "",
      includeSalePrice: true,
      roundToNinetyNine: false,
      extraCost: 0,
    },
    (settings) => {
      keywordsColInput.value = settings.keywordsCol;
      priceColInput.value = settings.priceCol;
      salePriceColInput.value = settings.salePriceCol;
      linkColInput.value = settings.linkCol;
      startRowInput.value = settings.startRow;
      showPageButtonInput.checked = settings.showPageButton;
      titleLengthInput.value = settings.titleLength || 8;
      excludeKeywordsInput.value = settings.excludeKeywords || "";
      includeSalePriceInput.checked = settings.includeSalePrice !== false;
      roundToNinetyNineInput.checked = settings.roundToNinetyNine || false;
      extraCostInput.value = settings.extraCost || 0;

      const method = settings.pricingMethod || "formula";
      document.querySelector(
        `input[name="pricingMethod"][value="${method}"]`,
      ).checked = true;
      formulaValueInput.value = settings.formulaValue || "costPrice * 1.7";
      marginPercentInput.value = settings.marginPercent || 25;

      document.getElementById("formulaInput").style.display =
        method === "formula" ? "block" : "none";
      document.getElementById("marginInput").style.display =
        method === "margin" ? "block" : "none";

      const activeSheet = settings.sheets.find(
        (s) => s.id === settings.activeSheetId,
      );
      if (activeSheet) {
        keywordsColInput.value = activeSheet.keywordsCol || "B";
        priceColInput.value = activeSheet.priceCol || "D";
        salePriceColInput.value = activeSheet.salePriceCol || "E";
        linkColInput.value = activeSheet.linkCol || "C";
        document.getElementById("sheetTabInput").value =
          activeSheet.sheetTab || "Sheet1";
        titleLengthInput.value = activeSheet.titleLength || 8;
        excludeKeywordsInput.value = activeSheet.excludeKeywords || "";
        includeSalePriceInput.checked = activeSheet.includeSalePrice !== false;
        roundToNinetyNineInput.checked = activeSheet.roundToNinetyNine || false;
        extraCostInput.value = activeSheet.extraCost || 0;
        const method = activeSheet.pricingMethod || "formula";
        document.querySelector(
          `input[name="pricingMethod"][value="${method}"]`,
        ).checked = true;
        formulaValueInput.value = activeSheet.formulaValue || "costPrice * 1.7";
        marginPercentInput.value = activeSheet.marginPercent || 25;
        togglePricingInputs();
      }

      togglePricingInputs();
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
            keywordsCol: keywordsColInput.value.trim().toUpperCase() || "B",
            priceCol: priceColInput.value.trim().toUpperCase() || "D",
            salePriceCol: salePriceColInput.value.trim().toUpperCase() || "E",
            linkCol: linkColInput.value.trim().toUpperCase() || "C",
            sheetTab:
              document.getElementById("sheetTabInput").value.trim() || "Sheet1",
          };
        }
        return sheet;
      });
      chrome.storage.sync.set(
        {
          sheets: updatedSheets,
          activeSheetId: current.activeSheetId,
          showPageButton: showPageButtonInput.checked,
          pricingMethod:
            document.querySelector('input[name="pricingMethod"]:checked')
              .value || "formula",
          formulaValue: formulaValueInput.value.trim() || "costPrice * 1.7",
          marginPercent: parseInt(marginPercentInput.value) || 25,
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
