importScripts("lib/shared.js", "lib/template.js", "lib/importmap.js", "lib/gemini.js", "lib/listing.js");

// The saved library, rates and sign-in state are for AliSwift's own pages and this worker, never a web page's script.
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

// Every handler resolves to { success: true, ... } or { success: false, error }. pagesOnly handlers
// reject anything but AliSwift's own pages: a content script's sender.url is the web page it runs on.
// A sheetId of "local" means the on-device library (no sheet, no sign-in).
const handlers = {
  appendToSheet: { run: (request) => appendRow(request.data) },
  createSheet: { pagesOnly: true, run: (request) => createSheet(request.data) },
  authState: { run: () => authState() },
  signIn: { pagesOnly: true, run: () => signIn() },
  signOut: { pagesOnly: true, run: () => signOut() },
  rate: { run: (request) => getRate(request.data) },
  setRate: { pagesOnly: true, run: (request) => setRate(request.data) },
  listProducts: { pagesOnly: true, run: (request) => listProducts(request.sheetId) },
  setStatus: { pagesOnly: true, run: (request) => setStatus(request.sheetId, request.key, request.status) },
  listOrders: { pagesOnly: true, run: (request) => listOrders(request.sheetId) },
  addOrder: { pagesOnly: true, run: (request) => addOrder(request.sheetId, request.order) },
  updateOrder: { pagesOnly: true, run: (request) => updateOrder(request) },
  moveLocal: { pagesOnly: true, run: (request) => moveLocal(request.sheetId) },
  importLibrary: { pagesOnly: true, run: (request) => importLibrary(request.library) },
  listSpreadsheets: { pagesOnly: true, run: () => listSpreadsheets() },
  readSpreadsheetMeta: { pagesOnly: true, run: (request) => readSpreadsheetMeta(request.id) },
  mapSheet: { pagesOnly: true, run: (request) => mapSheet(request.data) },
  generateListing: { pagesOnly: true, run: (request) => generateListing(request) },
  saveListing: { pagesOnly: true, run: (request) => saveListing(request) },
};

// A failed reply keeps the error's code ("signin", "currency") so a page can tell what to offer. A failed Gemini
// call also says which model and which HTTP status, so a page can say "that model is gone" (404).
const fail = (error) => ({
  success: false,
  error: error.message,
  ...(error.code && { code: error.code }),
  ...(error.model && { model: error.model, status: error.status }),
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!Object.hasOwn(handlers, request?.action)) return;
  const handler = handlers[request.action];
  if (handler.pagesOnly && !sender.url?.startsWith(chrome.runtime.getURL(""))) {
    sendResponse({ success: false, error: "Not allowed." });
    return;
  }
  Promise.resolve()
    .then(() => handler.run(request))
    .catch(fail)
    .then(sendResponse);
  return true;
});

// One write at a time: two adds racing would pick the same next row or SKU, and every library change
// rewrites the whole array. A failed job never blocks the ones behind it.
let queue = Promise.resolve();
function enqueue(job) {
  const run = queue.then(job);
  queue = run.catch(() => {});
  return run;
}

// `dest: "local"` saves to the library; anything else goes to the sheet. Nothing here ever turns a failed
// sheet save into a library save: the page that asked decides.
async function appendRow(data) {
  const result = await enqueue(() => (data?.dest === "local" ? saveLocal(data) : writeRow(data)));
  if (result.success) await saveDetails(data);
  return result;
}

// Silent unless `interactive`, which only signIn() passes: a sign-in window never opens on its own.
// A silent failure means "sign in first" and carries code "signin", unless Chrome's message says it only
// couldn't reach Google (code "offline"): then nothing is known about the sign-in, and it is never reported
// as signed out. While authOff is set (the user signed out here) a silent call does not even ask Chrome,
// because Chrome would still hand back the old grant.
async function getToken(interactive = false) {
  if (!interactive && (await chrome.storage.local.get({ authOff: false })).authOff) throw signinError();
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        const message = chrome.runtime.lastError?.message ?? "";
        reject(
          interactive
            ? new Error(/not supported/i.test(message) ? "Google sign-in isn't available in this browser." : message || "Google sign-in failed.")
            : OFFLINE.test(message)
              ? Object.assign(new Error("Couldn't reach Google. Check your connection."), { code: "offline" })
              : signinError(),
        );
      } else {
        resolve(token);
      }
    });
  });
}

// ponytail: matched on Chrome's error text (network failures, "Service unavailable"); any other wording reads as signed out.
const OFFLINE = /network|connection|unavailable|offline|timed? ?out/i;
const signinError = () => Object.assign(new Error("Sign in to Google to use sheets."), { code: "signin" });

// signedIn is null when the probe could not tell (offline): a page must not read that as signed out.
async function authState() {
  return { success: true, signedIn: await getToken().then(() => true, (e) => (e.code === "signin" ? false : null)) };
}

// Clears authOff only once Google has given a token, so a closed window leaves the state as it was.
async function signIn() {
  await getToken(true);
  await chrome.storage.local.set({ authOff: false });
  return { success: true, signedIn: true };
}

