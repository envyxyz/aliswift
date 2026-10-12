importScripts("lib/shared.js", "lib/template.js", "lib/importmap.js", "lib/gemini.js", "lib/listing.js", "lib/fillplan.js", "lib/aimap.js");

// The saved library, rates and sign-in state are for AliSwift's own pages and this worker, never a web page's script.
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

// Every handler resolves to { success: true, ... } or { success: false, error }. pagesOnly handlers
// reject anything but AliSwift's own pages: a content script's sender.url is the web page it runs on.
// ebayOnly handlers answer only the panel on eBay's listing form (see onListingForm), ordersOnly ones only the order list
// in Seller Hub. aliOk handlers also answer an AliExpress product page (the page buttons), and nothing else: the eBay
// panel never saves a product or asks a rate. aiTask handlers answer any of those three pages, and check which task.
// A sheetId of "local" means the on-device library (no sheet, no sign-in).
const handlers = {
  appendToSheet: { aliOk: true, run: (request) => appendRow(request.data) },
  quickList: { aliOk: true, run: (request) => quickList(request.data) },
  createSheet: { pagesOnly: true, run: (request) => createSheet(request.data) },
  authState: { run: () => authState() },
  signIn: { pagesOnly: true, run: () => signIn() },
  signOut: { pagesOnly: true, run: () => signOut() },
  rate: { aliOk: true, run: (request) => getRate(request.data) },
  setRate: { pagesOnly: true, run: (request) => setRate(request.data) },
  listProducts: { pagesOnly: true, run: (request) => listProducts(request.sheetId) },
  setStatus: { pagesOnly: true, run: (request) => setStatus(request.sheetId, request.key, request.status) },
  listOrders: { pagesOnly: true, run: (request) => listOrders(request.sheetId) },
  addOrder: { pagesOnly: true, run: (request) => addOrder(request.sheetId, request.order) },
  updateOrder: { pagesOnly: true, run: (request) => updateOrder(request) },
  moveLocal: { pagesOnly: true, run: (request) => moveLocal(request.sheetId) },
  importLibrary: { pagesOnly: true, run: (request) => importLibrary(request.library, request.photos) },
  addColumns: { pagesOnly: true, run: (request) => addColumns(request.sheetId, request.columns) },
  fillPhotos: { pagesOnly: true, run: (request) => fillPhotos(request.sheetId, request.links, request.retry) },
  listSpreadsheets: { pagesOnly: true, run: () => listSpreadsheets() },
  readSpreadsheetMeta: { pagesOnly: true, run: (request) => readSpreadsheetMeta(request.id) },
  mapSheet: { pagesOnly: true, run: (request) => mapSheet(request.data) },
  generateListing: { pagesOnly: true, run: (request) => generateListing(request) },
  saveListing: { pagesOnly: true, run: (request) => saveListing(request) },
  listOnEbay: { pagesOnly: true, run: (request) => listOnEbay(request) },
  ebayContext: { ebayOnly: true, run: () => ebayContext() },
  ebayProducts: { ebayOnly: true, run: () => ebayProducts() },
  ebayPhoto: { ebayOnly: true, run: (request) => ebayPhoto(request.n) },
  ebayPhotosSave: { ebayOnly: true, run: (request) => savePhotos(request.variantsOnly === true) },
  importOrders: { ordersOnly: true, run: (request) => importOrders(request) },
  aiMap: { aiTask: true, run: (request, sender) => aiMap(request, sender) },
  ebaySelect: { ebayOnly: true, run: (request) => ebaySelect(request) },
  planFill: { ebayOnly: true, run: (request) => planFill(request) },
  ebayDone: { ebayOnly: true, run: () => chrome.storage.local.remove("ebayTarget").then(() => ({ success: true })) },
  openPage: { ebayOnly: true, run: (request) => openPage(request.page) },
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
  const own = Boolean(sender.url?.startsWith(chrome.runtime.getURL("")));
  const url = sender.url;
  const allowed = handler.pagesOnly ? own
    : handler.aliOk ? own || onAliExpress(url)
    : handler.ebayOnly ? onListingForm(url)
    : handler.ordersOnly ? onOrdersPage(url)
    : handler.aiTask ? onAliExpress(url) || onListingForm(url) || onOrdersPage(url)
    : true;
  if (!allowed) {
    sendResponse({ success: false, error: "Not allowed." });
    return;
  }
  Promise.resolve()
    .then(() => handler.run(request, sender))
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
  const local = data?.dest === "local";
  if (!data?.image && data?.details) {
    data.image = httpsUrl(data.details?.images?.[0]) || httpsUrl(data.details?.variants?.[0]?.image) || "";
  }
  const result = await enqueue(() => (local ? saveLocal(data) : writeRow(data)));
  if (result.success) {
    await saveDetails(data);
    if (!local) await enqueue(() => rememberPhotos([data]));
  }
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
  // A sheet with no Image column (or an empty cell) still shows the photo this device kept when the product was saved.
  const bare = products.filter((p) => !p.image && p.link);
  if (bare.length) {
    const keys = bare.map((p) => `details:${itemIdOf(p.link)}`).filter((k) => k !== "details:");
    const storage = await chrome.storage.local.get({ photos: {}, ...Object.fromEntries(keys.map((k) => [k, null])) });
    const photos = storage.photos || {};
    const newPhotos = {};
    for (const p of bare) {
      const id = itemIdOf(p.link);
      const pk = photoKey(p.link);
      let img = httpsUrl(photos[pk]);
      if (!img && id && storage[`details:${id}`]) {
        const d = storage[`details:${id}`];
        img = httpsUrl(d?.images?.[0]) || httpsUrl(d?.variants?.[0]?.image);
        if (img) newPhotos[pk] = img;
      }
      p.image = img;
    }
    if (Object.keys(newPhotos).length) {
      await chrome.storage.local.set({ photos: cleanPhotos({ ...photos, ...newPhotos }) });
    }
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
  if (!key || !(key.sku || key.link || key.title)) throw new Error("Say which product to change.");
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

// The orders on Seller Hub's list, added to the active sheet's Orders tab with one read of the tab, one read of the
// inventory and one write. An order (number and SKU) already in the tab is skipped, so pressing the button again, or on
// the next page, adds only what is new. Oldest first, so the tab stays in the order they were sold. Cost and sell price
// come from the inventory's row for the SKU, like an order added on the dashboard.
async function importOrders({ orders } = {}) {
  const sheet = await getActiveSheet();
  if (!sheet) throw new Error("No sheet yet. Add one in AliSwift settings.");
  const { cols } = await ordersOf(sheet.id);
  const { lines, rejected } = cleanOrderImport(orders);
  if (!lines.length) return { success: true, added: 0, skipped: 0, rejected, unknown: 0 };
  return enqueue(async () => {
    const { f, rows } = await readOrderKeys(sheet, cols);
    const keyOf = (no, sku) => `${text(no).toLowerCase()}|${text(sku).toLowerCase()}`;
    const seen = new Set(rows.map((r) => keyOf(r.no, r.sku)));
    const fresh = lines.filter((o) => !seen.has(keyOf(o.orderNumber, o.sku)) && seen.add(keyOf(o.orderNumber, o.sku)));
    if (!fresh.length) return { success: true, added: 0, skipped: lines.length, rejected, unknown: 0 };

    const inv = sheet.skuCol ? await readFields(sheet.id, sheet.sheetTab, { sku: sheet.skuCol, cost: sheet.priceCol, sell: sheet.salePriceCol }, sheet.startRow) : { sku: [], cost: [], sell: [] };
    const unit = new Map(inv.sku.map((s, i) => [text(s).toLowerCase(), { cost: num(inv.cost[i]), sell: num(inv.sell[i]) }]));
    const first = nextRow(f.no.map((v) => [v]), f.sku.map((v) => [v]), sheet.oRow);
    let unknown = 0;
    const cells = fresh.flatMap((o, i) => {
      const u = unit.get(o.sku.toLowerCase());
      if (u?.cost == null) unknown++;
      const sell = u?.sell == null ? null : round2(u.sell * o.qty);
      const cost = u?.cost == null ? null : round2(u.cost * o.qty);
      return [
        [cols.no, o.orderNumber], [cols.sku, o.sku], [cols.date, o.serial], [cols.qty, o.qty], [cols.sell, sell],
        [cols.cost, cost], [cols.status, o.status],
      ].filter(([col]) => col).map(([col, value]) => [`${col}${first + i}`, value]);
    });
    await putCells(sheet.id, sheet.oTab, cells);
    return { success: true, added: fresh.length, skipped: lines.length - fresh.length, rejected, unknown };
  });
}

/* Photos and columns: where a product's picture lives */

// The photo of every product saved to a sheet is also kept on this device, by AliExpress item number (the link when it
// has none). The dashboard shows it for a product whose sheet has no Image column, or no link in that row's cell, so a
// sheet without the column still shows photos. It survives updates; a settings backup carries it too. The sheet's own
// Image column is what survives everything, which is why addColumns below offers one.
const photoKey = (link) => itemIdOf(link) || text(link).slice(0, 200);

// ponytail: never fails the save it follows (it only repeats what the sheet got), and never trims below PHOTOS_MAX.
async function rememberPhotos(items) {
  try {
    const add = cleanPhotos(Object.fromEntries(items.map((x) => [photoKey(x.link), x.image])));
    if (!Object.keys(add).length) return;
    const { photos } = await chrome.storage.local.get({ photos: {} });
    await chrome.storage.local.set({ photos: cleanPhotos({ ...photos, ...add }) });
  } catch {
    // the photo is only missing from the fallback
  }
}

/* Photos for products saved before AliSwift kept them. A link pasted into a chat shows the product's picture: the page names
   it in its og:image tag, in the first bytes AliExpress sends, with no sign-in and no script (checked on live product pages,
   served the same to a browser and to link-preview bots). So a product with a link and no photo gets that one. */

// The share image of a product page's HTML: its og:image (else twitter:image, else the first photo of its gallery data), at
// full size, or "" when the page names none on AliExpress's image hosts.
function shareImage(html) {
  const attr = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(1).find((v) => v !== undefined) ?? "";
  const source = String(html ?? "");
  const metas = [...source.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const named = (key) => metas.find((m) => attr(m, "(?:property|name)").toLowerCase() === key);
  const gallery = /"imagePathList"\s*:\s*\[\s*"([^"]+)"/.exec(source)?.[1];
  for (const raw of [attr(named("og:image") ?? "", "content"), attr(named("twitter:image") ?? "", "content"), gallery]) {
    const clean = String(raw ?? "").replace(/&amp;/g, "&").replace(/\\/g, "").trim();
    const url = fullSizePhoto(clean.startsWith("//") ? "https:" + clean : clean);
    if (url && onPhotoHost(url)) return url;
  }
  return "";
}

// The share image of an AliExpress item, read from its public page without cookies. "" when the page loaded and names no
// photo (the product is gone); null when the page could not be had (network error, or AliExpress's "punish" check page
// that it serves to anyone fetching too fast), which says nothing about the product.
async function fetchShareImage(id) {
  try {
    const res = await fetch(`https://www.aliexpress.com/item/${id}.html`, { credentials: "omit", signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 500000);
    return html.includes("_____tmd_____") ? null : shareImage(html);
  } catch {
    return null;
  }
}

const MISS_MS = 3 * 24 * 3600 * 1000; // a page that loaded with no photo is not asked again for three days

// For up to 60 product links (from the dashboard's list) that have no photo: reads each one's share image, three pages at a
// time, keeps it on this device (the dashboard's fallback) and, where the sheet has an Image column with that row's cell
// empty, writes it there too (an empty cell, nothing else), or into the library's record. Answers { photos: { link: url } }
// for the links it found a photo for. A page with no photo is remembered as a miss for a few days; a page that could not be
// had is not, and the first one stops the round (AliExpress is slowing us down).
// `retry` lists links whose photo (the sheet's, or the one kept here) would not load: those are fetched again even if one is kept.
async function fillPhotos(sheetId, links, retry) {
  const sheet = sheetId === LOCAL ? null : await sheetById(sheetId);
  const wanted = [...new Set((Array.isArray(links) ? links : []).slice(0, 200).map(text))].map((link) => ({ link, id: itemIdOf(link) })).filter((x) => x.id);
  const again = new Set(Array.isArray(retry) ? retry.map(text) : []);
  const now = Date.now();
  const { photos, photoGone: photoMiss } = await chrome.storage.local.get({ photos: {}, photoGone: {} });
  const todo = wanted.filter((x) => (again.has(x.link) || !photos[photoKey(x.link)]) && !(now - (photoMiss[x.id] ?? 0) < MISS_MS)).slice(0, 60);
  const found = {};
  const missed = [];
  let blocked = false;
  for (let i = 0; i < todo.length && !blocked; i += 2) {
    await Promise.all(
      todo.slice(i, i + 2).map(async (x) => {
        const url = await fetchShareImage(x.id);
        if (url) found[x.link] = url;
        else if (url === null) blocked = true;
        else missed.push(x.id);
      }),
    );
  }
  const keep = Object.fromEntries(Object.entries(photoMiss).filter(([, at]) => now - at < MISS_MS).concat(missed.map((id) => [id, now])).slice(-2000));
  await enqueue(async () => {
    if (sheet) await rememberPhotos(Object.entries(found).map(([link, image]) => ({ link, image })));
    await chrome.storage.local.set({ photoGone: keep });
    if (!Object.keys(found).length) return;
    if (!sheet) {
      const { library } = await chrome.storage.local.get({ library: [] });
      await chrome.storage.local.set({ library: library.map((x) => (!x.image && found[x.link] ? { ...x, image: found[x.link] } : x)) });
    } else if (sheet.imageCol) {
      try {
        const c = await readFields(sheet.id, sheet.sheetTab, { link: sheet.linkCol, image: sheet.imageCol }, sheet.startRow);
        await putCells(sheet.id, sheet.sheetTab, c.link.flatMap((l, i) => (!text(c.image[i]) && found[text(l)] ? [[`${sheet.imageCol}${sheet.startRow + i}`, found[text(l)]]] : [])));
      } catch {
        // the sheet can't be written now (signed out, read-only): the photo is kept on this device all the same
      }
    }
  });
  return { success: true, photos: found, fetched: Object.keys(found).length, missed: missed.length };
}

// Listings are filed under a product's key: when the key changes (a library SKU becomes a sheet's, an item number
// becomes a SKU), the listing follows it. `pairs` are [from, to]; a listing that is not there is skipped.
async function moveListings(pairs) {
  const found = await chrome.storage.local.get(Object.fromEntries(pairs.map(([from]) => [from, null])));
  const kept = pairs.filter(([from]) => found[from] != null);
  if (!kept.length) return;
  await chrome.storage.local.set(Object.fromEntries(kept.map(([from, to]) => [to, found[from]])));
  await chrome.storage.local.remove(kept.map(([from]) => from));
}

/* The setting "Include images when creating listings". The eBay panel gives the picked product's photos to eBay's own
   uploader (this worker fetches them: the panel cannot read AliExpress's image host). When eBay's form does not take
   them, the worker saves them with chrome.downloads, an optional permission the options page asks for when the setting is
   switched on, to Downloads/<sheet name>/<SKU>/ for the seller to drag in. */

const photosOn = async () => Boolean((await chrome.storage.sync.get({ includeImages: false })).includeImages);

// Is this address a photo on one of AliExpress's image hosts?
const onPhotoHost = (u) => {
  try {
    return IMAGE_HOSTS.test(new URL(u).hostname);
  } catch {
    return false;
  }
};

// The picked product's photos, as { urls, variants }. urls: the gallery kept with its save (else its one photo), at most
// PHOTOS_PER_LISTING. variants: the options that have a photo of their own (colour, style), [{ group, name, image }], at
// most VARIANTS_MAX. Only addresses on AliExpress's image hosts, at full size (the same rule as the photos Gemini sees).
async function photoSet(target) {
  const id = itemIdOf(target.link);
  const details = id ? (await chrome.storage.local.get({ [`details:${id}`]: null }))[`details:${id}`] : null;
  const urls = [...new Set((details?.images?.length ? details.images : [target.image]).map((u) => fullSizePhoto(u)).filter(onPhotoHost))].slice(0, PHOTOS_PER_LISTING);
  const seen = new Set();
  const variants = [];
  for (const v of details?.variants ?? []) {
    const image = fullSizePhoto(v?.image);
    if (!text(v?.name) || !onPhotoHost(image) || seen.has(image)) continue;
    seen.add(image);
    variants.push({ group: text(v.group), name: text(v.name), image });
  }
  return { urls, variants: variants.slice(0, VARIANTS_MAX) };
}

// The setting is on and a product is picked: { target, urls, variants }. The photo handlers all need that.
async function photoTarget() {
  if (!(await photosOn())) throw new Error("Photos are off. Turn on Include images in AliSwift settings.");
  const { target } = await ebayPick();
  if (!target) throw new Error("Choose a product first.");
  return { target, ...(await photoSet(target)) };
}

const PHOTO_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const photoName = (n, ext) => `img-${String(Number(n) + 1).padStart(2, "0")}${ext}`;

// Photo number n as { mime, data (base64), name } for the panel to turn into a file; image: null when it can't be fetched.
async function ebayPhoto(n) {
  const { urls } = await photoTarget();
  const url = urls[Number(n)];
  const image = url ? await fetchImage(url) : null;
  return { success: true, image: image && { ...image, name: photoName(n, PHOTO_EXT[image.mime]) } };
}

// A folder or file name that is safe on Windows, Mac and Linux, and cannot climb out of Downloads.
const safeName = (s) => text(s).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 60) || "AliSwift";

// One folder name per variant, after the variant: its name, with its group in front when two variants share a name
// (Windows folders do not tell Black from black, so neither does this).
function variantFolders(variants) {
  const taken = new Set();
  return variants.map((v) => {
    let dir = safeName(v.name);
    if (taken.has(dir.toLowerCase())) dir = safeName(`${v.group} - ${v.name}`);
    for (let n = 2; taken.has(dir.toLowerCase()); n++) dir = `${safeName(v.name)} (${n})`;
    taken.add(dir.toLowerCase());
    return { dir, image: v.image };
  });
}

// What kind of file a photo is, as its host says (AliExpress's image host sends WebP for an address ending ".jpg", and a
// saved file must not lie about it), else as its address says, else JPEG.
async function photoExt(url) {
  try {
    const res = await fetch(url, { method: "HEAD", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(6000) });
    const ext = PHOTO_EXT[(res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()];
    if (ext) return ext;
  } catch {
    // the address decides
  }
  const m = /\.(jpe?g|png|webp)(?:[?#_]|$)/i.exec(url)?.[1].toLowerCase();
  return m ? `.${m === "jpeg" ? "jpg" : m}`: ".jpg";
}

// Saves the picked product's photos to Downloads/<sheet name>/<SKU>/img-01.jpg and so on, and each variant's photo to
// Downloads/<sheet name>/<SKU>/<variant name>/img-01.jpg. variantsOnly: just the variants (the gallery was attached to
// the form, a variant's photo has no place on it). Needs the downloads permission.
async function savePhotos(variantsOnly = false) {
  const { target, urls, variants } = await photoTarget();
  if (!chrome.downloads?.download) throw Object.assign(new Error("Allow downloads in AliSwift's settings to save photos to a folder."), { code: "permission" });
  const store = target.sheetId === LOCAL ? "Library" : (await sheetById(target.sheetId)).name;
  const folder = `${safeName(store)}/${safeName(target.sku || target.key)}`;
  const jobs = [
    ...(variantsOnly ? [] : urls.map((url, i) => ({ url, dir: folder, n: i }))),
    ...variantFolders(variants).map(({ dir, image }) => ({ url: image, dir: `${folder}/${dir}`, n: 0 })),
  ];
  let saved = 0;
  const stop = keepAlive(); // asking the host what each photo is, and saving, can take longer than the worker's 30 seconds
  try {
    const exts = await Promise.all(jobs.map((j) => photoExt(j.url)));
    for (const [i, { url, dir, n }] of jobs.entries()) {
      try {
        await chrome.downloads.download({ url, filename: `${dir}/${photoName(n, exts[i])}`, conflictAction: "uniquify" });
        saved++;
      } catch {
        // one photo that will not download does not stop the others
      }
    }
  } finally {
    stop();
  }
  if (!saved) throw new Error("The photos couldn't be saved.");
  return { success: true, folder: folder.replace("/", "\\"), saved, total: jobs.length, variants: variants.length };
}

const NEW_COLUMNS = { skuCol: "SKU", imageCol: "Image URL" };

// Adds the SKU and/or Image URL column to a sheet's Inventory tab, after the last column that has a value (AliSwift reads
// columns A to Z), with its title in the header row. Only after the seller said yes (options page: "Add missing
// columns?"), and the only place AliSwift changes a sheet's layout. It writes only into the new, empty columns, and the
// new letters are saved in the sheet's settings. The products already there get SKUs numbered as the template does (the
// prefix and their place in the list) and the photo link this device kept, if any. A listing written before the product
// had a SKU was filed under its AliExpress item number: it follows the product to its SKU.
async function addColumns(sheetId, wanted) {
  const keys = [...new Set(Array.isArray(wanted) ? wanted : [])].filter((k) => Object.hasOwn(NEW_COLUMNS, k));
  if (!keys.length) throw new Error("Choose a column to add.");
  const sheet = await sheetById(sheetId);
  return enqueue(async () => {
    const fields = encodeURIComponent("sheets.properties(sheetId,title,gridProperties(columnCount))");
    const tab = (await sheetsFetch(`/${sheet.id}?fields=${fields}`)).sheets?.find((s) => s.properties?.title === sheet.sheetTab)?.properties;
    if (!tab) throw new Error(`There is no tab called "${sheet.sheetTab}" in that spreadsheet.`);
    const { values = [] } = await sheetsFetch(`/${sheet.id}/values/${encodeURIComponent(quote(sheet.sheetTab))}?valueRenderOption=UNFORMATTED_VALUE`);

    const first = values.reduce((n, r) => Math.max(n, r.length), 0); // the first column after the last one that has a value
    if (first + keys.length > MAX_COLS) throw new Error(`There is no room: AliSwift uses columns A to Z and this tab already uses ${first} of them.`);
    const columns = Object.fromEntries(keys.map((k, i) => [k, indexToCol(first + i)]));
    const width = tab.gridProperties?.columnCount ?? 0;
    if (first + keys.length > width) {
      const requests = [{ appendDimension: { sheetId: tab.sheetId, dimension: "COLUMNS", length: first + keys.length - width } }];
      await sheetsFetch(`/${sheet.id}:batchUpdate`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ requests }) });
    }

    const at = (row, letter) => text(values[row - 1]?.[colToIndex(letter)]);
    const rows = [];
    for (let r = sheet.startRow; r <= values.length; r++) if (at(r, sheet.keywordsCol) || at(r, sheet.linkCol)) rows.push(r);
    const head = sheet.startRow - 1; // the header row, when there is one
    const cells = head >= 1 ? Object.entries(columns).map(([k, letter]) => [`${letter}${head}`, NEW_COLUMNS[k]]) : [];
    const sku = (r) => `${sheet.skuPrefix}${String(r - sheet.startRow + 1).padStart(2, "0")}`;
    if (columns.skuCol) cells.push(...rows.map((r) => [`${columns.skuCol}${r}`, sku(r)]));
    let photos = 0;
    if (columns.imageCol) {
      const kept = (await chrome.storage.local.get({ photos: {} })).photos;
      for (const r of rows) {
        const url = httpsUrl(kept[photoKey(at(r, sheet.linkCol))]);
        if (!url) continue;
        photos++;
        cells.push([`${columns.imageCol}${r}`, url]);
      }
    }
    await putCells(sheet.id, sheet.sheetTab, cells);

    // The titles look like their neighbours'. Cosmetic, so a refusal (a merged header, say) is not an error.
    const last = head >= 1 ? (values[head - 1] ?? []).findLastIndex((c) => text(c)) : -1;
    if (last >= 0) {
      const range = (from, to) => ({ sheetId: tab.sheetId, startRowIndex: head - 1, endRowIndex: head, startColumnIndex: from, endColumnIndex: to });
      const requests = [{ copyPaste: { source: range(last, last + 1), destination: range(first, first + keys.length), pasteType: "PASTE_FORMAT" } }];
      await sheetsFetch(`/${sheet.id}:batchUpdate`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ requests }) }).catch(() => {});
    }
    if (columns.skuCol) await moveListings(rows.map((r) => [`listing:${sheet.id}:${itemIdOf(at(r, sheet.linkCol))}`, `listing:${sheet.id}:${sku(r)}`]).filter(([from]) => !from.endsWith(":")));

    const { sheets } = await chrome.storage.sync.get({ sheets: [] });
    await chrome.storage.sync.set({ sheets: sheets.map((s) => (s.id === sheet.id ? { ...s, ...columns } : s)) });
    return { success: true, columns, skus: columns.skuCol ? rows.length : 0, photos };
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
    await rememberPhotos(fresh);
    const gone = [...fresh, ...dupes].map((x) => x.id);
    if (gone.length) await chrome.storage.local.set({ library: libTake(library, gone) });

    // A generated listing follows its product to the new key. ponytail: a re-run after a crash skips this, the listing is then regenerated.
    await moveListings(fresh.map((x, i) => [`listing:${LOCAL}:${x.sku}`, `listing:${sheetId}:${skus[i]}`]).filter(([, key]) => !key.endsWith(":")));
    return { success: true, moved: fresh.length, skipped: dupes.length, needRate };
  });
}

