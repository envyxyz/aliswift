const { test } = require("node:test");
const assert = require("node:assert/strict");

// template.js reads REGIONS and TEMPLATE_LAYOUT as globals, the way the service worker has them.
const shared = require("../lib/shared.js");
Object.assign(globalThis, shared);
const { TEMPLATE, REGION_SHEETS, buildWorkbook, feeMath } = require("../lib/template.js");
const { TEMPLATE_LAYOUT } = shared;

const IDS = [10, 20, 30]; // Dashboard, Inventory, Orders
const build = (extra = {}) =>
  buildWorkbook({ name: "My store", region: "UK", homeCurrency: "pkr", rate: 374.37, ...extra });
const setup = (extra) => build(extra).setup(IDS);

const col = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// The userEnteredValue written to A1 `cell` of sheet `sheetId` by an updateCells request.
function written(reqs, sheetId, cell) {
  const [, letters, row] = /([A-Z]+)(\d+)/.exec(cell);
  const hit = reqs.find(
    (r) =>
      r.updateCells?.start.sheetId === sheetId &&
      r.updateCells.start.rowIndex === row - 1 &&
      r.updateCells.start.columnIndex === col(letters),
  );
  return hit?.updateCells.rows[0].values[0];
}

// The cell a repeatCell wrote down the whole of column `letters` from `firstRow`.
function repeated(reqs, sheetId, letters, firstRow) {
  return reqs.find(
    (r) =>
      r.repeatCell?.range.sheetId === sheetId &&
      r.repeatCell.range.startColumnIndex === col(letters) &&
      r.repeatCell.range.startRowIndex === firstRow - 1,
  )?.repeatCell;
}

test("the workbook has the three tabs, sized like the template", () => {
  const { createBody } = build();
  assert.equal(createBody.properties.title, "My store");
  assert.deepEqual(
    createBody.sheets.map((s) => [s.properties.title, s.properties.gridProperties.rowCount, s.properties.gridProperties.columnCount]),
    [["Dashboard", 15, 4], ["Inventory", 1000, 15], ["Orders", 1001, 12]],
  );
});

test("headers are exact, with the marketplace and home currency filled in", () => {
  for (const [region, cur] of [["UK", "GBP"], ["US", "USD"], ["DE", "EUR"], ["AU", "AUD"]]) {
    const reqs = setup({ region });
    const header = (sheetId, row, n) =>
      Array.from({ length: n }, (_, i) => written(reqs, sheetId, `${String.fromCharCode(65 + i)}${row}`).userEnteredValue.stringValue);
    assert.deepEqual(header(20, 2, 15), [
      "SKU", "Product Name", "Supplier URL", `Cost Price (${cur})`, `Sell Price (${cur})`, "Ad Rate %",
      `Ad Cost (${cur})`, `eBay Fee (${cur})`, `Order Fee (${cur})`, `Net Profit (${cur})`, "Net Profit (PKR)",
      "Margin %", "Status", "Notes", "Image URL",
    ]);
    assert.deepEqual(header(30, 1, 12), [
      "Order Number", "SKU", "Product Name", "Order Date", "QTY", `Sell Price (${cur})`, `Cost Price (${cur})`,
      `Profit (${cur})`, "Profit (PKR)", "Status", "Tracking Number", "Notes",
    ]);
  }
});