// Local only: the Google grant stays (revoking would sign out every device and ask for consent again).
async function signOut() {
  const token = await getToken().catch(() => null);
  await chrome.storage.local.set({ authOff: true });
  if (token) await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
  return { success: true };
}

// Exchange rates are stored as "<to>:<from>" = how many `from` buy one `to`. A rate read from the sheet
// is cached for 12 hours; one the user typed is kept under "<to>:<from>:typed" until they change it.
const RATE_TTL = 12 * 60 * 60 * 1000;
const CURRENCY = /^[A-Z]{3}$/;

// One write at a time: it reads the whole map and writes it back, so two at once would drop one entry.
let rateLine = Promise.resolve();
function saveRate(key, rate) {
  const run = rateLine.then(async () => {
    const { rates } = await chrome.storage.local.get({ rates: {} });
    await chrome.storage.local.set({ rates: { ...rates, [key]: { rate, at: Date.now() } } });
  });
  rateLine = run.catch(() => {});
  return run;
}

// The rate for converting `from` prices into the sheet's `to`: cache, then the sheet's own exchange-rate
// cell, then a rate the user typed. { success: true, rate: null } when there is none.
async function getRate({ sheetId, from, to } = {}) {
  if (!CURRENCY.test(from) || !CURRENCY.test(to) || from === to) throw new Error("Choose two different currencies.");
  const key = `${to}:${from}`;
  const { rates } = await chrome.storage.local.get({ rates: {} });
  if (rates[key] && Date.now() - rates[key].at < RATE_TTL) return { success: true, rate: rates[key].rate, source: "sheet", at: rates[key].at };
  try {
    const { sheets } = await chrome.storage.sync.get({ sheets: [] });
    if (!sheets.some((s) => s.id === sheetId)) throw new Error("Not one of your sheets.");
    const fields = encodeURIComponent("sheets.data.rowData.values(userEnteredValue,effectiveValue)");
    const file = await sheetsFetch(`/${sheetId}?ranges=${encodeURIComponent("Dashboard!D2")}&fields=${fields}`);
    const cell = file.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0];
    const rate = rateFromCell(cell?.userEnteredValue?.formulaValue, cell?.effectiveValue?.numberValue, from, to);
    if (rate) {
      await saveRate(key, rate);
      return { success: true, rate, source: "sheet", at: Date.now() };
    }
  } catch {
    // ponytail: signed out, a sheet without a Dashboard tab or a failed read all end here: fall back to the typed rate.
  }
  const typed = rates[`${key}:typed`];
  return typed ? { success: true, rate: typed.rate, source: "typed", at: typed.at } : { success: true, rate: null };
}

async function setRate({ from, to, rate } = {}) {
  if (!CURRENCY.test(from) || !CURRENCY.test(to) || from === to) throw new Error("Choose two different currencies.");
  if (!validRate(rate)) throw new Error(RATE_MESSAGE);
  await saveRate(`${to}:${from}:typed`, Number(rate));
  return { success: true };
}

// Calls a Google API with the user's token. A 401 means the cached token is stale or revoked: drop it and retry
// once with a fresh one. A failed reply throws an Error carrying the HTTP `status`.
async function googleFetch(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const token = await getToken();
    const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (res.status === 401 && attempt === 0) {
      await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
      continue;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(body.error?.message ?? `Google Sheets error ${res.status}`), { status: res.status });
    }
    return res.json();
  }
}

// Calls the Sheets API; path starts with "/" (or is empty for spreadsheets.create).
const sheetsFetch = (path, init) => googleFetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, init);

const toNumber = (v) => {
  const n = parsePrice(v);
  return Number.isNaN(n) ? "" : n;
};

const JSON_HEADERS = { "Content-Type": "application/json" };

// Creates the spreadsheet, then fills it in with one batchUpdate (all or nothing). If that fails
// twice, the file's id comes back as orphanId so the dialog can finish it with resumeId.
async function createSheet(data) {
  let book;
  try {
    book = buildWorkbook(data);
    if (data.resumeId && !/^[\w-]{10,}$/.test(data.resumeId)) throw new Error("That sheet id is not valid.");
  } catch (error) {
    return { success: false, error: error.message };
  }

  let id = data.resumeId;
  let ids;
  try {
    let file;
    if (id) {
      file = await sheetsFetch(`/${id}?fields=sheets.properties(sheetId,title)`);
    } else {
      file = await sheetsFetch("", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(book.createBody) });
      id = file.spreadsheetId;
    }
    // Ids come from the response, not from the request, so nothing depends on Google accepting chosen ids.
    ids = book.createBody.sheets.map((t) => file.sheets.find((s) => s.properties.title === t.properties.title)?.properties.sheetId);
    if (ids.includes(undefined)) throw new Error("That file has no Dashboard, Inventory and Orders tabs.");
    if (data.resumeId) {
      // Retry setup rewrites labels and formulas, so never run it over a file the owner has started using.
      // B3:F1000 are input columns only: setup puts nothing in them.
      const typed = await sheetsFetch(`/${id}/values/${encodeURIComponent("Inventory!B3:F1000")}`);
      if (typed.values?.some((row) => row.some((c) => String(c).trim()))) {
        throw new Error("The Inventory tab already has data, so setup was not repeated. Delete the file in Drive and create the sheet again.");
      }
    }
  } catch (error) {
    return { success: false, error: error.message, orphanId: id };
  }

  const body = JSON.stringify({ requests: book.setup(ids) });
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await sheetsFetch(`/${id}:batchUpdate`, { method: "POST", headers: JSON_HEADERS, body });
      return { success: true, sheet: { id, name: book.createBody.properties.title, ...book.config } };
    } catch (error) {
      failure = error;
    }
  }
  return { success: false, error: failure.message, orphanId: id };
}

