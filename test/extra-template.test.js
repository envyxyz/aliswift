const { test } = require("node:test");
const assert = require("node:assert/strict");

const shared = require("../lib/shared.js");
Object.assign(globalThis, shared);
const { TEMPLATE, buildWorkbook } = require("../lib/template.js");

const IDS = [10, 20, 30]; // Dashboard (10), Inventory (20), Orders (30)

// Helper to convert column letters to 0-based index
const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// Allowed request types for safe non-destructive sheet setup
const ALLOWED_REQUESTS = new Set([
  "updateSheetProperties",
  "updateDimensionProperties",
  "updateCells",
  "mergeCells",
  "repeatCell",
  "setDataValidation",
  "addConditionalFormatRule",
]);

const FORBIDDEN_SUBSTRINGS = ["delete", "clear", "cut"];

test("extra-template: request kinds match non-destructive allow list", () => {
  for (const { region, home } of [
    { region: "UK", home: "PKR" },
    { region: "UK", home: "GBP" },
    { region: "US", home: "USD" },
    { region: "US", home: "EUR" },
  ]) {
    const { setup } = buildWorkbook({ name: "Store Test", region, homeCurrency: home, rate: 1.25 });
    const requests = setup(IDS);

    assert.ok(requests.length > 0, "batchUpdate must have requests");
    for (const req of requests) {
      const keys = Object.keys(req);
      assert.equal(keys.length, 1, `Request must have exactly one action key: ${JSON.stringify(req)}`);
      const key = keys[0];
      assert.ok(ALLOWED_REQUESTS.has(key), `Forbidden or unexpected request key: ${key}`);
      for (const bad of FORBIDDEN_SUBSTRINGS) {
        assert.ok(!key.toLowerCase().includes(bad), `Destructive request key detected: ${key}`);
      }
    }
  }
});

test("extra-template: all formulas reference valid existing cells and ranges", () => {
  const tabBounds = {
    Dashboard: { cols: 4, rows: 15 },
    Inventory: { cols: 15, rows: 1000 },
    Orders: { cols: 12, rows: 1001 },
  };
  const idToTab = { 10: "Dashboard", 20: "Inventory", 30: "Orders" };

  const { setup } = buildWorkbook({ name: "Store Test", region: "UK", homeCurrency: "PKR", rate: 374.37 });
  const requests = setup(IDS);

  const formulas = []; // { formula, currentTab }

  for (const req of requests) {
    if (req.updateCells) {
      const tab = idToTab[req.updateCells.start.sheetId];
      for (const row of req.updateCells.rows) {
        for (const val of row.values ?? []) {
          if (val.userEnteredValue?.formulaValue) {
            formulas.push({ formula: val.userEnteredValue.formulaValue, currentTab: tab });
          }
        }
      }
    } else if (req.repeatCell) {
      const tab = idToTab[req.repeatCell.range.sheetId];
      if (req.repeatCell.cell?.userEnteredValue?.formulaValue) {
        formulas.push({ formula: req.repeatCell.cell.userEnteredValue.formulaValue, currentTab: tab });
      }
    } else if (req.addConditionalFormatRule) {
      const rule = req.addConditionalFormatRule.rule;
      const tab = idToTab[rule.ranges?.[0]?.sheetId];
      const cond = rule.booleanRule?.condition;
      if (cond?.type === "CUSTOM_FORMULA") {
        for (const v of cond.values ?? []) {
          if (v.userEnteredValue) {
            formulas.push({ formula: v.userEnteredValue, currentTab: tab });
          }
        }
      }
    }
  }

  assert.ok(formulas.length > 0, "Formulas should be present in workbook");

  // Regex to extract cell/range references
  // Matches OptionalTab!$A$1:$B$2 or OptionalTab!$A:$B or $A1
  const refPattern = /(?:(Dashboard|Inventory|Orders)!)?\$?([A-Z]+)\$?(\d+)?(?::\$?([A-Z]+)\$?(\d+)?)?/g;

  for (const { formula, currentTab } of formulas) {
    // Skip string literal contents like "CURRENCY:..." or "Listed"
    const cleaned = formula.replace(/"[^"]*"/g, '""');
    let m;
    while ((m = refPattern.exec(cleaned)) !== null) {
      const [full, sheet, c1, r1, c2, r2] = m;
      // Skip known spreadsheet function names that look like col names (e.g. IF, OR, N, ROW, TEXT, ROUND, IFERROR, SUMIFS)
      if (!sheet && !r1 && !c2 && ["IF", "OR", "N", "ROW", "TEXT", "ROUND", "IFERROR", "SUMPRODUCT", "COUNTIF", "COUNTIFS", "SUMIFS", "VLOOKUP", "ISODD", "GOOGLEFINANCE"].includes(c1)) {
        continue;
      }

      const targetTab = sheet || currentTab;
      assert.ok(tabBounds[targetTab], `Reference points to unknown sheet: ${targetTab} in formula: ${formula}`);
      const bounds = tabBounds[targetTab];

      // Check first column
      if (c1) {
        const colIdx1 = colIndex(c1);
        assert.ok(colIdx1 >= 0 && colIdx1 < bounds.cols, `Column ${c1} out of bounds for ${targetTab} (max cols ${bounds.cols}) in ${formula}`);
      }
      // Check first row if specified
      if (r1) {
        const rowNum1 = Number(r1);
        assert.ok(rowNum1 >= 1 && rowNum1 <= bounds.rows, `Row ${r1} out of bounds for ${targetTab} (max rows ${bounds.rows}) in ${formula}`);
      }
      // Check second column if range
      if (c2) {
        const colIdx2 = colIndex(c2);
        assert.ok(colIdx2 >= 0 && colIdx2 < bounds.cols, `Range end column ${c2} out of bounds for ${targetTab} in ${formula}`);
      }
      // Check second row if range
      if (r2) {
        const rowNum2 = Number(r2);
        assert.ok(rowNum2 >= 1 && rowNum2 <= bounds.rows, `Range end row ${r2} out of bounds for ${targetTab} in ${formula}`);
      }
    }
  }
});