test("the fee strip has the seven label and value pairs for each region", () => {
  const expected = {
    UK: [
      ["eBay FVF Rate:", 0.129], ["  Reg. Op. Fee:", 0.0035], ["  Order Fee (≤£10):", 0.3], ["  Order Fee (>£10):", 0.4],
      ["  VAT:", 0.2], ["  Int'l:", 0.0155], ["  Buyer VAT:", 0],
    ],
    US: [
      ["eBay FVF Rate:", 0.136], ["  Reg. Op. Fee:", 0], ["  Order Fee (≤$10):", 0.3], ["  Order Fee (>$10):", 0.4],
      ["  Tax on fees:", 0], ["  Int'l:", 0.0155], ["  Buyer sales tax (est.):", 0],
    ],
  };
  // The regions added later: the strip is built from REGION_SHEETS, so the labels follow the marketplace's symbol.
  for (const region of ["GLOBAL", "DE", "AU", "CA"]) {
    const r = REGION_SHEETS[region];
    const sym = REGIONS[region].symbol;
    expected[region] = [
      ["eBay FVF Rate:", r.fvf], ["  Reg. Op. Fee:", r.regOp], [`  Order Fee (≤${sym}10):`, r.orderLow], [`  Order Fee (>${sym}10):`, r.orderHigh],
      [`  ${r.taxLabel}:`, r.feeTax], ["  Int'l:", r.intl], [`  ${r.buyerLabel}:`, 0],
    ];
  }
  assert.deepEqual(Object.keys(REGION_SHEETS), Object.keys(REGIONS)); // a region without a fee strip can't build a sheet
  for (const region of Object.keys(REGIONS)) {
    const reqs = setup({ region, homeCurrency: "usd" });
    const pairs = expected[region].map((_, i) => [
      written(reqs, 20, `${String.fromCharCode(65 + i * 2)}1`).userEnteredValue.stringValue,
      written(reqs, 20, `${String.fromCharCode(66 + i * 2)}1`).userEnteredValue.numberValue,
    ]);
    assert.deepEqual(pairs, expected[region]);
    // The unconfirmed defaults say so in a cell note.
    for (const cell of ["J1", "L1"]) assert.match(written(reqs, 20, cell).note, /real order/);
  }
});

test("every formula column gets one repeatCell with the final formula text", () => {
  const inv = {
    A: '=IF($B3="","","SKU-"&TEXT(ROW()-2,"00"))',
    G: '=IFERROR(IF(OR($E3="",$F3=""),"",ROUND($E3*(1+$N$1)*$F3*(1+$J$1),2)),"")',
    H: '=IFERROR(IF($E3="","",ROUND((ROUND($E3*(1+$N$1)*$B$1,2)+ROUND($E3*(1+$N$1)*$D$1,2)+ROUND($E3*(1+$N$1)*$L$1,2))*(1+$J$1),2)),"")',
    I: '=IFERROR(IF($E3="","",ROUND(IF($E3*(1+$N$1)<=10,$F$1,$H$1)*(1+$J$1),2)),"")',
    J: '=IFERROR(IF(OR($D3="",$E3=""),"",ROUND($E3-$D3-N($G3)-$H3-$I3,2)),"")',
    K: '=IFERROR(IF($J3="","",ROUND($J3*Dashboard!$D$2,0)),"")',
    L: '=IFERROR(IF(OR($J3="",N($E3)=0),"",$J3/$E3),"")',
  };
  const orders = {
    C: '=IF($B2="","",IFERROR(VLOOKUP($B2,Inventory!$A:$B,2,0),""))',
    F: '=IF($B2="","",IFERROR(VLOOKUP($B2,Inventory!$A:$E,5,0)*IF($E2="",1,$E2),""))',
    G: '=IF($B2="","",IFERROR(VLOOKUP($B2,Inventory!$A:$D,4,0)*IF($E2="",1,$E2),""))',
    H:
      '=IF($B2="","",IFERROR(ROUND($F2-$G2-ROUND($F2*(1+Inventory!$N$1)*IFERROR(N(VLOOKUP($B2,Inventory!$A:$F,6,0)),0)*(1+Inventory!$J$1),2)' +
      "-ROUND((ROUND($F2*(1+Inventory!$N$1)*Inventory!$B$1,2)+ROUND($F2*(1+Inventory!$N$1)*Inventory!$D$1,2)+ROUND($F2*(1+Inventory!$N$1)*Inventory!$L$1,2))*(1+Inventory!$J$1),2)" +
      '-ROUND(IF($F2*(1+Inventory!$N$1)<=10,Inventory!$F$1,Inventory!$H$1)*(1+Inventory!$J$1),2),2),""))',
    I: '=IFERROR(IF($H2="","",ROUND($H2*Dashboard!$D$2,0)),"")',
  };
  for (const region of ["UK", "US"]) {
    const reqs = setup({ region });
    for (const [letters, f] of Object.entries(inv)) {
      const r = repeated(reqs, 20, letters, 3);
      assert.equal(r.cell.userEnteredValue.formulaValue, f, `Inventory ${letters}`);
      assert.equal(r.range.endRowIndex, 1000);
      assert.equal(r.range.endColumnIndex, col(letters) + 1);
      assert.equal(r.fields, "userEnteredValue,userEnteredFormat");
    }
    for (const [letters, f] of Object.entries(orders)) {
      const r = repeated(reqs, 30, letters, 2);
      assert.equal(r.cell.userEnteredValue.formulaValue, f, `Orders ${letters}`);
      assert.equal(r.range.endRowIndex, 1001);
    }
    // Input columns are formatted only, never given a value.
    assert.equal(repeated(reqs, 20, "D", 3).fields, "userEnteredFormat");
  }
});