const LOCAL = "local";
const quote = (tab) => `'${tab.replace(/'/g, "''")}'`;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v) => String(v ?? "").trim();
const round2 = (n) => Math.round(n * 100) / 100;

// The configured sheet with this id, merged over the defaults. Writes only ever reach sheets the user added.
async function sheetById(sheetId) {
  const { sheets } = await chrome.storage.sync.get({ sheets: [] });
  const sheet = sheets.find((s) => s.id === sheetId);
  if (!sheet) throw new Error("That sheet isn't in your AliSwift settings.");
  return { ...SHEET_DEFAULTS, ...sheet };
}

// Prices in another currency than the sheet's never get written. `currency` is what the numbers are in.
// Unknown on either side (no marketplace set) means nothing to compare.
function guardCurrency(sheet, currency) {
  const sheetCurrency = REGIONS[sheet.region]?.currency;
  if (currency && sheetCurrency && currency !== sheetCurrency) {
    throw Object.assign(new Error(`Prices are in ${currency} but this sheet is ${sheetCurrency}. Nothing was saved.`), { code: "currency" });
  }
}

// Reads { name: column letter } fields from `from` down: { name: [cell, ...] }, cell i being row from + i.
// Unformatted, so numbers come back as numbers and dates as serials. A field with no column reads as [].
async function readFields(id, tab, fields, from) {
  const names = Object.keys(fields).filter((k) => fields[k]);
  const out = Object.fromEntries(Object.keys(fields).map((k) => [k, []]));
  if (!names.length) return out;
  const ranges = names.map((k) => `ranges=${encodeURIComponent(`${quote(tab)}!${fields[k]}${from}:${fields[k]}`)}`).join("&");
  const { valueRanges = [] } = await sheetsFetch(`/${id}/values:batchGet?${ranges}&majorDimension=COLUMNS&valueRenderOption=UNFORMATTED_VALUE`);
  names.forEach((k, i) => (out[k] = valueRanges[i]?.values?.[0] ?? []));
  return out;
}

// RAW so text stays text: a title like "=IMPORTDATA(...)" can't run as a formula. Cells are [A1 cell, value];
// an empty value is skipped, so a write never blanks a cell the user filled in.
async function putCells(id, tab, cells) {
  const data = cells.filter(([, value]) => value !== "" && value != null).map(([cell, value]) => ({ range: `${quote(tab)}!${cell}`, values: [[value]] }));
  if (!data.length) return;
  await sheetsFetch(`/${id}/values:batchUpdate`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ valueInputOption: "RAW", data }) });
}

/* Saving */

async function writeRow(data) {
  try {
    const sheet = await getActiveSheet();
    if (!sheet) throw new Error("No sheet yet. Add one in AliSwift settings.");
    guardCurrency(sheet, data.currency); // the one place every save to a sheet passes
    const { skus } = await writeRows(sheet, [data]);
    return { success: true, ...(skus[0] && { sku: skus[0] }) };
  } catch (error) {
    return fail(error);
  }
}

// Writes items below the last used row: one read, one write, whatever the count. The next row and the SKUs
// come from the SKU and keywords columns only (input columns, so pre-filled formulas never count as data).
// With skipExisting, an item whose link and title are already in the sheet is left out and returned as `dupes`.
// ponytail: auto sheets have 1000 rows; past that Google's error is shown. Upgrade: appendDimension, then repeatCell.
async function writeRows(sheet, items, skipExisting = false) {
  const read = [sheet.skuCol, sheet.keywordsCol, ...(skipExisting ? [sheet.linkCol] : [])].filter(Boolean);
  const ranges = read.map((c) => `ranges=${encodeURIComponent(`${quote(sheet.sheetTab)}!${c}:${c}`)}`).join("&");
  const { valueRanges = [] } = await sheetsFetch(`/${sheet.id}/values:batchGet?${ranges}`);
  const column = (c) => valueRanges[read.indexOf(c)]?.values ?? [];

  const seen = new Set(skipExisting ? column(sheet.linkCol).map((r, i) => `${text(r[0])}\n${text(column(sheet.keywordsCol)[i]?.[0])}`) : []);
  const fresh = skipExisting ? items.filter((x) => !seen.has(`${text(x.link)}\n${text(x.title)}`) && seen.add(`${text(x.link)}\n${text(x.title)}`)) : items;
  const dupes = items.filter((x) => !fresh.includes(x));
  if (!fresh.length) return { fresh, dupes, skus: [] };

  const row = nextRow(column(sheet.skuCol), column(sheet.keywordsCol), sheet.startRow);
  const skus = [];
  const cells = fresh.flatMap((x, i) => {
    const r = row + i;
    const sku = sheet.skuCol ? nextSku([...column(sheet.skuCol).map((c) => c[0]), ...skus], sheet.skuPrefix, r, sheet.startRow) : "";
    skus.push(sku);
    return [
      [sheet.keywordsCol, x.title],
      [sheet.priceCol, toNumber(x.price)],
      [sheet.salePriceCol, toNumber(x.salePrice)],
      [sheet.linkCol, x.link],
      [sheet.skuCol, sku],
      [sheet.imageCol, httpsUrl(x.image)],
    ]
      .filter(([col]) => col)
      .map(([col, value]) => [`${col}${r}`, value]);
  });
  await putCells(sheet.id, sheet.sheetTab, cells);
  return { fresh, dupes, skus };
}

