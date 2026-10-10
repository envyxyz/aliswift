// The workbook AliSwift builds for "Auto" sheets: Dashboard, Inventory and Orders tabs.
// Loaded by background.js through importScripts, after lib/shared.js (it needs REGIONS and
// TEMPLATE_LAYOUT as globals). Plain script, no build step. The CommonJS export is for tests.
//
// Every request this file produces only writes into the brand-new spreadsheet. It never removes
// rows or empties cells, and a test checks the code for the Sheets requests that would.

const PAL = {
  navy: "#1F2937", slate: "#374151", input: "#EFF6FF", band: "#F0F4FF", calc: "#F3F4F6",
  amber: "#FEF3C7", ad: "#FFF7ED", white: "#FFFFFF",
  blue: "#1D4ED8", gray: "#374151", mute: "#6B7280", brown: "#92400E",
  line: "#D9D9D9", rule: "#D1D5DB",
};
const MONEY = '"{SYM}"#,##0.00';
const bottom = { bottom: ["SOLID", PAL.rule] };
const sides = { left: ["SOLID", PAL.line], right: ["SOLID", PAL.line] };
const box = { ...sides, top: ["SOLID", PAL.line], bottom: ["SOLID", PAL.line] };

// sz = font size in pt, h/v = alignment, fmt = number format pattern. Every font is Arial.
const STYLES = {
  rateLabel: { sz: 11, bold: true, fill: PAL.amber, h: "RIGHT", v: "MIDDLE" },
  rateValue: { sz: 11, bold: true, color: PAL.blue, fill: PAL.input, h: "CENTER", v: "MIDDLE", fmt: "#,##0.00" },
  hint: { sz: 9, italic: true, color: PAL.mute, v: "BOTTOM" },
  title: { sz: 13, bold: true, color: PAL.white, fill: PAL.navy, h: "CENTER", v: "MIDDLE" },
  subL: { sz: 10, bold: true, color: PAL.white, fill: PAL.slate, h: "LEFT", v: "MIDDLE" },
  subC: { sz: 10, bold: true, color: PAL.white, fill: PAL.slate, h: "CENTER", v: "MIDDLE" },
  mLabelA: { sz: 11, bold: true, fill: PAL.band, h: "LEFT", v: "MIDDLE" },
  mGapA: { fill: PAL.band },
  mValueA: { sz: 11, bold: true, color: PAL.navy, fill: PAL.band, h: "RIGHT", v: "MIDDLE", fmt: "#,##0" },
  mLabelB: { sz: 11, bold: true, fill: PAL.white, h: "LEFT", v: "MIDDLE" },
  mGapB: { fill: PAL.white },
  mIntB: { sz: 11, bold: true, color: PAL.navy, h: "RIGHT", v: "MIDDLE", fmt: "#,##0" },
  mMoneyB: { sz: 11, bold: true, color: PAL.navy, h: "RIGHT", v: "MIDDLE", fmt: MONEY },
  mPctB: { sz: 11, bold: true, color: PAL.navy, h: "RIGHT", v: "MIDDLE", fmt: "0.00%" },

  setLabel: { sz: 10, bold: true, v: "MIDDLE" },
  setPct: { sz: 10, bold: true, color: PAL.blue, fill: PAL.input, h: "CENTER", v: "MIDDLE", fmt: "0.00%", borders: sides },
  setMoney: { sz: 10, bold: true, color: PAL.blue, fill: PAL.input, h: "CENTER", v: "MIDDLE", fmt: '"{SYM}"0.00', borders: sides },
  head: {
    sz: 10, bold: true, color: PAL.white, fill: PAL.navy, h: "CENTER", v: "MIDDLE", wrap: true,
    borders: { bottom: ["SOLID_MEDIUM", PAL.slate] },
  },

  sku: { sz: 10, color: PAL.gray, fill: PAL.calc, h: "CENTER", v: "MIDDLE", borders: { right: ["SOLID", PAL.line], ...bottom } },
  name: { sz: 10, fill: PAL.input, h: "LEFT", v: "MIDDLE", wrap: true, borders: { right: ["SOLID", PAL.line], ...bottom } },
  url: { sz: 10, fill: PAL.input, h: "LEFT", v: "MIDDLE", borders: bottom },
  moneyIn: { sz: 10, fill: PAL.input, h: "CENTER", v: "MIDDLE", fmt: MONEY, borders: box },
  pctIn: { sz: 10, color: PAL.brown, fill: PAL.ad, h: "CENTER", v: "MIDDLE", fmt: "0.00%", borders: box },
  moneyCalc: { sz: 10, color: PAL.gray, fill: PAL.calc, h: "CENTER", v: "MIDDLE", fmt: MONEY, borders: bottom },
  moneyKey: { sz: 10, color: PAL.gray, fill: PAL.calc, h: "CENTER", v: "MIDDLE", fmt: MONEY, borders: { ...sides, ...bottom } },
  intKey: { sz: 10, color: PAL.gray, fill: PAL.calc, h: "CENTER", v: "MIDDLE", fmt: "#,##0", borders: { ...sides, ...bottom } },
  pctKey: { sz: 10, color: PAL.gray, fill: PAL.calc, h: "CENTER", v: "MIDDLE", fmt: "0.00%", borders: { ...sides, ...bottom } },
  cellIn: { sz: 10, fill: PAL.input, h: "CENTER", v: "MIDDLE", borders: bottom },
  noteB: { sz: 10, fill: PAL.white, v: "MIDDLE", wrap: true, borders: bottom },

  textCalc: { sz: 10, color: PAL.gray, fill: PAL.calc, h: "CENTER", v: "MIDDLE", borders: bottom },
  dateIn: { sz: 10, fill: PAL.input, h: "CENTER", v: "MIDDLE", fmt: "dd/mm/yyyy", borders: bottom },
  intIn: { sz: 10, fill: PAL.input, h: "CENTER", v: "MIDDLE", fmt: "#,##0", borders: bottom },
  moneyCalcR: { sz: 10, color: PAL.gray, fill: PAL.calc, h: "RIGHT", v: "MIDDLE", fmt: MONEY, borders: bottom },
  intCalc: { sz: 10, color: PAL.gray, fill: PAL.calc, h: "CENTER", v: "MIDDLE", fmt: "#,##0", borders: bottom },
  oNoteA: { sz: 10, fill: PAL.white, h: "LEFT", v: "MIDDLE", borders: bottom },
};