test("the status lists are drop-downs that accept other values", () => {
  const rules = setup().filter((r) => r.setDataValidation);
  assert.equal(rules.length, 2);
  const [inv, ord] = rules.map((r) => r.setDataValidation);
  assert.deepEqual(inv.range, { sheetId: 20, startRowIndex: 2, endRowIndex: 1000, startColumnIndex: 12, endColumnIndex: 13 });
  assert.deepEqual(inv.rule.condition.values.map((v) => v.userEnteredValue), ["Not Listed", "Listed", "Draft", "Discontinued"]);
  assert.deepEqual(ord.range, { sheetId: 30, startRowIndex: 1, endRowIndex: 1001, startColumnIndex: 9, endColumnIndex: 10 });
  assert.deepEqual(
    ord.rule.condition.values.map((v) => v.userEnteredValue),
    ["Pending", "Ordered", "Shipped", "Delivered", "Cancelled", "Disputed"],
  );
  for (const r of [inv, ord]) {
    assert.equal(r.rule.condition.type, "ONE_OF_LIST");
    assert.equal(r.rule.strict, false);
    assert.equal(r.rule.showCustomUi, true);
  }
});

test("the fee strip and fee columns are hidden; the Image URL column is in view, with its title", () => {
  const hidden = setup()
    .filter((r) => r.updateDimensionProperties?.properties.hiddenByUser)
    .map(({ updateDimensionProperties: { range: r } }) => [r.sheetId, r.dimension, r.startIndex, r.endIndex]);
  assert.deepEqual(hidden, [
    [10, "ROWS", 0, 4], // the Dashboard's exchange-rate block
    [20, "ROWS", 0, 1], // the fee strip
    [20, "COLUMNS", 6, 9], // G:I
  ]);
  assert.equal(TEMPLATE.inventory.header.values[14], "Image URL"); // column O, the one the saved settings point at
  assert.match(TEMPLATE.inventory.header.notes.O, /photo/);
});

test("with the same currency on both sides the repeated home-currency rows and columns are hidden", () => {
  const hiddenOf = (extra) =>
    setup(extra)
      .filter((r) => r.updateDimensionProperties?.properties.hiddenByUser)
      .map(({ updateDimensionProperties: { range: r } }) => [r.sheetId, r.dimension, r.startIndex, r.endIndex]);
  assert.deepEqual(hiddenOf({ homeCurrency: "GBP" }), [
    [10, "ROWS", 0, 4],
    [10, "ROWS", 10, 11], // Total Revenue (home)
    [10, "ROWS", 12, 13], // Total Profit (home)
    [20, "ROWS", 0, 1],
    [20, "COLUMNS", 6, 9],
    [20, "COLUMNS", 10, 11], // Net Profit (home)
    [30, "COLUMNS", 8, 9], // Profit (home)
  ]);
  // The next sheet, with different currencies, is unaffected.
  assert.equal(hiddenOf({}).length, 3);
});

test("only the sheet ids Google returned are used, and rows are frozen as in the template", () => {
  const reqs = setup();
  const used = new Set(JSON.stringify(reqs).match(/"sheetId":\d+/g));
  assert.deepEqual([...used].sort(), ['"sheetId":10', '"sheetId":20', '"sheetId":30']);
  const frozen = reqs.filter((r) => r.updateSheetProperties).map((r) => r.updateSheetProperties.properties.gridProperties);
  assert.deepEqual(frozen.map((g) => g.frozenRowCount), [0, 2, 1]);
  assert.ok(frozen.every((g) => g.hideGridlines === true));
});