async function saveLocal(data) {
  try {
    const { library } = await chrome.storage.local.get({ library: [] });
    const { lib, item } = libAdd(library, cleanSave(data), Date.now(), crypto.randomUUID());
    await chrome.storage.local.set({ library: lib });
    return { success: true, local: true, sku: item.sku };
  } catch (error) {
    return fail(error);
  }
}

/* Products */

// The sheet's products: { products, sharedBy } where sharedBy[row] is the number of rows that share a merged
// status. Rows with no SKU, name or link are skipped. Row numbers are real sheet rows.
async function readProducts(sheet) {
  const cols = {
    sku: sheet.skuCol, title: sheet.keywordsCol, link: sheet.linkCol, price: sheet.priceCol, salePrice: sheet.salePriceCol,
    status: sheet.statusCol, image: sheet.imageCol, profit: sheet.profitCol, margin: sheet.marginCol,
  };
  const c = await readFields(sheet.id, sheet.sheetTab, cols, sheet.startRow);
  let shared = [];
  if (sheet.statusCol) {
    const file = await sheetsFetch(`/${sheet.id}?fields=${encodeURIComponent("sheets(properties(title),merges)")}`);
    const tab = file.sheets?.find((s) => s.properties?.title === sheet.sheetTab);
    ({ values: c.status, shared } = expandMerges(c.status, tab?.merges, sheet.statusCol.charCodeAt(0) - 65, sheet.startRow));
  }
  const products = [];
  const sharedBy = {};
  for (let i = 0; i < Math.max(...Object.values(c).map((l) => l.length)); i++) {
    const [sku, title, link] = [c.sku[i], c.title[i], c.link[i]].map(text);
    if (!sku && !title && !link) continue;
    const row = sheet.startRow + i;
    if (shared[i]) sharedBy[row] = shared[i];
    products.push({
      row, sku, title, link,
      price: num(c.price[i]), salePrice: num(c.salePrice[i]), image: httpsUrl(c.image[i]),
      status: text(c.status[i]) || "Not Listed", statusShared: Boolean(shared[i]),
      profit: num(c.profit[i]), margin: num(c.margin[i]),
    });
  }
  return { products, sharedBy };
}

async function listProducts(sheetId) {
  if (sheetId === LOCAL) return { success: true, products: libToProducts((await chrome.storage.local.get({ library: [] })).library) };
  return { success: true, products: (await readProducts(await sheetById(sheetId))).products };
}

// Remove is this with "Discontinued", restore with "Not Listed". There is no delete anywhere.
async function setStatus(sheetId, key, status) {
  if (!PRODUCT_STATUSES.includes(status)) throw new Error("Unknown status.");
  if (sheetId === LOCAL) {
    return enqueue(async () => {
      const { library } = await chrome.storage.local.get({ library: [] });
      const row = findRow(libToProducts(library), key);
      if (row < 0) throw new Error("That product isn't in your library any more. Refresh and try again.");
      await chrome.storage.local.set({ library: libSetStatus(library, library[row - 1].id, status) });
      return { success: true };
    });
  }
  const sheet = await sheetById(sheetId);
  if (!sheet.statusCol) throw new Error("This sheet has no Status column. Add one in the sheet's settings.");
  return enqueue(async () => {
    // The row is found again here, inside the queue: the sheet may have been sorted since the dashboard read it.
    const { products, sharedBy } = await readProducts(sheet);
    const row = findRow(products, key);
    if (row < 0) throw new Error("That product isn't in the sheet any more. Refresh and try again.");
    if (sharedBy[row]) throw new Error(`This status is shared by ${sharedBy[row]} variant rows. Change it in the sheet.`);
    await putCells(sheet.id, sheet.sheetTab, [[`${sheet.statusCol}${row}`, status]]);
    return { success: true };
  });
}

/* Orders */