// Conditional-format colours as [text, fill]. A null text keeps the cell's own colour.
const CF = {
  red: ["#991B1B", "#FEE2E2"], yellow: ["#854D0E", "#FEF9C3"], green: ["#166534", "#DCFCE7"],
  grey: ["#6B7280", "#E5E7EB"], blue: ["#1E40AF", "#DBEAFE"], band: [null, PAL.band],
};

// Fee formulas. Row 3 on Inventory, row 2 on Orders; repeatCell moves the row numbers down.
// Each fee line is rounded to 2 decimals, like eBay's invoice lines. feeMath below mirrors them.
const FORMULA = {
  sku: '=IF($B3="","","{PFX}"&TEXT(ROW()-2,"00"))',
  adCost: '=IFERROR(IF(OR($E3="",$F3=""),"",ROUND($E3*(1+$N$1)*$F3*(1+$J$1),2)),"")',
  ebayFee:
    '=IFERROR(IF($E3="","",ROUND((ROUND($E3*(1+$N$1)*$B$1,2)+ROUND($E3*(1+$N$1)*$D$1,2)+ROUND($E3*(1+$N$1)*$L$1,2))*(1+$J$1),2)),"")',
  orderFee: '=IFERROR(IF($E3="","",ROUND(IF($E3*(1+$N$1)<=10,$F$1,$H$1)*(1+$J$1),2)),"")',
  net: '=IFERROR(IF(OR($D3="",$E3=""),"",ROUND($E3-$D3-N($G3)-$H3-$I3,2)),"")',
  netHome: '=IFERROR(IF($J3="","",ROUND($J3*Dashboard!$D$2,0)),"")',
  margin: '=IFERROR(IF(OR($J3="",N($E3)=0),"",$J3/$E3),"")',
  orderName: '=IF($B2="","",IFERROR(VLOOKUP($B2,Inventory!$A:$B,2,0),""))',
  orderSell: '=IF($B2="","",IFERROR(VLOOKUP($B2,Inventory!$A:$E,5,0)*IF($E2="",1,$E2),""))',
  orderCost: '=IF($B2="","",IFERROR(VLOOKUP($B2,Inventory!$A:$D,4,0)*IF($E2="",1,$E2),""))',
  orderProfit:
    '=IF($B2="","",IFERROR(ROUND($F2-$G2' +
    "-ROUND($F2*(1+Inventory!$N$1)*IFERROR(N(VLOOKUP($B2,Inventory!$A:$F,6,0)),0)*(1+Inventory!$J$1),2)" +
    "-ROUND((ROUND($F2*(1+Inventory!$N$1)*Inventory!$B$1,2)+ROUND($F2*(1+Inventory!$N$1)*Inventory!$D$1,2)+ROUND($F2*(1+Inventory!$N$1)*Inventory!$L$1,2))*(1+Inventory!$J$1),2)" +
    '-ROUND(IF($F2*(1+Inventory!$N$1)<=10,Inventory!$F$1,Inventory!$H$1)*(1+Inventory!$J$1),2),2),""))',
  orderHome: '=IFERROR(IF($H2="","",ROUND($H2*Dashboard!$D$2,0)),"")',
};