test("the config saved for a new sheet matches the template's own columns", () => {
  const { config } = build({ skuPrefix: "UK-" });
  assert.deepEqual(config, { ...TEMPLATE_LAYOUT, skuPrefix: "UK-", region: "UK" });

  // TEMPLATE_LAYOUT is what the Edit dialog's preset fills in; it must agree with the workbook.
  const keyed = (tab) => Object.fromEntries(tab.columns.filter((c) => c.key).map((c) => [c.key, c.col]));
  const inv = keyed(TEMPLATE.inventory);
  const L = TEMPLATE_LAYOUT;
  assert.deepEqual(
    { skuCol: inv.sku, keywordsCol: inv.name, linkCol: inv.link, priceCol: inv.cost, salePriceCol: inv.sell, statusCol: inv.status, imageCol: inv.image, profitCol: inv.profit, marginCol: inv.margin },
    { skuCol: L.skuCol, keywordsCol: L.keywordsCol, linkCol: L.linkCol, priceCol: L.priceCol, salePriceCol: L.salePriceCol, statusCol: L.statusCol, imageCol: L.imageCol, profitCol: L.profitCol, marginCol: L.marginCol },
  );
  assert.deepEqual(keyed(TEMPLATE.orders), L.oCols);
  assert.equal(TEMPLATE.inventory.title, L.sheetTab);
  assert.equal(TEMPLATE.orders.title, L.oTab);
  assert.equal(TEMPLATE.inventory.header.row + 1, L.startRow);
  assert.equal(TEMPLATE.orders.header.row + 1, L.oRow);
});

test("nothing the user types can become part of a formula", () => {
  const bad = [
    { homeCurrency: 'PKR")+1' }, { homeCurrency: "PK" }, { homeCurrency: "PKRR" }, { homeCurrency: "" },
    { skuPrefix: 'SKU-"&A1&"' }, { skuPrefix: "123456789" }, { skuPrefix: "A B" },
    { rate: -1 }, { rate: 0 }, { rate: "1+1" }, { rate: NaN }, { rate: 1e12 }, { rate: "1e-9" },
    { region: "XX" }, { region: "__proto__" }, { name: "  " },
  ];
  for (const extra of bad) assert.throws(() => build(extra), Error, JSON.stringify(extra));
  // A name only ever becomes the file title, as text.
  const { createBody } = build({ name: '=HYPERLINK("http://evil")' });
  assert.equal(createBody.properties.title, '=HYPERLINK("http://evil")');
  assert.ok(!JSON.stringify(setup({ name: "=1+1" })).includes("=1+1"));
});

test("the exchange rate is a live lookup with a fallback, or 1 when both currencies match", () => {
  const rate = (extra) => written(setup(extra), 10, "D2");
  assert.equal(rate().userEnteredValue.formulaValue, '=IFERROR(GOOGLEFINANCE("CURRENCY:GBPPKR"),374.37)');
  assert.equal(rate({ rate: "" }).userEnteredValue.formulaValue, '=IFERROR(GOOGLEFINANCE("CURRENCY:GBPPKR"),"")');
  assert.equal(rate({ region: "US", homeCurrency: "eur", rate: null }).userEnteredValue.formulaValue, '=IFERROR(GOOGLEFINANCE("CURRENCY:USDEUR"),"")');
  assert.deepEqual(rate({ homeCurrency: "GBP" }).userEnteredValue, { numberValue: 1 });
  // Building a same-currency sheet must not change the template for the next one.
  assert.match(rate().userEnteredValue.formulaValue, /GOOGLEFINANCE/);
});