async function ordersOf(sheetId) {
  const sheet = await sheetById(sheetId);
  if (!sheet.oTab) throw new Error("This sheet has no Orders tab set up.");
  return { sheet, cols: { ...SHEET_DEFAULTS.oCols, ...sheet.oCols } };
}

// The Orders tab's order-number and SKU columns from row 1 down (f), and the order rows among them ({ row, no, sku }).
async function readOrderKeys(sheet, cols) {
  if (!cols.no || !cols.sku) throw new Error("This sheet's Orders tab needs an Order Number and a SKU column.");
  const f = await readFields(sheet.id, sheet.oTab, { no: cols.no, sku: cols.sku }, 1);
  const rows = Array.from({ length: Math.max(f.no.length, f.sku.length) }, (_, i) => ({ row: i + 1, no: f.no[i], sku: f.sku[i] }));
  return { f, rows: rows.filter((r) => r.row >= sheet.oRow) };
}

async function listOrders(sheetId) {
  const { sheet, cols } = await ordersOf(sheetId);
  const c = await readFields(sheet.id, sheet.oTab, cols, sheet.oRow);
  // The product's name is a formula on the Orders tab with no column of its own here, so it comes from Inventory by SKU.
  const inv = sheet.skuCol && sheet.keywordsCol ? await readFields(sheet.id, sheet.sheetTab, { sku: sheet.skuCol, name: sheet.keywordsCol }, sheet.startRow) : { sku: [], name: [] };
  const names = new Map(inv.sku.map((s, i) => [text(s).toLowerCase(), text(inv.name[i])]));
  const orders = [];
  for (let i = 0; i < Math.max(...Object.values(c).map((l) => l.length)); i++) {
    const [orderNumber, sku] = [c.no[i], c.sku[i]].map(text);
    if (!orderNumber && !sku) continue;
    orders.push({
      row: sheet.oRow + i, orderNumber, sku, product: names.get(sku.toLowerCase()) ?? "", date: fromSheetDate(c.date[i]),
      qty: Number(c.qty[i]) > 0 ? Number(c.qty[i]) : 1, sell: num(c.sell[i]), cost: num(c.cost[i]), profit: num(c.profit[i]),
      status: text(c.status[i]) || "Pending", tracking: text(c.track[i]), notes: text(c.notes[i]),
    });
  }
  return { success: true, orders };
}

// The sell and cost totals are written as numbers, so a later price change never rewrites a past order. They
// replace the template's lookup formulas in this new row only. Name and profit stay the row's own formulas.
async function addOrder(sheetId, order) {
  const { sheet, cols } = await ordersOf(sheetId);
  const o = cleanOrder(order);
  guardCurrency(sheet, order?.currency);
  return enqueue(async () => {
    const { f, rows } = await readOrderKeys(sheet, cols);
    if (findOrderRows(rows, o.orderNumber, { sku: o.sku }).length) {
      throw Object.assign(new Error(`Order ${o.orderNumber} for ${o.sku} is already in the sheet.`), { code: "duplicate" });
    }
    const row = nextRow(f.no.map((v) => [v]), f.sku.map((v) => [v]), sheet.oRow);

    let unit = {};
    if (sheet.skuCol) {
      const inv = await readFields(sheet.id, sheet.sheetTab, { sku: sheet.skuCol, cost: sheet.priceCol, sell: sheet.salePriceCol }, sheet.startRow);
      const i = inv.sku.findIndex((s) => text(s).toLowerCase() === o.sku.toLowerCase());
      if (i >= 0) unit = { cost: num(inv.cost[i]), sell: num(inv.sell[i]) };
    }
    const sell = o.sell ?? (unit.sell == null ? null : round2(unit.sell * o.qty));
    const cost = unit.cost == null ? null : round2(unit.cost * o.qty);
    await putCells(sheet.id, sheet.oTab, [
      [cols.no, o.orderNumber], [cols.sku, o.sku], [cols.date, o.serial], [cols.qty, o.qty], [cols.sell, sell],
      [cols.cost, cost], [cols.status, o.status], [cols.track, o.tracking], [cols.notes, o.notes],
    ].filter(([col]) => col).map(([col, value]) => [`${col}${row}`, value]));
    return { success: true, row, ...(cost == null && { warning: "SKU not found in your sheet, so cost is blank." }) };
  });
}

// Writes only the fields in the patch. The order is found again by number inside the queue; a multi-item order
// has one row per item and the patch goes to all of them, unless `key` ({ sku, row }) names one.
async function updateOrder({ sheetId, orderNumber, key, patch }) {
  const { sheet, cols } = await ordersOf(sheetId);
  const change = cleanPatch(patch);
  return enqueue(async () => {
    const { rows } = await readOrderKeys(sheet, cols);
    const found = findOrderRows(rows, orderNumber, key ?? {});
    if (!found.length) throw new Error("That order isn't in the sheet any more. Refresh and try again.");
    const cells = Object.entries(change).flatMap(([field, value]) => {
      const col = cols[field === "tracking" ? "track" : field];
      if (!col) throw new Error(`This sheet's Orders tab has no ${field} column.`);
      return found.map((r) => [`${col}${r}`, value]);
    });
    await putCells(sheet.id, sheet.oTab, cells);
    return { success: true };
  });
}