// {CUR} marketplace currency, {HOME} the user's currency, {SYM} the marketplace symbol,
// {RATE} the fallback rate, {PFX} the SKU prefix. All of them are validated before they are filled in.
const TEMPLATE = {
  dashboard: {
    title: "Dashboard", rows: 15, cols: 4, frozenRows: 0,
    colWidths: [19, 229, 47, 171],
    rowHeights: [{ from: 1, to: 15, px: 44 }],
    hiddenRows: [[1, 4]],
    merges: ["B2:C2", "B3:D3", "B5:D5"],
    cells: {
      B2: { v: "⚙  {HOME} / {CUR} Exchange Rate", s: "rateLabel" },
      D2: {
        f: '=IFERROR(GOOGLEFINANCE("CURRENCY:{CUR}{HOME}"),{RATE})', s: "rateValue",
        note: "Live rate from Google Finance. The value after the comma is the fallback.\nEvery {HOME} figure in this workbook reads from this cell.",
      },
      B3: { v: "← Update this cell whenever the exchange rate changes", s: "hint" },
      B5: { v: "BUSINESS OVERVIEW", s: "title" },
      B6: { v: "Metric", s: "subL" }, C6: { s: "subL" }, D6: { v: "Value", s: "subC" },
      B7: { v: "Total Products Listed", s: "mLabelA" }, C7: { s: "mGapA" },
      D7: { f: '=COUNTIF(Inventory!$M$3:$M$1000,"Listed")', s: "mValueA" },
      B8: { v: "Total Orders", s: "mLabelB" }, C8: { s: "mGapB" },
      D8: { f: '=COUNTIFS(Orders!$A$2:$A$1001,"<>",Orders!$J$2:$J$1001,"<>Cancelled")', s: "mIntB" },
      B9: { v: "Total Units Sold", s: "mLabelA" }, C9: { s: "mGapA" },
      D9: {
        f: '=IFERROR(SUMPRODUCT((Orders!$B$2:$B$1001<>"")*(Orders!$J$2:$J$1001<>"Cancelled")*(Orders!$E$2:$E$1001+(Orders!$E$2:$E$1001=""))),0)',
        s: "mValueA",
      },
      B10: { v: "Total Revenue ({CUR})", s: "mLabelB" }, C10: { s: "mGapB" },
      D10: { f: '=IFERROR(SUMIFS(Orders!$F$2:$F$1001,Orders!$J$2:$J$1001,"<>Cancelled"),0)', s: "mMoneyB" },
      B11: { v: "Total Revenue ({HOME})", s: "mLabelA" }, C11: { s: "mGapA" },
      D11: { f: "=IFERROR($D$10*$D$2,0)", s: "mValueA" },
      B12: { v: "Total Profit ({CUR})", s: "mLabelB" }, C12: { s: "mGapB" },
      D12: { f: '=IFERROR(SUMIFS(Orders!$H$2:$H$1001,Orders!$J$2:$J$1001,"<>Cancelled"),0)', s: "mMoneyB" },
      B13: { v: "Total Profit ({HOME})", s: "mLabelA" }, C13: { s: "mGapA" },
      D13: { f: "=IFERROR($D$12*$D$2,0)", s: "mValueA" },
      B14: {
        v: "Average Margin %", s: "mLabelB",
        note: "Total profit divided by total revenue, from the Orders tab. Cancelled orders are excluded.",
      },
      C14: { s: "mGapB" }, D14: { f: "=IFERROR($D$12/$D$10,0)", s: "mPctB" },
      B15: { v: "Pending Orders", s: "mLabelA" }, C15: { s: "mGapA" },
      D15: { f: '=COUNTIF(Orders!$J$2:$J$1001,"Pending")+COUNTIF(Orders!$J$2:$J$1001,"Ordered")', s: "mValueA" },
    },
  },

  inventory: {
    title: "Inventory", rows: 1000, cols: 15, frozenRows: 2,
    colWidths: [124, 227, 138, 119, 155, 125, 125, 125, 125, 125, 125, 125, 129, 238, 100],
    rowHeights: [{ from: 1, to: 1, px: 43 }, { from: 2, to: 2, px: 37 }, { from: 3, to: 1000, px: 43 }],
    hiddenRows: [[1, 1]], // the fee settings strip
    hiddenCols: ["G:I", "O:O"], // ad cost, eBay fee, order fee, and the image URL
    header: {
      row: 2, style: "head",
      values: [
        "SKU", "Product Name", "Supplier URL", "Cost Price ({CUR})", "Sell Price ({CUR})", "Ad Rate %",
        "Ad Cost ({CUR})", "eBay Fee ({CUR})", "Order Fee ({CUR})", "Net Profit ({CUR})", "Net Profit ({HOME})",
        "Margin %", "Status", "Notes", "Image URL",
      ],
      notes: {
        E: "Enter the full amount the buyer pays, including any postage you charge.\neBay calculates its fees on that total.",
        I: "Per-order fee, including tax on fees where it applies.",
      },
    },
    // Rows 3 to 1000. `f` is the row-3 formula; repeatCell moves its references down. `key` names the
    // column in the sheet config (see TEMPLATE_LAYOUT).
    columns: [
      { col: "A", key: "sku", s: "sku", f: FORMULA.sku },
      { col: "B", key: "name", s: "name" },
      { col: "C", key: "link", s: "url" },
      { col: "D", key: "cost", s: "moneyIn" },
      { col: "E", key: "sell", s: "moneyIn" },
      { col: "F", s: "pctIn" },
      { col: "G", s: "moneyCalc", f: FORMULA.adCost },
      { col: "H", s: "moneyCalc", f: FORMULA.ebayFee },
      { col: "I", s: "moneyCalc", f: FORMULA.orderFee },
      { col: "J", key: "profit", s: "moneyKey", f: FORMULA.net },
      { col: "K", s: "intKey", f: FORMULA.netHome },
      { col: "L", key: "margin", s: "pctKey", f: FORMULA.margin },
      { col: "M", key: "status", s: "cellIn" },
      { col: "N", s: "noteB" },
      { col: "O", key: "image" },
    ],
    validations: [{ range: "M3:M1000", list: ["Not Listed", "Listed", "Draft", "Discontinued"] }],
    conditionalFormats: [
      { range: "L3:L1000", type: "NUMBER_LESS", values: ["0.15"], color: CF.red },
      { range: "L3:L1000", type: "NUMBER_BETWEEN", values: ["0.15", "0.25"], color: CF.yellow },
      { range: "L3:L1000", type: "NUMBER_GREATER", values: ["0.25"], color: CF.green },
      { range: "M3:M1000", type: "CUSTOM_FORMULA", values: ['=OR($M3="Paused",$M3="Discontinued")'], color: CF.grey },
      { range: "N3:N1000", type: "CUSTOM_FORMULA", values: ["=ISODD(ROW())"], color: CF.band }, // alternate rows
    ],
  },

  orders: {
    title: "Orders", rows: 1001, cols: 12, frozenRows: 1,
    colWidths: [131, 75, 215, 103, 68, 117, 117, 103, 117, 103, 149, 173],
    rowHeights: [{ from: 1, to: 1001, px: 32 }],
    header: {
      row: 1, style: "head",
      values: [
        "Order Number", "SKU", "Product Name", "Order Date", "QTY", "Sell Price ({CUR})", "Cost Price ({CUR})",
        "Profit ({CUR})", "Profit ({HOME})", "Status", "Tracking Number", "Notes",
      ],
      notes: {
        E: "Units bought in this order. Leave blank and it is treated as 1.\nSell Price, Cost Price and Profit are line totals for the quantity entered.",
        H: "Line profit after eBay fees. Rates are read from row 1 of the Inventory tab; the ad rate is read per SKU from Inventory column F.\nThe per-order fee is charged once per order.",
      },
    },
    columns: [
      { col: "A", key: "no", s: "cellIn" },
      { col: "B", key: "sku", s: "cellIn" },
      { col: "C", s: "textCalc", f: FORMULA.orderName },
      { col: "D", key: "date", s: "dateIn" },
      { col: "E", key: "qty", s: "intIn" },
      { col: "F", key: "sell", s: "moneyCalcR", f: FORMULA.orderSell },
      { col: "G", key: "cost", s: "moneyCalcR", f: FORMULA.orderCost },
      { col: "H", key: "profit", s: "moneyCalcR", f: FORMULA.orderProfit },
      { col: "I", s: "intCalc", f: FORMULA.orderHome },
      { col: "J", key: "status", s: "cellIn" },
      { col: "K", key: "track", s: "cellIn" },
      { col: "L", key: "notes", s: "oNoteA" },
    ],
    validations: [{ range: "J2:J1001", list: ["Pending", "Ordered", "Shipped", "Delivered", "Cancelled", "Disputed"] }],
    conditionalFormats: [
      { range: "J2:J1001", type: "CUSTOM_FORMULA", values: ['=$J2="Pending"'], color: CF.yellow },
      { range: "J2:J1001", type: "CUSTOM_FORMULA", values: ['=OR($J2="Ordered",$J2="Shipped")'], color: CF.blue },
      { range: "J2:J1001", type: "CUSTOM_FORMULA", values: ['=$J2="Delivered"'], color: CF.green },
      { range: "J2:J1001", type: "CUSTOM_FORMULA", values: ['=OR($J2="Cancelled",$J2="Disputed")'], color: CF.red },
      { range: "L2:L1001", type: "CUSTOM_FORMULA", values: ["=ISODD(ROW())"], color: CF.band },
    ],
  },
};