// Adds the products and photos of an imported backup to this device's. Never replaces or removes any.
function importLibrary(incoming, incomingPhotos = {}) {
  const items = cleanLibrary(incoming);
  const pics = cleanPhotos(incomingPhotos);
  if (!items || !pics) throw new Error("That library isn't valid.");
  return enqueue(async () => {
    const { library, photos } = await chrome.storage.local.get({ library: [], photos: {} });
    const lib = libMerge(library, items);
    await chrome.storage.local.set({ library: lib, photos: cleanPhotos({ ...pics, ...photos }) });
    return { success: true, added: lib.length - library.length };
  });
}

/* Page buttons: what the AliExpress page's buttons ask for */

// The products already in the sheet or the library, for quickList's look.
async function savedProducts(local, sheet) {
  return local ? libToProducts((await chrome.storage.local.get({ library: [] })).library) : (await readProducts(sheet)).products;
}

// The AliExpress page's "Create Listing": saves the product, writes its eBay listing and opens eBay, in one request.
// A product already saved from this link (in the sheet, or the library) keeps its SKU and is not added again, and its
// listing is the one already kept. A failure after the save says how far it got (`saved`, `sku`): the row stays.
// ponytail: the "already saved?" look and the save are two steps, so two tabs clicking at the same instant could both add. Upgrade: do both inside enqueue.
async function quickList(data) {
  const local = data?.dest === "local";
  const sheet = local ? null : await getActiveSheet();
  if (!local && !sheet) throw new Error("No sheet yet. Add one in AliSwift settings.");
  const sheetId = local ? LOCAL : sheet.id;
  const link = text(data?.link);
  const known = link ? (await savedProducts(local, sheet)).find((x) => x.status !== "Discontinued" && x.link === link) : null;
  let sku = known?.sku ?? "";
  if (known) await saveDetails(data); // the listing is written from this visit's details
  else {
    const saved = await appendRow(data);
    if (!saved.success) return saved; // nothing was saved: the page decides what to say
    sku = saved.sku ?? "";
  }
  try {
    const product = {
      sku, title: known?.title || text(data.title), link, image: known?.image || httpsUrl(data.image),
      salePrice: known ? known.salePrice : money(data.salePrice), currency: text(data.currency),
    };
    const made = await generateListing({ sheetId, product });
    const { region } = await listOnEbay({ sheetId, key: made.key, product });
    return { success: true, sku, existed: Boolean(known), cached: Boolean(made.cached), region };
  } catch (error) {
    return { ...fail(error), saved: true, sku };
  }
}