/* Library to sheet */

// Moves the library's products into a sheet with one read and one write. A product already in the sheet (same
// link and title) is only dropped from the library. One in another currency is converted with the same rate
// lookup as a save; with no rate it stays in the library and is counted. Removed ones are not moved.
// The library is cleaned up only after the sheet write succeeded, so a failure leaves it as it was and a
// re-run after a crash finds the rows already in the sheet.
async function moveLocal(sheetId) {
  const sheet = await sheetById(sheetId);
  return enqueue(async () => {
    const { library } = await chrome.storage.local.get({ library: [] });
    const to = REGIONS[sheet.region]?.currency ?? "";
    const rates = {};
    const items = [];
    let needRate = 0;
    for (const rec of library.filter((x) => x.status !== "Discontinued")) {
      let rate = 1;
      if (currencyKind(rec.currency, to) === "convert") {
        if (!(rec.currency in rates)) rates[rec.currency] = (await getRate({ sheetId, from: rec.currency, to })).rate;
        rate = rates[rec.currency];
      }
      if (!rate) needRate++;
      else {
        const at = (v) => (v == null ? null : round2(v / rate));
        const item = rate === 1 ? rec : { ...rec, price: at(rec.price), salePrice: at(rec.salePrice) };
        // A library save keeps the page's price as shown (no sell price): the sheet's own rules price it here, in its currency.
        items.push(rec.salePrice == null && item.price != null ? { ...item, ...priceProduct(item.price, 0, sheet) } : item);
      }
    }

    const { fresh, dupes, skus } = await writeRows(sheet, items, true);
    const gone = [...fresh, ...dupes].map((x) => x.id);
    if (gone.length) await chrome.storage.local.set({ library: libTake(library, gone) });

    // A generated listing follows its product to the new key. ponytail: a re-run after a crash skips this, the listing is then regenerated.
    const old = fresh.map((x, i) => [`listing:${LOCAL}:${x.sku}`, `listing:${sheetId}:${skus[i]}`]).filter(([, key]) => !key.endsWith(":"));
    const listings = await chrome.storage.local.get(Object.fromEntries(old.map(([k]) => [k, null])));
    const kept = old.filter(([k]) => listings[k] != null);
    if (kept.length) {
      await chrome.storage.local.set(Object.fromEntries(kept.map(([k, key]) => [key, listings[k]])));
      await chrome.storage.local.remove(kept.map(([k]) => k));
    }
    return { success: true, moved: fresh.length, skipped: dupes.length, needRate };
  });
}

// Adds the products of an imported backup to the library. Never replaces or removes any.
function importLibrary(incoming) {
  const items = cleanLibrary(incoming);
  if (!items) throw new Error("That library isn't valid.");
  return enqueue(async () => {
    const { library } = await chrome.storage.local.get({ library: [] });
    const lib = libMerge(library, items);
    await chrome.storage.local.set({ library: lib });
    return { success: true, added: lib.length - library.length };
  });
}

/* Listings (Gemini). One listing per product, kept under listing:<sheetId>:<key> in storage.local ("local" is the
   library's sheetId). Nothing here reads or writes a sheet. */

const IMAGES_MAX = 4;
// Photos are fetched here, not by the page, from AliExpress's own hosts only. 3 MB each keeps four of them, as
// base64, under Gemini's 20 MB request limit.
const IMAGE_HOSTS = /(^|\.)(alicdn\.com|aliexpress-media\.com|aliexpress\.com|aliexpress\.us)$/;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_BYTES = 3 * 1024 * 1024;

// The AliExpress item number in a product link, or "".
const itemIdOf = (link) => /(?:\/item\/|[?&]productId=)(\d{6,})/.exec(String(link ?? ""))?.[1] ?? "";

// What a listing is filed under: the SKU, or the item number when the sheet has no SKU column.
const listingKey = (product) => text(product?.sku).slice(0, 40) || itemIdOf(product?.link);

// What a save may attach for the listing writer, as { fullTitle, specs: [[name, value]], description, images }, capped.
// The page sends it, so it is cleaned like everything else the page sends. null when nothing usable is in it.
function cleanDetails(d) {
  if (!d || typeof d !== "object") return null;
  const out = {
    fullTitle: text(d.fullTitle).slice(0, 500),
    specs: (Array.isArray(d.specs) ? d.specs : []).slice(0, 50).filter(Array.isArray).map(([k, v]) => [text(k).slice(0, 100), text(v).slice(0, 200)]).filter(([k, v]) => k && v),
    description: text(d.description).slice(0, 4000),
    images: (Array.isArray(d.images) ? d.images : []).slice(0, 20).map((u) => httpsUrl(u)).filter(Boolean).slice(0, IMAGES_MAX),
  };
  return out.fullTitle || out.specs.length || out.description || out.images.length ? { ...out, savedAt: Date.now() } : null;
}