// Row 1 of Inventory (hidden): seven label/value pairs the fee formulas read.
// The rates are defaults. International fee and tax on fees could not be checked against a real
// order, so both carry a note saying so. Every value stays an editable cell.
const REGION_SHEETS = {
  UK: { fvf: 0.129, regOp: 0.0035, feeTax: 0.2, intl: 0.0155, buyerTax: 0, taxLabel: "VAT", buyerLabel: "Buyer VAT" },
  US: { fvf: 0.136, regOp: 0, feeTax: 0, intl: 0.0155, buyerTax: 0, taxLabel: "Tax on fees", buyerLabel: "Buyer sales tax (est.)" },
};

function stripPairs(r) {
  const check = "This is a default. Check it against the fee breakdown of a real order.";
  return [
    ["eBay FVF Rate:", r.fvf, "setPct",
      "Final value fee, charged on the total the buyer pays (item + postage + tax). The rate depends on the category you list in."],
    ["  Reg. Op. Fee:", r.regOp, "setPct",
      "Regulatory operating fee, a percentage of the total sale where eBay charges one. Leave at 0 if yours does not."],
    ["  Order Fee (≤{SYM}10):", 0.3, "setMoney", "Per-order fee for orders with a total of {SYM}10.00 or less."],
    ["  Order Fee (>{SYM}10):", 0.4, "setMoney",
      "Per-order fee for orders over {SYM}10.00. The formulas pick the right fee from the sell price."],
    [`  ${r.taxLabel}:`, r.feeTax, "setPct", `Tax charged on top of eBay's fees. ${check} Set to 0 if you do not pay it.`],
    ["  Int'l:", r.intl, "setPct",
      `International fee, a percentage of the total sale, charged when the buyer is outside the country your eBay account is registered in. ${check} Set to 0 for domestic sales.`],
    [`  ${r.buyerLabel}:`, r.buyerTax, "setPct",
      "Set this if eBay adds tax on top of your listed price; fees are charged on the total. 0 means none."],
  ];
}