// Chrome stops a worker that has had no event for 30 seconds, and a Gemini call still running is no event. An extension
// API call every 20 seconds counts as one. Returns the function that stops the pings.
function keepAlive() {
  if (typeof setInterval !== "function") return () => {};
  const timer = setInterval(() => chrome.runtime.getPlatformInfo?.(), 20000);
  return () => clearInterval(timer);
}

// "Which one is it?" for a page that changed (lib/aimap.js): the page sends what it listed, Gemini answers with numbers
// from the list, and only the checked numbers go back. Each task answers only the site it is about.
const AI_SENDERS = { controls: onListingForm, orders: onOrdersPage, product: onAliExpress };
async function aiMap({ task, items } = {}, sender) {
  if (!Object.hasOwn(AI_TASKS, task) || !AI_SENDERS[task](sender?.url)) throw new Error("Not allowed.");
  const [build, check] = AI_TASKS[task];
  const raw = await callGemini({ ...build(items), timeoutMs: 30000 });
  return { success: true, answer: check(raw, items) };
}

/* Listings (Gemini). One listing per product, kept under listing:<sheetId>:<key> in storage.local ("local" is the
   library's sheetId). Nothing here reads or writes a sheet. */

const IMAGES_MAX = 4; // photos Gemini looks at
const PHOTOS_PER_LISTING = 12; // photos kept with a save, and attached to an eBay listing
const VARIANTS_MAX = 40; // variants with a photo of their own kept with a save
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
    images: (Array.isArray(d.images) ? d.images : []).slice(0, 20).map((u) => httpsUrl(u)).filter(Boolean).slice(0, PHOTOS_PER_LISTING),
    // The options that have a photo of their own (colour, style): { group, name, image }. Their photos are saved in a folder each.
    variants: (Array.isArray(d.variants) ? d.variants : []).slice(0, 100).map((v) => ({ group: text(v?.group).slice(0, 40), name: text(v?.name).slice(0, 80), image: httpsUrl(v?.image) })).filter((v) => v.name && v.image).slice(0, VARIANTS_MAX),
  };
  return out.fullTitle || out.specs.length || out.description || out.images.length || out.variants.length ? { ...out, savedAt: Date.now() } : null;
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
  const region = REGIONS[sheet?.region] ? sheet.region : regionForCurrency(text(p.currency));
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
    { region, marketplace: REGIONS[region].label, language: REGIONS[region].lang, wordsToLeaveOut, instructions: typeof aiInstructions === "string" ? aiInstructions : "" },
  );
  // 90 s: a listing with photos takes a while. Not retried on a timeout (that would be three minutes); Regenerate is.
  const stop = keepAlive();
  let raw;
  try {
    raw = await callGemini({ ...request, images: photos.map((x) => x.image), temperature: 0.7, timeoutMs: 90000 });
  } finally {
    stop();
  }
  const { listing, warnings, ok } = validateListing(raw, { wordsToLeaveOut });
  if (!ok) throw Object.assign(new Error("Gemini's answer had no usable title and description. Try again."), { code: "bad-output" });

  // `product` is what the eBay panel's cards show (SKU, name, sell price), kept with the listing so the panel needs no
  // sheet read. The cost price is never kept here.
  const meta = { sku: text(p.sku).slice(0, 50), title: text(p.title).slice(0, 200), salePrice: num(p.salePrice), currency: text(currency).slice(0, 3), link: text(p.link).slice(0, 2000), image: httpsUrl(p.image) };
  const record = { listing, limited: !details, model, createdAt: Date.now(), warnings, product: meta };
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
// isn't granted), "api-disabled" (the Drive API is off in the app's Google Cloud project, so asking for the scope
// again would not help), "signin" or "network".
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
    const refused = code === null && error.status === 403 ? (/has not been used|is disabled|SERVICE_DISABLED/i.test(error.message) ? "api-disabled" : "scope") : "";
    throw importError(code === "signin" ? "signin" : refused || "network", error.message);
  }
}