test("alternate rows of the notes columns are banded by a rule, not 1000 requests", () => {
  const reqs = setup();
  assert.ok(reqs.length < 200, `${reqs.length} requests`);
  const rules = reqs.filter((r) => r.addConditionalFormatRule).map((r) => r.addConditionalFormatRule);
  assert.equal(rules.filter((r) => r.rule.booleanRule.condition.values[0].userEnteredValue === "=ISODD(ROW())").length, 2);
  // Rule indexes run 0..n-1 within each sheet.
  for (const id of [20, 30]) {
    const idx = rules.filter((r) => r.rule.ranges[0].sheetId === id).map((r) => r.index);
    assert.deepEqual(idx, idx.map((_, i) => i));
  }
});

/* Fee maths */

const UK = { fvf: 0.129, regOp: 0.0035, intl: 0, feeTax: 0.2, buyerTax: 0, orderLow: 0.3, orderHigh: 0.4, threshold: 10, rate: 374.37 };
const US = { fvf: 0.136, regOp: 0, intl: 0.0155, feeTax: 0, buyerTax: 0, orderLow: 0.3, orderHigh: 0.4, threshold: 10, rate: 277.8 };

test("feeMath reproduces the worked examples to the penny", () => {
  const rows = [
    [UK, { cost: 5.6, sell: 9.59 }, { ebay: 1.52, order: 0.36, net: 2.11 }],
    [UK, { cost: 11.19, sell: 33.99 }, { ebay: 5.4, order: 0.48, net: 16.92 }],
    [UK, { cost: 0.8, sell: 2.71 }, { ebay: 0.43, order: 0.36, net: 1.12 }],
    [UK, { cost: 6.04, sell: 9 }, { ebay: 1.43, order: 0.36, net: 1.17 }],
    [US, { cost: 24, sell: 34 }, { ebay: 5.15, order: 0.4, net: 4.45 }],
    [US, { cost: 23, sell: 36 }, { ebay: 5.46, order: 0.4, net: 7.14 }],
  ];
  for (const [s, row, want] of rows) {
    const got = feeMath(row, s);
    assert.deepEqual({ ebay: got.ebay, order: got.order, net: got.net }, want, JSON.stringify(row));
  }
  // Ad rate, buyer tax on top, and the order-fee threshold moving with it.
  const ad = feeMath({ cost: 5, sell: 20, adRate: 0.1 }, UK);
  assert.equal(ad.ad, 2.4);
  const taxed = feeMath({ cost: 5, sell: 9, adRate: 0 }, { ...UK, buyerTax: 0.2 });
  assert.equal(taxed.order, 0.48); // 9 * 1.2 = 10.8 is over the threshold
  const first = feeMath({ cost: 5.6, sell: 9.59 }, UK);
  assert.equal(first.home, Math.round(2.11 * 374.37));
  assert.equal(first.margin, 2.11 / 9.59);
});

/* A small evaluator for the functions the template's formulas use, so the formula text itself is
   tested against feeMath, not just compared with a copy of itself. */

class SheetError extends Error {}
const TOKEN = /"(?:[^"]|"")*"|\d+(?:\.\d+)?|[A-Z]+(?=\()|(?:[A-Za-z]+!)?\$?[A-Z]{1,2}\$?\d+(?::\$?[A-Z]{1,2}\$?\d+)?|(?:[A-Za-z]+!)?\$?[A-Z]+:\$?[A-Z]+|<>|<=|>=|[-+*/&=<>(),]/g;