/* Sheets API request builders */

const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const colLetter = (i) => (i >= 26 ? colLetter(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));
const rgb = (hex) => ({
  red: parseInt(hex.slice(1, 3), 16) / 255,
  green: parseInt(hex.slice(3, 5), 16) / 255,
  blue: parseInt(hex.slice(5, 7), 16) / 255,
});
const fillIn = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

// "B2:C2", "B2" or "A3:A1000" as a GridRange.
function gridRange(sheetId, a1) {
  const [, c1, r1, c2 = c1, r2 = r1] = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a1);
  return {
    sheetId,
    startRowIndex: r1 - 1,
    endRowIndex: Number(r2),
    startColumnIndex: colIndex(c1),
    endColumnIndex: colIndex(c2) + 1,
  };
}

const numberFormat = (pattern) => ({
  type: pattern.startsWith('"') ? "CURRENCY" : pattern.endsWith("%") ? "PERCENT" : pattern.includes("dd") ? "DATE" : "NUMBER",
  pattern,
});

function cellFormat(name, vars) {
  const s = STYLES[name];
  const textFormat = { fontFamily: "Arial", fontSize: s.sz };
  if (s.bold) textFormat.bold = true;
  if (s.italic) textFormat.italic = true;
  if (s.color) textFormat.foregroundColor = rgb(s.color);
  const f = { textFormat };
  if (s.fill) f.backgroundColor = rgb(s.fill);
  if (s.h) f.horizontalAlignment = s.h;
  if (s.v) f.verticalAlignment = s.v;
  if (s.wrap) f.wrapStrategy = "WRAP";
  if (s.fmt) f.numberFormat = numberFormat(fillIn(s.fmt, vars));
  if (s.borders) {
    f.borders = Object.fromEntries(
      Object.entries(s.borders).map(([side, [style, color]]) => [side, { style, color: rgb(color) }]),
    );
  }
  return f;
}

