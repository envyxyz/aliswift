document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("settingsForm");
  const saveBtn = document.getElementById("saveBtn");
  const saveStatus = document.getElementById("saveStatus");

  const sheetIdInput = document.getElementById("sheetId");
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

  // Toggle pricing input visibility
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

  // Load settings from storage
  chrome.storage.sync.get(
    {
      sheetId: "",
      keywordsCol: "A",
      priceCol: "B",
      salePriceCol: "C",
      linkCol: "D",
      startRow: "2",
      showPageButton: true,
      pricingMethod: "formula",
      formulaValue: "costPrice * 1.7",
      marginPercent: 25,
    },
    (settings) => {
      sheetIdInput.value = settings.sheetId;
      keywordsColInput.value = settings.keywordsCol;
      priceColInput.value = settings.priceCol;
      salePriceColInput.value = settings.salePriceCol;
      linkColInput.value = settings.linkCol;
      startRowInput.value = settings.startRow;
      showPageButtonInput.checked = settings.showPageButton;

      if (settings.pricingMethod === "margin") {
        methodMarginRadio.checked = true;
      } else {
        methodFormulaRadio.checked = true;
      }

      formulaValueInput.value = settings.formulaValue || "costPrice * 1.7";
      marginPercentInput.value = settings.marginPercent || 25;

      togglePricingInputs();
    }
  );

  // Save settings
  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const settings = {
      sheetId: sheetIdInput.value.trim(),
      keywordsCol: keywordsColInput.value.trim().toUpperCase() || "A",
      priceCol: priceColInput.value.trim().toUpperCase() || "B",
      salePriceCol: salePriceColInput.value.trim().toUpperCase() || "C",
      linkCol: linkColInput.value.trim().toUpperCase() || "D",
      startRow: startRowInput.value.trim() || "2",
      showPageButton: showPageButtonInput.checked,
      pricingMethod: methodMarginRadio.checked ? "margin" : "formula",
      formulaValue: formulaValueInput.value.trim() || "costPrice * 1.7",
      marginPercent: parseInt(marginPercentInput.value, 10) || 25,
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