// Keeps a saved product's details (details:<item number>) for its listing. Never fails the save it follows.
// ponytail: about 6 KB each against storage.local's 10 MB, so it stops at 6 MB in use. Upgrade: prune the oldest.
async function saveDetails(data) {
  try {
    const id = itemIdOf(data?.link);
    const details = id && cleanDetails(data.details);
    if (details && !((await chrome.storage.local.getBytesInUse?.(null)) > 6e6)) await chrome.storage.local.set({ [`details:${id}`]: details });
  } catch {
    // The product is saved; its listing is just written from less.
  }
}

// One photo as { mime, data: base64 }, or null for anything that isn't a small JPEG, PNG or WebP from an AliExpress host.
async function fetchImage(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !IMAGE_HOSTS.test(u.hostname)) return null;
    const res = await fetch(u.href, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10000) });
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!res.ok || !IMAGE_TYPES.includes(mime) || Number(res.headers.get("content-length")) > IMAGE_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > IMAGE_BYTES) return null;
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { mime, data: btoa(binary) };
  } catch {
    return null; // a photo that won't load only makes the listing text-only
  }
}

// Writes a listing for one product with Gemini, or answers the one already kept (unless `force`).
// `product` is a dashboard card's product ({ sku, title, link, salePrice, image, currency }). Only the sell price
// goes to Gemini, never the cost. Answers { success, key, listing, limited, model, createdAt, warnings, cached? }.
// `limited` means no saved details were found, so it was written from the sheet's name and photo alone.
// A failed reply has `code`: nokey, invalid-key, rate, network, timeout or bad-output; with `status` 404 and `model`
// when that model is gone.
async function generateListing({ sheetId, product, force } = {}) {
  const p = product && typeof product === "object" ? product : {};
  const key = listingKey(p);
  if (!key) throw new Error("This product has no SKU or AliExpress link to keep its listing under.");
  const sheet = sheetId === LOCAL ? null : await sheetById(sheetId);
  const slot = `listing:${sheetId}:${key}`;
  if (!force) {
    const kept = (await chrome.storage.local.get({ [slot]: null }))[slot];
    if (kept) return { success: true, key, cached: true, ...kept };
  }
  const { model } = await geminiSettings(); // no key: stop before any photo is fetched

  const id = itemIdOf(p.link);
  const details = id ? (await chrome.storage.local.get({ [`details:${id}`]: null }))[`details:${id}`] : null;
  const urls = [...new Set((details?.images?.length ? details.images : [p.image]).map((u) => httpsUrl(u)).filter(Boolean))].slice(0, IMAGES_MAX);
  const photos = (await Promise.all(urls.map(async (url) => ({ url, image: await fetchImage(url) })))).filter((x) => x.image);

  const { aiInstructions } = await chrome.storage.sync.get({ aiInstructions: "" });
  const region = REGIONS[sheet?.region] ? sheet.region : p.currency === "USD" ? "US" : "UK";
  const wordsToLeaveOut = sheet?.excludeKeywords ?? "";
  const currency = sheet ? REGIONS[sheet.region]?.currency : p.currency;
  const request = buildListingRequest(
    {
      title: details?.fullTitle || p.title,
      description: details?.description,
      specifics: details?.specs,
      images: photos.map((x) => x.url),
      sellPrice: p.salePrice == null ? "" : `${currency ?? ""} ${p.salePrice}`.trim(),
    },
    { region, wordsToLeaveOut, instructions: typeof aiInstructions === "string" ? aiInstructions : "" },
  );
  // 90 s: a listing with photos takes a while. Not retried on a timeout (that would be three minutes); Regenerate is.
  const raw = await callGemini({ ...request, images: photos.map((x) => x.image), temperature: 0.7, timeoutMs: 90000 });
  const { listing, warnings, ok } = validateListing(raw, { wordsToLeaveOut });
  if (!ok) throw Object.assign(new Error("Gemini's answer had no usable title and description. Try again."), { code: "bad-output" });

  const record = { listing, limited: !details, model, createdAt: Date.now(), warnings };
  await chrome.storage.local.set({ [slot]: record });
  return { success: true, key, ...record };
}

// Keeps the seller's edits to a listing's title and description (the dialog's two editable fields).
// { sheetId, key, title?, description? } -> { success, listing }. The title is cut to 80 characters.
async function saveListing({ sheetId, key, title, description } = {}) {
  if (sheetId !== LOCAL) await sheetById(sheetId);
  const slot = `listing:${sheetId}:${text(key).slice(0, 40)}`;
  const kept = (await chrome.storage.local.get({ [slot]: null }))[slot];
  if (!kept) throw new Error("That product has no saved listing. Create one first.");
  const listing = { ...kept.listing };
  if (typeof title === "string") listing.title = clampTitle(stripControlChars(title).replace(/\s+/g, " ").trim()).title;
  if (typeof description === "string") listing.description = stripControlChars(description).trim().slice(0, 5000);
  await chrome.storage.local.set({ [slot]: { ...kept, listing, edited: true } });
  return { success: true, listing };
}