function cellData(c, vars) {
  const out = {};
  if (c.f) out.userEnteredValue = { formulaValue: fillIn(c.f, vars) };
  else if (typeof c.v === "number") out.userEnteredValue = { numberValue: c.v };
  else if (c.v !== undefined) out.userEnteredValue = { stringValue: fillIn(c.v, vars) };
  if (c.s) out.userEnteredFormat = cellFormat(c.s, vars);
  if (c.note) out.note = fillIn(c.note, vars);
  return out;
}

const dimension = (sheetId, dim, from, to, properties) => ({
  updateDimensionProperties: {
    range: { sheetId, dimension: dim, startIndex: from, endIndex: to },
    properties,
    fields: Object.keys(properties).join(","),
  },
});

// The cells of one tab that are single values or labels: the fixed text, header row and, on
// Inventory, the fee strip. Returns { A1: cell, ... }.
function fixedCells(key, tab, region) {
  const cells = { ...tab.cells };
  tab.header?.values.forEach((v, i) => {
    const col = colLetter(i);
    cells[col + tab.header.row] = { v, s: tab.header.style, note: tab.header.notes[col] };
  });
  if (key === "inventory") {
    stripPairs(REGION_SHEETS[region]).forEach(([label, value, style, note], i) => {
      cells[colLetter(i * 2) + 1] = { v: label, s: "setLabel" };
      cells[colLetter(i * 2 + 1) + 1] = { v: value, s: style, note };
    });
  }
  return cells;
}