function compile(formula) {
  const toks = formula.slice(1).match(TOKEN);
  assert.equal(toks.join(""), formula.slice(1), "tokenizer dropped text");
  let i = 0;
  const peek = () => toks[i];
  const eat = () => toks[i++];
  const num = (v) => {
    if (v === undefined) return 0;
    if (typeof v === "number") return v;
    throw new SheetError("#VALUE!");
  };
  const same = (a, b) => (a ?? (typeof b === "string" ? "" : 0)) === (b ?? (typeof a === "string" ? "" : 0));
  const level = (sub, ops) => () => {
    let l = sub();
    while (Object.hasOwn(ops, peek())) {
      const f = ops[eat()];
      const [a, r] = [l, sub()];
      l = (e) => f(a(e), r(e));
    }
    return l;
  };
  const round = (v, n) => Math.sign(v) * Math.round(Number((Math.abs(v) * 10 ** n).toPrecision(14))) / 10 ** n;
  const FUNCS = {
    IF: (e, [c, a, b]) => (c(e) ? a(e) : b(e)),
    IFERROR: (e, [a, b]) => {
      try {
        return a(e);
      } catch (err) {
        if (err instanceof SheetError) return b(e);
        throw err;
      }
    },
    OR: (e, args) => args.map((a) => a(e)).some(Boolean),
    ROUND: (e, [x, n]) => round(num(x(e)), num(n(e))),
    N: (e, [x]) => (typeof x(e) === "number" ? x(e) : 0),
    TEXT: (e, [x]) => String(num(x(e))).padStart(2, "0"),
    ROW: (e) => e.row,
    VLOOKUP: (e, [key, range, idx]) => {
      const { sheet, first } = range(e);
      const k = String(key(e)).toLowerCase();
      const hit = Object.keys(e.cells[sheet]).find((a) => a.startsWith(first) && /^\d+$/.test(a.slice(first.length)) && String(e.cells[sheet][a]).toLowerCase() === k);
      if (!hit) throw new SheetError("#N/A");
      return e.cells[sheet][String.fromCharCode(first.charCodeAt(0) + num(idx(e)) - 1) + hit.slice(first.length)];
    },
  };
  const atom = () => {
    const t = eat();
    if (t === "(") {
      const v = cmp();
      eat();
      return v;
    }
    if (t[0] === '"') return () => t.slice(1, -1).replaceAll('""', '"');
    if (/^\d/.test(t)) return () => Number(t);
    if (peek() === "(") {
      eat();
      const args = [];
      while (peek() !== ")") {
        args.push(cmp());
        if (peek() === ",") eat();
      }
      eat();
      return (e) => FUNCS[t](e, args);
    }
    const [, sheet, ref] = /^(?:([A-Za-z]+)!)?(.+)$/.exec(t);
    const a1 = ref.replaceAll("$", "");
    if (a1.includes(":")) return (e) => ({ sheet: sheet ?? e.sheet, first: a1[0] });
    return (e) => e.cells[sheet ?? e.sheet][a1];
  };
  const unary = () => (peek() === "-" ? (eat(), ((v) => (e) => -num(v(e)))(unary())) : atom());
  const mul = level(unary, { "*": (a, b) => num(a) * num(b), "/": (a, b) => num(a) / num(b) });
  const add = level(mul, { "+": (a, b) => num(a) + num(b), "-": (a, b) => num(a) - num(b) });
  const concat = level(add, { "&": (a, b) => String(a) + String(b) });
  const cmp = level(concat, {
    "=": same, "<>": (a, b) => !same(a, b), "<=": (a, b) => num(a) <= num(b), ">=": (a, b) => num(a) >= num(b),
    "<": (a, b) => num(a) < num(b), ">": (a, b) => num(a) > num(b),
  });
  const ast = cmp();
  assert.equal(i, toks.length, "unparsed tokens left");
  return ast;
}

const REQS = setup(); // the formulas are the same for every region
const compiled = new Map();
function run(sheetId, letters, firstRow, env) {
  const f = repeated(REQS, sheetId, letters, firstRow).cell.userEnteredValue.formulaValue;
  if (!compiled.has(f)) compiled.set(f, compile(f));
  return compiled.get(f)(env);
}

// Runs the Inventory formulas for one product on row 3, as the sheet would, left to right.
function inventoryRow(s, { cost, sell, adRate }) {
  const inv = { B1: s.fvf, D1: s.regOp, F1: s.orderLow, H1: s.orderHigh, J1: s.feeTax, L1: s.intl, N1: s.buyerTax, B3: "ring", D3: cost, E3: sell, F3: adRate };
  const cells = { Inventory: inv, Dashboard: { D2: s.rate } };
  for (const letters of ["A", "G", "H", "I", "J", "K", "L"]) {
    inv[`${letters}3`] = run(20, letters, 3, { sheet: "Inventory", cells, row: 3 });
  }
  return { inv, cells };
}