/* Import from Google Sheets. READ-ONLY: every request below is a GET and nothing here writes to the user's sheet
   or Drive (a test reads this section and fails on any write). Gemini gets a POST, but that is not their sheet. */

const IMPORT_TIMEOUT = 15000;
const SHEET_ID = /^[\w-]{10,100}$/;
const importError = (code, message) => Object.assign(new Error(message), { code });

// What a failed Google read means to the dialog, or null when the HTTP status has to decide.
function readCode(error) {
  if (error.code === "signin") return "signin";
  if (error.code === "offline") return "network";
  if (error.name === "TimeoutError" || error.name === "AbortError") return "timeout";
  if (error.status === 429 || (error.status === 403 && /rate limit|quota/i.test(error.message))) return "rate";
  return error.status ? null : "network"; // no status: the request itself failed
}

// The user's own spreadsheets, newest first, up to 100 ("truncated" when there are more). Needs the Drive
// metadata scope: names, ids and dates only, never a file's content. A reply code is "scope" (refused: the scope
// isn't granted), "signin" or "network".
async function listSpreadsheets() {
  const query = {
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    orderBy: "modifiedTime desc",
    pageSize: 100,
    fields: "nextPageToken,files(id,name,modifiedTime)",
  };
  const qs = Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  try {
    const { files = [], nextPageToken } = await googleFetch(`https://www.googleapis.com/drive/v3/files?${qs}`, { signal: AbortSignal.timeout(IMPORT_TIMEOUT) });
    return {
      success: true,
      truncated: Boolean(nextPageToken),
      files: files.filter((f) => SHEET_ID.test(f.id)).map((f) => ({ id: f.id, name: text(f.name).slice(0, 200), modified: text(f.modifiedTime) })),
    };
  } catch (error) {
    const code = readCode(error);
    throw importError(code === "signin" ? "signin" : code === null && error.status === 403 ? "scope" : "network", error.message);
  }
}

// The tabs of one spreadsheet and the first rows of each (up to 20 tabs, A to Z, 4 rows): { title, tabs, skipped }
// with each tab as prepareTabs makes it. A reply code is forbidden, xlsx (an Excel file opened in Sheets),
// noheaders (no tab has column titles), network, timeout, rate, signin or other.
async function readSpreadsheetMeta(id) {
  if (!SHEET_ID.test(id ?? "")) throw importError("other", "That doesn't look like a Google Sheets link or ID.");
  const signal = AbortSignal.timeout(IMPORT_TIMEOUT);
  let title;
  let raw;
  try {
    const file = await sheetsFetch(`/${id}?fields=${encodeURIComponent("properties.title,sheets.properties(title,sheetType)")}`, { signal });
    title = text(file.properties?.title).slice(0, 100);
    const names = (file.sheets ?? []).map((s) => s.properties).filter((p) => p?.title && (!p.sheetType || p.sheetType === "GRID")).map((p) => p.title).slice(0, 20);
    const ranges = names.map((n) => `ranges=${encodeURIComponent(`${quote(n)}!A1:Z4`)}`).join("&");
    const { valueRanges = [] } = names.length ? await sheetsFetch(`/${id}/values:batchGet?${ranges}`, { signal }) : {};
    raw = names.map((name, i) => ({ title: name, rows: valueRanges[i]?.values ?? [] }));
  } catch (error) {
    const code = readCode(error) ?? ([403, 404].includes(error.status) ? "forbidden" : /not supported for this document/i.test(error.message) ? "xlsx" : "other");
    throw importError(code, error.message);
  }
  const { tabs, skipped } = prepareTabs(raw);
  if (!tabs.length) throw importError("noheaders", "No tab has column titles.");
  return { success: true, id, title, tabs, skipped };
}

// The draft sheet settings for the tabs readSpreadsheetMeta returned: the AI's proposal when a Gemini key is saved
// (checked, then merged with matching by titles), else matching by titles alone. A failed AI call never fails
// this: the draft comes back with method "headers" and the reason. `skipAi` is the user's choice, reason "".
// What Gemini gets is aiRequest's filtered tabs, never the rest of the sheet.
async function mapSheet(data) {
  const tabs = cleanTabs(data?.tabs);
  if (!tabs.length) throw importError("noheaders", "No tab has column titles.");
  const skipped = firstOf(data?.skipped, MAX_TABS).map((n) => text(n).slice(0, 100));
  let ai = null;
  let reason = "";
  if (!data.skipAi) {
    try {
      const { mapping } = validateAiMapping(await callGemini(aiRequest(tabs)), tabs);
      if (!Object.keys(mapping.inv.fields).length) throw importError("bad-output", "Nothing usable in the answer.");
      ai = mapping;
    } catch (error) {
      reason = GEMINI_CODES.includes(error.code) ? error.code : "bad-output";
    }
  }
  const draft = buildDraft({
    id: SHEET_ID.test(data.id ?? "") ? data.id : "",
    title: text(data.title).slice(0, 100),
    tabs,
    skipped,
    method: ai ? "ai" : "headers",
    reason,
    mapped: mapTabs(tabs, ai),
  });
  return { success: true, draft };
}