test("extra-template: column counts match the config layout", () => {
  const { createBody, config } = buildWorkbook({ name: "Store Config", region: "UK", homeCurrency: "PKR" });

  const sheetSizes = Object.fromEntries(
    createBody.sheets.map((s) => [s.properties.title, s.properties.gridProperties.columnCount]),
  );

  assert.equal(sheetSizes.Dashboard, 4);
  assert.equal(sheetSizes.Inventory, 15);
  assert.equal(sheetSizes.Orders, 12);

  // Check Inventory column mappings in config
  assert.ok(colIndex(config.skuCol) < sheetSizes.Inventory);
  assert.ok(colIndex(config.keywordsCol) < sheetSizes.Inventory);
  assert.ok(colIndex(config.linkCol) < sheetSizes.Inventory);
  assert.ok(colIndex(config.priceCol) < sheetSizes.Inventory);
  assert.ok(colIndex(config.salePriceCol) < sheetSizes.Inventory);
  assert.ok(colIndex(config.statusCol) < sheetSizes.Inventory);
  assert.ok(colIndex(config.imageCol) < sheetSizes.Inventory);
  assert.ok(colIndex(config.profitCol) < sheetSizes.Inventory);
  assert.ok(colIndex(config.marginCol) < sheetSizes.Inventory);

  // Check Orders column mappings in config
  for (const [key, colLetter] of Object.entries(config.oCols)) {
    if (colLetter) {
      assert.ok(
        colIndex(colLetter) < sheetSizes.Orders,
        `Orders col ${key} (${colLetter}) must be within ${sheetSizes.Orders} columns`,
      );
    }
  }
});

test("extra-template: same-currency sheets hide duplicate columns and rows", () => {
  // 1. Same currency: UK + GBP
  const same = buildWorkbook({ name: "Same Currency", region: "UK", homeCurrency: "GBP" });
  const sameReqs = same.setup(IDS);

  const isHiddenCol = (reqs, sheetId, colLetter) =>
    reqs.some(
      (r) =>
        r.updateDimensionProperties?.range.sheetId === sheetId &&
        r.updateDimensionProperties.range.dimension === "COLUMNS" &&
        r.updateDimensionProperties.range.startIndex === colIndex(colLetter) &&
        r.updateDimensionProperties.range.endIndex === colIndex(colLetter) + 1 &&
        r.updateDimensionProperties.properties.hiddenByUser === true,
    );

  const isHiddenRow = (reqs, sheetId, rowNum) =>
    reqs.some(
      (r) =>
        r.updateDimensionProperties?.range.sheetId === sheetId &&
        r.updateDimensionProperties.range.dimension === "ROWS" &&
        r.updateDimensionProperties.range.startIndex === rowNum - 1 &&
        r.updateDimensionProperties.range.endIndex === rowNum &&
        r.updateDimensionProperties.properties.hiddenByUser === true,
    );

  // Inventory col K (Net Profit Home) and Orders col I (Profit Home) must be hidden
  assert.ok(isHiddenCol(sameReqs, 20, "K"), "Inventory col K should be hidden when currencies match");
  assert.ok(isHiddenCol(sameReqs, 30, "I"), "Orders col I should be hidden when currencies match");

  // Dashboard rows 11 (Revenue Home) and 13 (Profit Home) must be hidden
  assert.ok(isHiddenRow(sameReqs, 10, 11), "Dashboard row 11 should be hidden when currencies match");
  assert.ok(isHiddenRow(sameReqs, 10, 13), "Dashboard row 13 should be hidden when currencies match");

  // 2. Different currency: UK + PKR
  const diff = buildWorkbook({ name: "Diff Currency", region: "UK", homeCurrency: "PKR" });
  const diffReqs = diff.setup(IDS);

  assert.ok(!isHiddenCol(diffReqs, 20, "K"), "Inventory col K must NOT be hidden when currencies differ");
  assert.ok(!isHiddenCol(diffReqs, 30, "I"), "Orders col I must NOT be hidden when currencies differ");
  assert.ok(!isHiddenRow(diffReqs, 10, 11), "Dashboard row 11 must NOT be hidden when currencies differ");
  assert.ok(!isHiddenRow(diffReqs, 10, 13), "Dashboard row 13 must NOT be hidden when currencies differ");
});