// The tabs of one spreadsheet and the first rows of each (up to 20 tabs, A to Z, 4 rows): { title, tabs, skipped }
// with each tab as prepareTabs makes it, plus `formulas`: the columns whose first data rows hold formulas (read
// again as typed), which AliSwift must not write over. A reply code is forbidden, xlsx (an Excel file opened in Sheets),
// noheaders (no tab has column titles), network, timeout, rate, signin or other.
async function readSpreadsheetMeta(id) {
  if (!SHEET_ID.test(id ?? "")) throw importError("other", "That doesn't look like a Google Sheets link or ID.");
  const signal = AbortSignal.timeout(IMPORT_TIMEOUT);
  const failure = (error) => {
    const code = readCode(error) ?? ([403, 404].includes(error.status) ? "forbidden" : /not supported for this document/i.test(error.message) ? "xlsx" : "other");
    return importError(code, error.message);
  };
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
    throw failure(error);
  }
  const { tabs, skipped } = prepareTabs(raw);
  if (!tabs.length) throw importError("noheaders", "No tab has column titles.");
  try {
    const ranges = tabs.map((t) => `ranges=${encodeURIComponent(`${quote(t.title)}!A${t.startRow}:Z${t.startRow + MAX_SAMPLES - 1}`)}`).join("&");
    const { valueRanges = [] } = await sheetsFetch(`/${id}/values:batchGet?valueRenderOption=FORMULA&${ranges}`, { signal: AbortSignal.timeout(IMPORT_TIMEOUT) });
    tabs.forEach((t, i) => (t.formulas = formulaCols(valueRanges[i]?.values)));
  } catch (error) {
    throw failure(error);
  }
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
      // A 404 is a model name Gemini doesn't know; the reply keeps code "bad-output" for the listing page.
      reason = error.status === 404 ? "bad-model" : GEMINI_CODES.includes(error.code) ? error.code : "bad-output";
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