// Adds an order for the product on Inventory row 3 and runs the Orders formulas for it.
function orderLine({ inv, cells }, qty) {
  const orders = { A2: "1001", B2: inv.A3, E2: qty };
  cells.Orders = orders;
  for (const letters of ["C", "F", "G", "H", "I"]) {
    orders[`${letters}2`] = run(30, letters, 2, { sheet: "Orders", cells, row: 2 });
  }
  return orders;
}

test("the sheet formulas give the worked examples", () => {
  const cases = [
    [UK, { cost: 5.6, sell: 9.59 }, { H: 1.52, I: 0.36, J: 2.11, L: 2.11 / 9.59 }],
    [UK, { cost: 11.19, sell: 33.99 }, { H: 5.4, I: 0.48, J: 16.92 }],
    [UK, { cost: 0.8, sell: 2.71 }, { H: 0.43, I: 0.36, J: 1.12 }],
    [US, { cost: 24, sell: 34 }, { H: 5.15, I: 0.4, J: 4.45 }],
    [US, { cost: 23, sell: 36 }, { H: 5.46, I: 0.4, J: 7.14 }],
  ];
  for (const [s, product, want] of cases) {
    const { inv } = inventoryRow(s, product);
    for (const [k, v] of Object.entries(want)) assert.equal(inv[`${k}3`], v, `${JSON.stringify(product)} ${k}`);
  }
  // As an order line: sell 9.00, cost 6.04 earns 1.17.
  const row = inventoryRow(UK, { cost: 6.04, sell: 9 });
  assert.equal(orderLine(row, 1).H2, 1.17);
  assert.equal(inventoryRow(UK, { cost: 5.6, sell: 9.59 }).inv.K3, Math.round(2.11 * 374.37));
});

test("blank inputs leave the calculated cells blank instead of showing errors", () => {
  const blank = inventoryRow(UK, {});
  assert.deepEqual(["G3", "H3", "I3", "J3", "K3", "L3"].map((k) => blank.inv[k]), ["", "", "", "", "", ""]);
  assert.equal(blank.inv.A3, "SKU-01"); // B3 has a name, so the SKU shows
  const noCost = inventoryRow(UK, { sell: 9.59 });
  assert.equal(noCost.inv.J3, "");
  assert.equal(noCost.inv.H3, 1.52);
  // An order whose SKU is not in Inventory has no profit, and says nothing wrong.
  const orders = { B2: "NOPE", F2: "", G2: "" };
  const cells = { Inventory: blank.inv, Dashboard: { D2: 1 }, Orders: orders };
  assert.equal(run(30, "H", 2, { sheet: "Orders", cells, row: 2 }), "");
});

test("the sheet formulas agree with feeMath across regions, ad rates, buyer tax and quantities", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const cent = (max) => Math.round(rnd() * max * 100) / 100;
  for (let n = 0; n < 300; n++) {
    const base = n % 2 ? UK : US;
    const s = { ...base, buyerTax: n % 3 === 0 ? 0.2 : 0, intl: n % 5 === 0 ? 0.0155 : base.intl };
    const product = { sell: 0.5 + cent(60), cost: cent(30), adRate: [undefined, 0, 0.02, 0.1][n % 4] };
    const row = inventoryRow(s, product);
    const want = feeMath(product, s);
    const where = JSON.stringify([product, s]);
    assert.equal(row.inv.G3 || 0, want.ad, `ad ${where}`);
    assert.equal(row.inv.H3, want.ebay, `ebay ${where}`);
    assert.equal(row.inv.I3, want.order, `order ${where}`);
    assert.equal(row.inv.J3, want.net, `net ${where}`);
    assert.equal(row.inv.K3, want.home, `home ${where}`);
    assert.equal(row.inv.L3, want.margin, `margin ${where}`);
    // The Orders tab prices the same line from the lookups. A line of q units is q times the price.
    for (const qty of [undefined, 1, 3]) {
      const q = qty ?? 1;
      const o = orderLine(inventoryRow(s, product), qty);
      const line = feeMath({ sell: product.sell * q, cost: product.cost * q, adRate: product.adRate }, s);
      assert.equal(o.H2, line.net, `order q=${q} ${where}`);
      assert.equal(o.I2, line.home, `order home q=${q} ${where}`);
    }
  }
});