function tabRequests(key, tab, sheetId, region, vars) {
  const out = [];
  out.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: tab.frozenRows, hideGridlines: true } },
      fields: "gridProperties.frozenRowCount,gridProperties.hideGridlines",
    },
  });
  tab.colWidths.forEach((px, i) => out.push(dimension(sheetId, "COLUMNS", i, i + 1, { pixelSize: px })));
  for (const { from, to, px } of tab.rowHeights) out.push(dimension(sheetId, "ROWS", from - 1, to, { pixelSize: px }));
  for (const [from, to] of tab.hiddenRows ?? []) out.push(dimension(sheetId, "ROWS", from - 1, to, { hiddenByUser: true }));
  for (const span of tab.hiddenCols ?? []) {
    const [a, b] = span.split(":");
    out.push(dimension(sheetId, "COLUMNS", colIndex(a), colIndex(b) + 1, { hiddenByUser: true }));
  }

  for (const [a1, cell] of Object.entries(fixedCells(key, tab, region))) {
    const g = gridRange(sheetId, a1);
    out.push({
      updateCells: {
        start: { sheetId, rowIndex: g.startRowIndex, columnIndex: g.startColumnIndex },
        rows: [{ values: [cellData(cell, vars)] }],
        fields: "userEnteredValue,userEnteredFormat,note",
      },
    });
  }
  for (const a1 of tab.merges ?? []) {
    out.push({ mergeCells: { range: gridRange(sheetId, a1), mergeType: "MERGE_ALL" } });
  }

  // One repeatCell per column: formats and, for formula columns, the formula for every data row.
  const first = (tab.header?.row ?? 0) + 1;
  for (const { col, s, f } of tab.columns ?? []) {
    if (!s) continue;
    out.push({
      repeatCell: {
        range: gridRange(sheetId, `${col}${first}:${col}${tab.rows}`),
        cell: cellData({ s, f }, vars),
        fields: f ? "userEnteredValue,userEnteredFormat" : "userEnteredFormat",
      },
    });
  }

  for (const { range, list } of tab.validations ?? []) {
    out.push({
      setDataValidation: {
        range: gridRange(sheetId, range),
        rule: {
          condition: { type: "ONE_OF_LIST", values: list.map((userEnteredValue) => ({ userEnteredValue })) },
          strict: false, // a typed value that is not in the list is accepted, as in the owner's template
          showCustomUi: true,
        },
      },
    });
  }
  (tab.conditionalFormats ?? []).forEach(({ range, type, values, color: [text, fill] }, index) => {
    out.push({
      addConditionalFormatRule: {
        index,
        rule: {
          ranges: [gridRange(sheetId, range)],
          booleanRule: {
            condition: { type, values: values.map((userEnteredValue) => ({ userEnteredValue })) },
            format: { backgroundColor: rgb(fill), ...(text && { textFormat: { foregroundColor: rgb(text) } }) },
          },
        },
      },
    });
  });
  return out;
}