/* eBay listing form (P6). The panel on eBay's /lstng page asks this worker for the product picked on the dashboard and
   for Gemini's help with the item specifics. It never reads or writes a sheet. */

// A message from a page button: a product page on AliExpress, not any other page or site.
function onAliExpress(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(^|\.)aliexpress\.(com|us)$/.test(u.hostname);
  } catch {
    return false;
  }
}

// A message from the orders button: Seller Hub's order pages on an eBay marketplace in REGIONS, not any other page or site.
function onOrdersPage(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && Object.values(REGIONS).some((r) => r.ebay === u.hostname) && u.pathname.startsWith("/sh/ord");
  } catch {
    return false;
  }
}

// A message from the panel: the listing form on an eBay marketplace in REGIONS, not any other page or site.
function onListingForm(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && Object.values(REGIONS).some((r) => r.ebay === u.hostname) && u.pathname.startsWith("/lstng");
  } catch {
    return false;
  }
}

// Remembers which product the panel works on, with what it needs to fill the form (so the form never waits for a sheet).
// The marketplace is the sheet's, else the one that sells in the product's currency. The price is kept only when it is in
// that marketplace's currency, so a price is never typed into the wrong site. Needs the product's saved listing.
async function pickTarget(sheetId, key, product) {
  const sheet = sheetId === LOCAL ? null : await sheetById(sheetId);
  const id = text(key).slice(0, 40);
  const slot = `listing:${sheetId}:${id}`;
  if (!id || !(await chrome.storage.local.get({ [slot]: null }))[slot]) throw new Error("Create a listing for this product first.");
  const p = product && typeof product === "object" ? product : {};
  const region = REGIONS[sheet?.region] ? sheet.region : regionForCurrency(text(p.currency));
  const currency = REGIONS[sheet?.region] ? REGIONS[sheet.region].currency : text(p.currency);
  const price = num(p.salePrice) > 0 && currency === REGIONS[region].currency ? num(p.salePrice) : null;
  const ebayTarget = { sheetId, key: id, sku: text(p.sku).slice(0, 50), title: text(p.title).slice(0, 200), price, region, link: text(p.link).slice(0, 2000), image: httpsUrl(p.image), at: Date.now() };
  await chrome.storage.local.set({ ebayTarget });
  return region;
}

// The dashboard's "List on eBay": picks the product, then opens eBay's listing start page for its marketplace.
async function listOnEbay({ sheetId, key, product } = {}) {
  const region = await pickTarget(sheetId, key, product);
  await chrome.tabs.create({ url: `https://${REGIONS[region].ebay}/sl/prelist/suggest` });
  return { success: true, region };
}

// The picked product and its saved listing, or {} when none was picked or its listing is gone.
async function ebayPick() {
  const { ebayTarget: target } = await chrome.storage.local.get({ ebayTarget: null });
  if (!target) return {};
  const slot = `listing:${target.sheetId}:${target.key}`;
  return { target, listing: (await chrome.storage.local.get({ [slot]: null }))[slot]?.listing };
}

// What the panel shows and fills: { target: { sku, title, price, currency, host } | null, listing: { title, description,
// html, specifics } | null }. The description comes as plain text (to copy) and as eBay's HTML (to fill); the listing's
// own item specifics are what the panel offers to copy when the AI step fails.
async function ebayContext() {
  const { target, listing } = await ebayPick();
  if (!target) return { success: true, target: null, listing: null };
  const region = REGIONS[target.region] ?? REGIONS.UK;
  const on = await photosOn();
  return {
    success: true,
    photos: { on, ...(on ? await photoSet(target).then((s) => ({ count: s.urls.length, variants: s.variants.length })) : { count: 0, variants: 0 }) },
    target: { sku: target.sku, title: target.title, price: target.price == null ? "" : target.price.toFixed(2), currency: region.currency, host: region.ebay },
    listing: listing ? { title: listing.title, description: listing.description, html: toEbayHtml(listing.description), specifics: listing.itemSpecifics ?? [] } : null,
  };
}