// Everything that goes into the new sheet's cells comes from here, so every value that ends up
// inside a formula is checked first. Returns { createBody, setup(sheetIds), config }.
//   createBody: the spreadsheets.create body (three empty tabs with their grid sizes).
//   setup(ids): the one batchUpdate list that fills them; ids are the tabs' sheetIds in order.
//   config: the sheet settings to save, so the new sheet works like a manual one.
function buildWorkbook({ name, region, homeCurrency, rate, skuPrefix = TEMPLATE_LAYOUT.skuPrefix }) {
  if (!Object.hasOwn(REGIONS, region)) throw new Error("Choose eBay UK or eBay US.");
  const title = String(name ?? "").trim().slice(0, 40);
  if (!title) throw new Error("Give the sheet a name.");
  const home = String(homeCurrency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(home)) throw new Error("Use a 3-letter currency code, like PKR.");
  const fallback = rate === "" || rate == null ? null : Number(rate);
  if (fallback !== null && !(fallback >= 1e-6 && fallback <= 1e7)) {
    throw new Error("Enter an exchange rate above 0, or leave it empty.");
  }
  if (typeof skuPrefix !== "string" || !/^[A-Za-z0-9-]{0,8}$/.test(skuPrefix)) {
    throw new Error("Use 8 characters or fewer for the SKU prefix: letters, numbers and dashes.");
  }

  const reg = REGIONS[region];
  // No fallback rate gives an empty cell, so a failed lookup shows blanks, not a made-up figure.
  const vars = { CUR: reg.currency, HOME: home, SYM: reg.symbol, PFX: skuPrefix, RATE: fallback === null ? '""' : String(fallback) };
  const tabs = Object.entries(TEMPLATE);
  if (home === reg.currency) {
    // Same currency on both sides: the rate is 1, so there is nothing to look up.
    const dash = TEMPLATE.dashboard;
    const D2 = { ...dash.cells.D2, f: undefined, v: 1, note: "Both currencies are the same, so the rate is 1." };
    tabs[0] = ["dashboard", { ...dash, cells: { ...dash.cells, D2 } }];
  }
  return {
    createBody: {
      properties: { title },
      sheets: tabs.map(([, t]) => ({
        properties: { title: t.title, gridProperties: { rowCount: t.rows, columnCount: t.cols } },
      })),
    },
    setup: (ids) => tabs.flatMap(([key, t], i) => tabRequests(key, t, ids[i], region, vars)),
    config: { ...TEMPLATE_LAYOUT, skuPrefix, region },
  };
}

/* A JS copy of the fee formulas, for tests. s = { fvf, regOp, intl, feeTax, buyerTax, orderLow, orderHigh, threshold, rate } */

// Spreadsheet ROUND: half away from zero, and 1.005 rounds to 1.01 like a decimal would.
const round = (x, digits) => (Math.sign(x) * Math.round(Number((Math.abs(x) * 10 ** digits).toPrecision(14)))) / 10 ** digits;
const r2 = (x) => round(x, 2);

function feeMath({ sell, cost, adRate = 0 }, s) {
  const base = sell * (1 + s.buyerTax);
  const ad = adRate ? r2(base * adRate * (1 + s.feeTax)) : 0;
  const ebay = r2((r2(base * s.fvf) + r2(base * s.regOp) + r2(base * s.intl)) * (1 + s.feeTax));
  const order = r2((base <= s.threshold ? s.orderLow : s.orderHigh) * (1 + s.feeTax));
  const net = r2(sell - cost - ad - ebay - order);
  return { ad, ebay, order, net, home: round(net * s.rate, 0), margin: net / sell };
}

if (typeof module !== "undefined") {
  module.exports = { TEMPLATE, FORMULA, REGION_SHEETS, STYLES, buildWorkbook, feeMath, stripPairs };
}