// The cards the panel offers: every product with a kept listing, newest first, as { sheetId, key, sku, title, price,
// currency, product }. A listing carries its product since it was written; an older one is looked up in the dashboard's
// cached list, else it shows the listing's own title. Listings of a sheet that has since been removed are left out.
async function ebayProductList() {
  const [all, { sheets }] = await Promise.all([chrome.storage.local.get(null), chrome.storage.sync.get({ sheets: [] })]);
  const regionOf = new Map([[LOCAL, ""], ...sheets.map((s) => [s.id, s.region])]);
  const cards = [];
  for (const [slot, record] of Object.entries(all)) {
    const [, sheetId, key] = /^listing:([\w-]+):(.+)$/.exec(slot) ?? [];
    if (!key || !regionOf.has(sheetId) || !record?.listing) continue;
    const cached = (all[`cache:${sheetId}`]?.products ?? []).find((x) => listingKey(x) === key);
    const p = record.product ?? cached ?? {};
    const currency = REGIONS[regionOf.get(sheetId)]?.currency ?? text(p.currency);
    cards.push({
      sheetId, key, sku: text(p.sku) || key, title: text(p.title) || text(record.listing.title), price: num(p.salePrice) > 0 ? num(p.salePrice) : null,
      currency, createdAt: num(record.createdAt) ?? 0, product: { ...p, currency },
    });
  }
  return cards.sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
}

// { products: [{ sheetId, key, sku, title, price, currency }], current: { sheetId, key } | null } for the panel's cards.
async function ebayProducts() {
  const { target } = await ebayPick();
  return {
    success: true,
    current: target ? { sheetId: target.sheetId, key: target.key } : null,
    products: (await ebayProductList()).map(({ product, createdAt, ...card }) => card),
  };
}

// The card the seller clicked becomes the panel's product. The panel names only the card (sheet and key): what is
// filled into the form, the price included, comes from this list and never from the page.
async function ebaySelect({ sheetId, key } = {}) {
  const card = (await ebayProductList()).find((x) => x.sheetId === sheetId && x.key === key);
  if (!card) throw new Error("That product's listing is gone. Create one on the dashboard.");
  await pickTarget(card.sheetId, card.key, card.product);
  return { success: true };
}

// Gemini matches the form's empty item specifics to the saved listing. { fields, category } from the panel (cleaned
// here) -> { success, answers: [{ name, value }] } of checked answers only. A failed reply has Gemini's `code`.
async function planFill({ fields, category } = {}) {
  const { target, listing } = await ebayPick();
  if (!listing) throw new Error("Choose a product on the dashboard first.");
  const list = cleanFields(fields);
  if (!list.some(askable)) return { success: true, answers: [] };
  const raw = await callGemini({ ...buildFillRequest(list, target, listing, category), timeoutMs: 45000 });
  return { success: true, answers: validateFillPlan(raw, list) };
}

// The panel can't open extension pages itself.
const PAGES = { dashboard: "dashboard/dashboard.html", settings: "options/options.html#ai" };
async function openPage(page) {
  if (!Object.hasOwn(PAGES, page)) throw new Error("Unknown page.");
  await chrome.tabs.create({ url: chrome.runtime.getURL(PAGES[page]) });
  return { success: true };
}
