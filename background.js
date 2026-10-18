importScripts("lib/shared.js", "lib/template.js", "lib/importmap.js", "lib/diag.js", "lib/ai.js", "lib/listing.js", "lib/fillplan.js", "lib/aimap.js");

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
  downloadPhotos: { aliOk: true, run: (request) => savePhotos({ ...request.data, sheetId: request.data?.dest === LOCAL ? LOCAL : undefined }) },
  inSheet: { aliOk: true, run: (request) => inSheet(request) },
  removeCheck: { aliOk: true, run: (request) => removeCheck(request) },
  removeFromSheet: { aliOk: true, run: (request) => removeFromSheet(request) },
  openOptions: { aliOk: true, run: (request) => openOptions(request?.tab) },
  createSheet: { pagesOnly: true, run: (request) => createSheet(request.data) },
  authState: { run: () => authState() },
  signIn: { pagesOnly: true, run: () => signIn() },
  signOut: { pagesOnly: true, run: () => signOut() },
  rate: { aliOk: true, run: (request) => getRate(request.data) },
  listProducts: { pagesOnly: true, run: (request) => listProducts(request.sheetId) },
  setStatus: { pagesOnly: true, run: (request) => setStatus(request.sheetId, request.key, request.status) },
  priceLocks: { pagesOnly: true, run: (request) => priceLocks(request) },
  updateProduct: { pagesOnly: true, run: (request) => updateProduct(request) },
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
  ebayContext: { ebaySell: true, run: () => ebayContext() },
  ebayProducts: { ebayOnly: true, run: (request, sender) => (rememberEbayTab(sender), ebayProducts()) },
  ebayWriteNow: { ebayOnly: true, run: () => ebayWriteNow() },
  ebayListed: { ebaySell: true, run: () => ebayListed() },
  ebayPhotoList: { ebayOnly: true, run: () => ebayPhotoList() },
  ebayThumb: { ebayOnly: true, run: (request) => ebayThumb(request.url, request.full === true) },
  ebayPhotosSave: { ebayOnly: true, run: (request) => ebayPhotosSave(request) },
  importOrders: { ordersOnly: true, run: (request) => importOrders(request) },
  aiMap: { aiTask: true, run: (request, sender) => aiMap(request, sender) },
  ebaySelect: { ebayOnly: true, run: (request) => ebaySelect(request) },
  planFill: { ebayOnly: true, run: (request) => planFill(request) },
  ebayDone: { ebayOnly: true, run: () => chrome.storage.local.remove("ebayTarget").then(() => ({ success: true })) },
  openPage: { ebayOnly: true, run: (request) => openPage(request.page) },
  sendLogs: { logsOk: true, run: async (request) => ({ success: true, ref: await diagReport(request.report) }) },
  diagCrash: { run: (request) => diagCrash(request) },
  diagFill: { ebayOnly: true, run: (request) => diagFill(request) },
};

// A failed reply keeps the error's code ("signin", "currency") so a page can tell what to offer. A failed Gemini
// call also says which model and which HTTP status, so a page can say "that model is gone" (404).
const fail = (error) => ({
  success: false,
  error: error.message,
  ...(error.code && { code: error.code }),
  ...(error.model && { model: error.model, status: error.status }),
  ...(error.provider && { provider: error.provider }),
  ...(error.retryAt && { retryAt: error.retryAt }),
  ...(error.report && { report: error.report }),
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!Object.hasOwn(handlers, request?.action)) return;
  const handler = handlers[request.action];
  const own = Boolean(sender.url?.startsWith(chrome.runtime.getURL("")));
  const url = sender.url;
  const allowed = handler.pagesOnly ? own
    : handler.aliOk ? own || onAliExpress(url)
    : handler.ebayOnly ? onListingForm(url)
    : handler.ebaySell ? onListingForm(url) || onSellFlow(url)
    : handler.ordersOnly ? onOrdersPage(url)
    : handler.aiTask ? onAliExpress(url) || onListingForm(url) || onOrdersPage(url)
    : handler.logsOk ? own || onListingForm(url)
    : true;
  if (!allowed) {
    sendResponse({ success: false, error: "Not allowed." });
    return;
  }
  Promise.resolve()
    .then(() => handler.run(request, sender))
    .catch((error) => {
      diagError(request.action, error);
      return fail(error);
    })
    .then(sendResponse);
  return true;
});

/* Diagnostics (lib/diag.js): failed requests and crashes, besides the AI requests lib/ai.js reports. */

// A failed request: which one and its code. A message only when there is no code, with anything quoted (a tab or sheet
// name) taken out. ponytail: an unquoted name in a message would still go; every message here quotes them.
function diagError(action, error) {
  const message = error.code ? "" : String(error.message ?? "").replace(/"[^"]*"|“[^”]*”/g, '"…"').slice(0, 200);
  diagEvent({ kind: "error", action: String(action).slice(0, 40), code: String(error.code ?? ""), ...(message && { message }) });
}

// A crash in a content script, as reportCrashes (lib/errors.js) sends it.
async function diagCrash({ message, stack } = {}) {
  await diagEvent({ kind: "crash", where: "page", message: String(message ?? "").slice(0, 500), stack: String(stack ?? "").slice(0, 4000) });
  return { success: true };
}

// Item specifics the eBay panel couldn't set, twice: eBay's names for them and how their boxes work, never a value.
async function diagFill({ fields } = {}) {
  const list = (Array.isArray(fields) ? fields : []).slice(0, 20).map((f) => ({ label: String(f?.label ?? "").slice(0, 60), kind: String(f?.kind ?? "").slice(0, 10), custom: Boolean(f?.custom), listed: Number(f?.listed) || 0 }));
  await diagEvent({ kind: "error", action: "fill", code: "unfilled", fields: list });
  return { success: true };
}

if (typeof self !== "undefined" && self.addEventListener) {
  for (const type of ["error", "unhandledrejection"]) {
    self.addEventListener(type, (e) => {
      const err = e.error ?? e.reason;
      diagEvent({ kind: "crash", where: "worker", message: String(err?.message ?? err ?? "").slice(0, 500), stack: String(err?.stack ?? "").slice(0, 4000) });
    });
  }
}

// Alarms survive the worker stopping; they are made once and checked on every start (a browser restart can drop them).
const ALARMS = { diag: 5, "ai-queue": 1 }; // minutes; Chrome's shortest is 1
for (const [name, every] of Object.entries(ALARMS)) chrome.alarms?.get(name).then((a) => a || chrome.alarms.create(name, { periodInMinutes: every }));
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === "diag") diagFlush();
  if (alarm.name === "ai-queue") runAiQueue();
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
    const sheetId = local ? LOCAL : (await getActiveSheet())?.id;
    if (sheetId && !result.existed) await queueListing(sheetId, { sku: result.sku, title: data.title, link: data.link, salePrice: money(data.salePrice), image: httpsUrl(data.image), currency: text(data.currency) });
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

// Exchange rates are stored as "<to>:<from>" = how many `from` buy one `to`, from ExchangeRate-API's free open
// endpoint (no key, CORS open, daily rates, PKR included). A rate is cached for 12 hours.
const RATE_TTL = 12 * 60 * 60 * 1000;
const RATE_API = "https://open.er-api.com/v6/latest/";
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

// The rate for converting `from` prices into the sheet's `to`: a fresh cached one, else the live one. When the
// service can't be reached an older cached rate still beats none. { success: true, rate: null } when there is none.
async function getRate({ from, to } = {}) {
  if (!CURRENCY.test(from) || !CURRENCY.test(to) || from === to) throw new Error("Choose two different currencies.");
  const key = `${to}:${from}`;
  const { rates } = await chrome.storage.local.get({ rates: {} });
  const cached = rates[key] && { success: true, rate: rates[key].rate, source: "live", at: rates[key].at };
  if (cached && Date.now() - cached.at < RATE_TTL) return cached;
  try {
    const res = await fetch(RATE_API + to, { signal: AbortSignal.timeout(10000) });
    const rate = Number((await res.json())?.rates?.[from]);
    if (res.ok && rate > 0 && Number.isFinite(rate)) {
      await saveRate(key, rate);
      return { success: true, rate, source: "live", at: Date.now() };
    }
  } catch {
    // ponytail: offline or the service is down: fall back to the stale cache below.
  }
  return cached || { success: true, rate: null };
}

// Calls a Google API with the user's token. A 401 means the cached token is stale or revoked: drop it and retry
// once with a fresh one. A failed reply throws an Error carrying the HTTP `status` and a `code` lib/errors.js knows
// (forbidden, sheet-rate; offline when Google couldn't be reached; sheet-error, said as "something went wrong", else).
async function googleFetch(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const token = await getToken();
    let res;
    try {
      res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    } catch (error) {
      if (error.name !== "TimeoutError" && error.name !== "AbortError") error.code ??= "offline";
      throw error;
    }
    if (res.status === 401 && attempt === 0) {
      await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
      continue;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const code = res.status === 429 ? "sheet-rate" : [403, 404].includes(res.status) ? "forbidden" : "sheet-error";
      throw Object.assign(new Error(body.error?.message ?? `Google Sheets error ${res.status}`), { status: res.status, code });
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
// Unformatted, so numbers come back as numbers and dates as serials ("FORMULA" as `render` brings formulas as typed).
// A field with no column reads as [].
async function readFields(id, tab, fields, from, render = "UNFORMATTED_VALUE") {
  const names = Object.keys(fields).filter((k) => fields[k]);
  const out = Object.fromEntries(Object.keys(fields).map((k) => [k, []]));
  if (!names.length) return out;
  const ranges = names.map((k) => `ranges=${encodeURIComponent(`${quote(tab)}!${fields[k]}${from}:${fields[k]}`)}`).join("&");
  const { valueRanges = [] } = await sheetsFetch(`/${id}/values:batchGet?${ranges}&majorDimension=COLUMNS&valueRenderOption=${render}`);
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

const noSheet = () => Object.assign(new Error("No sheet yet. Add one in AliSwift settings."), { code: "nosheet" });

// A product already in the sheet is not added again: { existed: true, sku } (the button then offers Remove).
async function writeRow(data) {
  try {
    const sheet = await getActiveSheet();
    if (!sheet) throw noSheet();
    guardCurrency(sheet, data.currency); // the one place every save to a sheet passes
    const { skus, dupeSkus } = await writeRows(sheet, [data]);
    const sku = skus[0] ?? dupeSkus[0];
    return { success: true, ...(dupeSkus.length && { existed: true }), ...(sku && { sku }) };
  } catch (error) {
    return fail(error);
  }
}

// Writes items into rows AliSwift cleared earlier (Remove) that are still empty, lowest first, then below the last used
// row: one read, one write, whatever the count. The next row and the SKUs come from the SKU and keywords columns only
// (input columns, so pre-filled formulas never count as data); a reused row gets the SKU it always had (nextSku numbers
// by row). An item already in the sheet (the same AliExpress item, else the same link and title) is left out and
// returned in `dupes`, its SKU in `dupeSkus`. A formula SKU column (skuFormula) is never written: the SKUs it shows are
// read back after the write. The sheet's index (sheetIndex) is rebuilt from the same read.
// ponytail: auto sheets have 1000 rows; past that Google's error is shown. Upgrade: appendDimension, then repeatCell.
async function writeRows(sheet, items) {
  const read = [...new Set([sheet.skuCol, sheet.keywordsCol, sheet.linkCol].filter(Boolean))];
  const ranges = read.map((c) => `ranges=${encodeURIComponent(`${quote(sheet.sheetTab)}!${c}:${c}`)}`).join("&");
  const { valueRanges = [] } = await sheetsFetch(`/${sheet.id}/values:batchGet?${ranges}`);
  const column = (c) => (c ? valueRanges[read.indexOf(c)]?.values ?? [] : []);
  const cell = (c, r) => text(column(c)[r - 1]?.[0]);
  const skuIn = sheet.skuFormula ? "" : sheet.skuCol; // a formula column shows something in every row: it can't tell used rows

  const keyOf = (link, title) => itemIdOf(link) || `${text(link)}\n${text(title)}`;
  const have = new Map(); // key -> its row (0: earlier in this batch)
  for (let r = sheet.startRow; r <= column(sheet.linkCol).length; r++) {
    const key = cell(sheet.linkCol, r) && keyOf(cell(sheet.linkCol, r), cell(sheet.keywordsCol, r));
    if (key && !have.has(key)) have.set(key, r);
  }
  const fresh = [];
  const dupeSkus = [];
  for (const x of items) {
    const key = keyOf(x.link, x.title);
    if (have.has(key)) dupeSkus.push(cell(sheet.skuCol, have.get(key)));
    else (fresh.push(x), have.set(key, 0));
  }
  const dupes = items.filter((x) => !fresh.includes(x));

  const clearedKey = `cleared:${sheet.id}`;
  const cleared = (await chrome.storage.local.get({ [clearedKey]: [] }))[clearedKey];
  const used = (r) => [skuIn, sheet.keywordsCol, sheet.linkCol].some((c) => cell(c, r));
  let next = nextRow(column(skuIn), column(sheet.keywordsCol), sheet.startRow);
  const reuse = cleared.filter((r) => r < next && !used(r)).sort((a, b) => a - b);
  const rows = fresh.map(() => reuse.shift() ?? next++);
  let skus = [];
  if (fresh.length) {
    const cells = fresh.flatMap((x, i) => {
      const r = rows[i];
      const sku = skuIn ? nextSku([...column(skuIn).map((c) => c[0]), ...skus], sheet.skuPrefix, r, sheet.startRow) : "";
      skus.push(sku);
      return [
        [sheet.keywordsCol, x.title],
        [sheet.priceCol, toNumber(x.price)],
        [sheet.salePriceCol, toNumber(x.salePrice)],
        [sheet.linkCol, x.link],
        [skuIn, sku],
        [sheet.imageCol, httpsUrl(x.image)],
      ]
        .filter(([col]) => col)
        .map(([col, value]) => [`${col}${r}`, value]);
    });
    await putCells(sheet.id, sheet.sheetTab, cells);
    if (sheet.skuFormula && sheet.skuCol) {
      const back = rows.map((r) => `ranges=${encodeURIComponent(`${quote(sheet.sheetTab)}!${sheet.skuCol}${r}`)}`).join("&");
      const { valueRanges: got = [] } = await sheetsFetch(`/${sheet.id}/values:batchGet?${back}`);
      skus = rows.map((r, i) => text(got[i]?.values?.[0]?.[0]));
    }
  }

  const index = {};
  for (const [key, r] of have) if (r && /^\d+$/.test(key)) index[key] = { sku: cell(sheet.skuCol, r), row: r };
  fresh.forEach((x, i) => itemIdOf(x.link) && (index[itemIdOf(x.link)] = { sku: skus[i], row: rows[i] }));
  await chrome.storage.local.set({ [`index:${sheet.id}`]: { at: Date.now(), items: index }, [clearedKey]: cleared.filter((r) => r < next && !used(r) && !rows.includes(r)) });
  return { fresh, dupes, skus, dupeSkus };
}

/* The sheet's index: which AliExpress items it has, so the page's button says Add or Remove at once, and a download
   finds the SKU. index:<sheetId> = { at, items: { itemId: { sku, row } } }, rebuilt by every write (writeRows) and read
   again (link and SKU columns, one request) when older than 5 minutes. */

const INDEX_TTL = 5 * 60000;

async function sheetIndex(sheet) {
  const slot = `index:${sheet.id}`;
  const kept = (await chrome.storage.local.get({ [slot]: null }))[slot];
  if (kept && Date.now() - kept.at < INDEX_TTL) return kept.items;
  const c = await readFields(sheet.id, sheet.sheetTab, { link: sheet.linkCol, sku: sheet.skuCol }, sheet.startRow);
  const items = {};
  c.link.forEach((l, i) => {
    const id = itemIdOf(l);
    if (id && !items[id]) items[id] = { sku: text(c.sku[i]), row: sheet.startRow + i };
  });
  await chrome.storage.local.set({ [slot]: { at: Date.now(), items } });
  return items;
}

// The library's record of an AliExpress item, if it is saved there (and not removed).
async function libraryItem(itemId) {
  const { library } = await chrome.storage.local.get({ library: [] });
  return library.find((x) => x.status !== "Discontinued" && itemIdOf(x.link) === itemId) ?? null;
}

// Is the page's product in the active sheet (or, with dest "local", the library)? { inSheet, sku }.
async function inSheet({ link, dest } = {}) {
  const id = itemIdOf(link);
  if (!id) return { success: true, inSheet: false };
  if (dest === LOCAL) {
    const rec = await libraryItem(id);
    return { success: true, inSheet: Boolean(rec), sku: rec?.sku ?? "" };
  }
  const sheet = await getActiveSheet();
  const hit = sheet ? (await sheetIndex(sheet))[id] : null;
  return { success: true, inSheet: Boolean(hit), sku: hit?.sku ?? "" };
}

// Before Remove asks for its second click: { sku, orderSku } where orderSku is set when a row of the Orders tab uses the
// product's SKU (one read of that tab's SKU column). An order tab that can't be read warns about nothing.
async function removeCheck({ link, dest } = {}) {
  const id = itemIdOf(link);
  const sheet = dest === LOCAL || !id ? null : await getActiveSheet();
  if (!sheet) return { success: true, sku: "", orderSku: "" };
  const sku = (await sheetIndex(sheet))[id]?.sku ?? "";
  const cols = { ...SHEET_DEFAULTS.oCols, ...sheet.oCols };
  if (!sku || !sheet.oTab || !cols.sku) return { success: true, sku, orderSku: "" };
  const f = await readFields(sheet.id, sheet.oTab, { sku: cols.sku }, sheet.oRow).catch(() => ({ sku: [] }));
  return { success: true, sku, orderSku: f.sku.some((s) => text(s).toLowerCase() === sku.toLowerCase()) ? sku : "" };
}

// Remove: clears the cells AliSwift writes in the product's row (name, prices, link, photo, status, and the SKU unless a
// formula makes it), so formulas in the row stay, and remembers the row for the next Add. The row is found by its link
// inside the write queue, from a fresh read, so a sorted sheet never loses the wrong row: a product no longer there
// fails with row-changed and nothing is cleared. The Orders tab is never touched. The queued listing and the listing go.
async function removeFromSheet({ link, dest } = {}) {
  const id = itemIdOf(link);
  if (!id) throw new Error("That isn't an AliExpress product link.");
  const changed = () => Object.assign(new Error("That product isn't there any more, so nothing was removed."), { code: "row-changed" });
  if (dest === LOCAL) {
    await enqueue(async () => {
      const { library } = await chrome.storage.local.get({ library: [] });
      const gone = library.filter((x) => x.status !== "Discontinued" && itemIdOf(x.link) === id).map((x) => x.id);
      if (!gone.length) throw changed();
      await chrome.storage.local.set({ library: libTake(library, gone) });
    });
  } else {
    const sheet = await getActiveSheet();
    if (!sheet) throw noSheet();
    await enqueue(async () => {
      const slot = `index:${sheet.id}`;
      const c = await readFields(sheet.id, sheet.sheetTab, { link: sheet.linkCol }, sheet.startRow);
      const i = c.link.findIndex((l) => itemIdOf(l) === id);
      if (i < 0) {
        await chrome.storage.local.remove(slot); // the index was out of date: read it again next time
        throw changed();
      }
      const row = sheet.startRow + i;
      const cols = [sheet.keywordsCol, sheet.priceCol, sheet.includeSalePrice && sheet.salePriceCol, sheet.linkCol, sheet.imageCol, sheet.statusCol, !sheet.skuFormula && sheet.skuCol];
      const ranges = [...new Set(cols.filter(Boolean))].map((col) => `${quote(sheet.sheetTab)}!${col}${row}`);
      await sheetsFetch(`/${sheet.id}/values:batchClear`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ ranges }) });
      const clearedKey = `cleared:${sheet.id}`;
      const kept = await chrome.storage.local.get({ [clearedKey]: [], [slot]: null });
      const items = { ...kept[slot]?.items };
      delete items[id];
      await chrome.storage.local.set({ [clearedKey]: [...new Set([...kept[clearedKey], row])].slice(-500), ...(kept[slot] && { [slot]: { ...kept[slot], items } }) });
    });
  }
  await dropListing(id);
  return { success: true };
}

async function saveLocal(data) {
  try {
    const known = itemIdOf(data?.link) && (await libraryItem(itemIdOf(data.link)));
    if (known) return { success: true, local: true, existed: true, sku: known.sku };
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
  const [c, file] = await Promise.all([
    readFields(sheet.id, sheet.sheetTab, cols, sheet.startRow),
    sheet.statusCol && sheetsFetch(`/${sheet.id}?fields=${encodeURIComponent("sheets(properties(title),merges)")}`),
  ]);
  let shared = [];
  if (sheet.statusCol) {
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

// Which of the price cells in `row` hold a formula (["price", "salePrice"] or fewer): the sheet's to calculate, never
// written over. The inspector asks when it opens, to show them read-only; updateProduct asks again before it writes.
async function lockedPrices(sheet, row) {
  const f = await readFields(sheet.id, sheet.sheetTab, { price: sheet.priceCol, salePrice: sheet.salePriceCol }, row, "FORMULA");
  return ["price", "salePrice"].filter((k) => typeof f[k][0] === "string" && f[k][0].trim().startsWith("="));
}

// { sheetId, row } -> { locked }. The row is the dashboard's, as it read it a moment ago; only the display depends on it.
async function priceLocks({ sheetId, row } = {}) {
  if (sheetId === LOCAL || !Number.isInteger(row) || row < 1) return { success: true, locked: [] };
  return { success: true, locked: await lockedPrices(await sheetById(sheetId), row) };
}

// The inspector's two prices: { sheetId, key, price?, salePrice? } -> { success, price, salePrice } as kept. Only the
// fields sent are written. A price cell that holds a formula is the sheet's: that fails with `formula`, nothing written.
async function updateProduct({ sheetId, key, price, salePrice } = {}) {
  const clean = (v) => {
    if (v === undefined) return undefined;
    const n = v === null || v === "" ? NaN : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new Error("Enter a price of 0 or more.");
    return round2(n);
  };
  const set = { price: clean(price), salePrice: clean(salePrice) };
  if (set.price === undefined && set.salePrice === undefined) throw new Error("Say which price to change.");
  const gone = () => Object.assign(new Error("That product isn't in the sheet any more."), { code: "gone" });
  if (sheetId === LOCAL) {
    return enqueue(async () => {
      const { library } = await chrome.storage.local.get({ library: [] });
      const row = findRow(libToProducts(library), key);
      if (row < 0) throw gone();
      const patch = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
      await chrome.storage.local.set({ library: library.map((x, i) => (i === row - 1 ? { ...x, ...patch } : x)) });
      return { success: true, ...patch };
    });
  }
  const sheet = await sheetById(sheetId);
  return enqueue(async () => {
    // The row is found again here, inside the queue, from a fresh read: the sheet may have been sorted since.
    const { products } = await readProducts(sheet);
    const row = findRow(products, key);
    if (row < 0) throw gone();
    const cols = { price: sheet.priceCol, salePrice: sheet.salePriceCol };
    const fields = Object.keys(set).filter((f) => set[f] !== undefined && cols[f]);
    if (!fields.length) throw new Error("This sheet has no column for that price.");
    const locked = await lockedPrices(sheet, row);
    if (fields.some((f) => locked.includes(f))) {
      throw Object.assign(new Error("That price is a formula in your sheet."), { code: "formula" });
    }
    await putCells(sheet.id, sheet.sheetTab, fields.map((f) => [`${cols[f]}${row}`, set[f]]));
    return { success: true, ...Object.fromEntries(fields.map((f) => [f, set[f]])) };
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
  const f = await readFields(sheet.id, sheet.oTab, { no: cols.no, sku: cols.sku, status: cols.status, track: cols.track, sell: cols.sell }, 1); // one read: the same call also brings the status and tracking
  const rows = Array.from({ length: Math.max(f.no.length, f.sku.length) }, (_, i) => ({ row: i + 1, no: f.no[i], sku: f.sku[i] }));
  return { f, rows: rows.filter((r) => r.row >= sheet.oRow) };
}

async function listOrders(sheetId) {
  const { sheet, cols } = await ordersOf(sheetId);
  const c = await readFields(sheet.id, sheet.oTab, cols, sheet.oRow);
  // The product's name is a formula on the Orders tab with no column of its own here, so it comes from Inventory by SKU.
  const inv = sheet.skuCol && sheet.keywordsCol ? await readFields(sheet.id, sheet.sheetTab, { sku: sheet.skuCol, name: sheet.keywordsCol, sell: sheet.salePriceCol }, sheet.startRow) : { sku: [], name: [], sell: [] };
  const names = new Map(inv.sku.map((s, i) => [text(s).toLowerCase(), text(inv.name[i])]));
  const unitSell = new Map(inv.sku.map((s, i) => [text(s).toLowerCase(), num(inv.sell?.[i])])); // when an order's own sell cell is empty
  const orders = [];
  for (let i = 0; i < Math.max(...Object.values(c).map((l) => l.length)); i++) {
    const [orderNumber, sku] = [c.no[i], c.sku[i]].map(text);
    if (!orderNumber && !sku) continue;
    const qty = Number(c.qty[i]) > 0 ? Number(c.qty[i]) : 1;
    const own = num(c.sell[i]);
    const unit = unitSell.get(sku.toLowerCase());
    orders.push({
      row: sheet.oRow + i, orderNumber, sku, product: names.get(sku.toLowerCase()) ?? "", date: fromSheetDate(c.date[i]),
      qty, sell: own ?? (unit == null ? null : round2(unit * qty)), cost: num(c.cost[i]), profit: num(c.profit[i]),
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
  if (!sheet) throw noSheet();
  const { cols } = await ordersOf(sheet.id);
  const { lines, rejected } = cleanOrderImport(orders);
  if (!lines.length) return { success: true, added: 0, skipped: 0, rejected, unknown: 0 };
  return enqueue(async () => {
    const { f, rows } = await readOrderKeys(sheet, cols);
    const keyOf = (no, sku) => `${text(no).toLowerCase()}|${text(sku).toLowerCase()}`;
    const seen = new Set(rows.map((r) => keyOf(r.no, r.sku)));
    const fresh = lines.filter((o) => !seen.has(keyOf(o.orderNumber, o.sku)) && seen.add(keyOf(o.orderNumber, o.sku)));
    // An order already there: its status moves on from Pending/Ordered to what eBay shows, and an empty tracking cell takes
    // eBay's number. Nothing else of the row is touched, so what the seller typed stays.
    const have = f;
    const updates = [];
    for (const o of lines) {
      const r = rows.find((x) => keyOf(x.no, x.sku) === keyOf(o.orderNumber, o.sku));
      if (!r) continue;
      const now = text(have.status?.[r.row - 1]);
      if (cols.status && o.status !== "Pending" && o.status !== now && ["", "Pending", "Ordered"].includes(now)) updates.push([`${cols.status}${r.row}`, o.status]);
      if (cols.track && o.tracking && !text(have.track?.[r.row - 1])) updates.push([`${cols.track}${r.row}`, o.tracking]);
      if (cols.sell && o.sell != null && num(have.sell?.[r.row - 1]) == null) updates.push([`${cols.sell}${r.row}`, o.sell]); // the price eBay shows
    }
    if (updates.length) await putCells(sheet.id, sheet.oTab, updates);
    if (!fresh.length) return { success: true, added: 0, skipped: lines.length, rejected, unknown: 0, updated: updates.length };

    const inv = sheet.skuCol ? await readFields(sheet.id, sheet.sheetTab, { sku: sheet.skuCol, cost: sheet.priceCol, sell: sheet.salePriceCol }, sheet.startRow) : { sku: [], cost: [], sell: [] };
    const unit = new Map(inv.sku.map((s, i) => [text(s).toLowerCase(), { cost: num(inv.cost[i]), sell: num(inv.sell[i]) }]));
    const first = nextRow(f.no.map((v) => [v]), f.sku.map((v) => [v]), sheet.oRow);
    let unknown = 0;
    const unknownSkus = new Set();
    const cells = fresh.flatMap((o, i) => {
      const u = unit.get(o.sku.toLowerCase());
      if (u?.cost == null) {
        unknown++;
        unknownSkus.add(o.sku);
      }
      const sell = o.sell ?? (u?.sell == null ? null : round2(u.sell * o.qty)); // eBay's price first, the sheet's sell price when the page shows none
      const cost = u?.cost == null ? null : round2(u.cost * o.qty);
      return [
        [cols.no, o.orderNumber], [cols.sku, o.sku], [cols.date, o.serial], [cols.qty, o.qty], [cols.sell, sell],
        [cols.cost, cost], [cols.status, o.status], [cols.track, o.tracking],
      ].filter(([col]) => col).map(([col, value]) => [`${col}${first + i}`, value]);
    });
    await putCells(sheet.id, sheet.oTab, cells);
    return { success: true, added: fresh.length, skipped: lines.length - fresh.length, rejected, unknown, unknownSkus: [...unknownSkus], updated: updates.length };
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

/* Photos. "Add from AliExpress" on eBay's photo box shows the picked product's photos; the ones the seller picks are saved
   with chrome.downloads (an optional permission the options page asks for) under Downloads, where they drag them in.
   The AliExpress page's download button saves them the same way. */

// Where photos go: photoDir is a folder under Downloads ("" = the sheet's name); photoSort puts each product's photos in a
// folder named after its SKU, and each variant's photo in a folder of its own inside it.
const PHOTO_PREFS = { photoDir: "", photoSort: true };

// Is this address a photo on one of AliExpress's image hosts?
const onPhotoHost = (u) => {
  try {
    return IMAGE_HOSTS.test(new URL(u).hostname);
  } catch {
    return false;
  }
};

// A product's photos, as { urls, variants }. urls: its gallery (the page's `details` when given, else those kept with its
// save, else its one photo), at most PHOTOS_PER_LISTING. variants: the options that have a photo of their own (colour,
// style), [{ group, name, image }], at most VARIANTS_MAX. Only addresses on AliExpress's image hosts, at full size.
async function photoSet(target, pageDetails = null) {
  const id = itemIdOf(target.link);
  const details = pageDetails ?? (id ? (await chrome.storage.local.get({ [`details:${id}`]: null }))[`details:${id}`] : null);
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

const PHOTO_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const photoName = (n, ext) => `img-${String(Number(n) + 1).padStart(2, "0")}${ext}`;

// A folder or file name that is safe on Windows, Mac and Linux, and cannot climb out of Downloads.
const safeName = (s) => text(s).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 60) || "AliSwift";

// A folder the seller typed, under Downloads: each part made safe, at most three deep, "" when nothing is left of it.
const safeDir = (s) =>
  text(s)
    .split(/[\\/]+/)
    .map((part) => part.replace(/[<>:"|?*\u0000-\u001f]/g, "-").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 60))
    .filter(Boolean)
    .slice(0, 3)
    .join("/");

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

// The picked product's photos for the "Add from AliExpress" window: { sku, photos: [url], variants: [{ name, url }],
// folder (the seller's, "" for the sheet's name), defaultFolder, sort, allowed (the downloads permission) }.
async function ebayPhotoList() {
  const { target } = await ebayPick();
  if (!target) throw new Error("Choose a product in the AliSwift panel first.");
  // A product saved before its gallery was kept has one photo: its page is read once for the rest, and they are kept.
  const id = itemIdOf(target.link);
  const slot = `details:${id}`;
  const kept = id ? (await chrome.storage.local.get({ [slot]: null }))[slot] : null;
  if (id && !(kept?.images?.length > 1)) {
    const images = (await fetchGallery(id)).slice(0, PHOTOS_PER_LISTING);
    if (images.length > (kept?.images?.length ?? 0)) await chrome.storage.local.set({ [slot]: { ...kept, images } });
  }
  const { urls, variants } = await photoSet(target);
  const sheet = target.sheetId === LOCAL ? null : await sheetById(target.sheetId).catch(() => null);
  const { photoDir, photoSort } = await chrome.storage.sync.get(PHOTO_PREFS);
  return {
    success: true,
    sku: target.sku || target.key,
    photos: urls,
    variants: variantFolders(variants).map(({ dir, image }) => ({ name: dir, url: image })),
    folder: photoDir,
    defaultFolder: sheet ? safeName(sheet.name) : target.sheetId === LOCAL ? "Library" : "AliSwift",
    sort: photoSort,
    allowed: Boolean(chrome.downloads?.download),
  };
}

// One of the picked product's photos as { mime, data }: a small copy for the window, or (full) the photo itself, to put on
// the listing; null when it won't load. Fetched here, since eBay's page cannot read AliExpress's image host; only the
// picked product's own photos.
async function ebayThumb(url, full = false) {
  const { target } = await ebayPick();
  const { urls, variants } = target ? await photoSet(target) : { urls: [], variants: [] };
  if (![...urls, ...variants.map((v) => v.image)].includes(url)) throw new Error("That isn't one of this product's photos.");
  return { success: true, image: (!full && (await fetchImage(url + SMALL_PHOTO))) || (await fetchImage(url)) };
}

// The gallery of an AliExpress item from its public page's imagePathList, at full size; [] when the page can't be had.
async function fetchGallery(id) {
  try {
    const res = await fetch(`https://www.aliexpress.com/item/${id}.html`, { credentials: "omit", signal: AbortSignal.timeout(12000) });
    return res.ok ? pageGallery((await res.text()).slice(0, 500000)) : [];
  } catch {
    return [];
  }
}

function pageGallery(html) {
  const list = /"imagePathList"\s*:\s*\[([^\]]*)\]/.exec(String(html ?? ""))?.[1] ?? "";
  const urls = [...list.matchAll(/"([^"]+)"/g)].map(([, raw]) => {
    const u = raw.replace(/\\/g, "").trim();
    return fullSizePhoto(u.startsWith("//") ? `https:${u}` : u);
  });
  return [...new Set(urls.filter(onPhotoHost))];
}

// The photos the seller picked in the window, saved; the folder and the sorting are kept for next time (and for the
// AliExpress page's button).
async function ebayPhotosSave({ urls, folder, sort } = {}) {
  const { target } = await ebayPick();
  if (!target) throw new Error("Choose a product first.");
  if (!Array.isArray(urls) || !urls.length) throw Object.assign(new Error("Pick at least one photo."), { code: "nophotos" });
  await chrome.storage.sync.set({ photoDir: safeDir(folder), photoSort: sort !== false });
  return savePhotos({ sheetId: target.sheetId, link: target.link, image: target.image, sku: target.sku || target.key, urls: urls.map(String).slice(0, 60) });
}

// Saves a product's photos under Downloads. Sorted: to <folder>/<SKU>/img-01.jpg and so on, and each variant's photo to
// <folder>/<SKU>/<variant name>/img-01.jpg. Unsorted: all in <folder>, as <SKU>-img-01.jpg and <SKU>-<variant name>.jpg.
// The folder is the seller's (PHOTO_PREFS), else the sheet's name: `sheetId`'s (LOCAL: Library), else the active one's.
// The SKU is the one the sheet's index (or the library) has for the item, so a formula SKU names the folder too; else
// `sku`, else the title. `details` are what the AliExpress page sends; `urls`: only these of the product's photos.
// Needs the downloads permission. The AliExpress page's button and the eBay window both come here.
async function savePhotos({ sheetId, link, image, title, sku, details, urls: only } = {}) {
  if (!chrome.downloads?.download) throw Object.assign(new Error("Allow downloads in AliSwift's settings to save photos to a folder."), { code: "permission" });
  const sheet = sheetId === LOCAL ? null : sheetId ? await sheetById(sheetId) : await getActiveSheet();
  const id = itemIdOf(link);
  const known = !id ? "" : sheet ? (await sheetIndex(sheet).catch(() => ({})))[id]?.sku : (await libraryItem(id))?.sku;
  const { urls, variants } = await photoSet({ link, image }, cleanDetails(details));
  const { photoDir, photoSort } = await chrome.storage.sync.get(PHOTO_PREFS);
  const base = safeDir(photoDir) || safeName(sheet ? sheet.name : sheetId === LOCAL ? "Library" : "AliSwift");
  const name = safeName(known || sku || title || id || "product");
  const folder = photoSort ? `${base}/${name}` : base;
  const wanted = (url) => !Array.isArray(only) || only.includes(url);
  const jobs = [
    ...urls.filter(wanted).map((url, i) => ({ url, stem: photoSort ? photoName(i, "") : `${name}-${photoName(i, "")}` })),
    ...variantFolders(variants)
      .filter((v) => wanted(v.image))
      .map(({ dir, image: url }) => ({ url, stem: photoSort ? `${dir}/${photoName(0, "")}` : `${name}-${dir}` })),
  ];
  if (!jobs.length) throw Object.assign(new Error("No photos found for this product."), { code: "nophotos" });
  let saved = 0;
  const stop = keepAlive(); // asking the host what each photo is, and saving, can take longer than the worker's 30 seconds
  try {
    const exts = await Promise.all(jobs.map((j) => photoExt(j.url)));
    for (const [i, { url, stem }] of jobs.entries()) {
      try {
        await chrome.downloads.download({ url, filename: `${folder}/${stem}${exts[i]}`, conflictAction: "uniquify" });
        saved++;
      } catch {
        // one photo that will not download does not stop the others
      }
    }
  } finally {
    stop();
  }
  if (!saved) throw new Error("The photos couldn't be saved.");
  return { success: true, folder: folder.replaceAll("/", "\\"), saved, total: jobs.length, variants: variants.length };
}

/* The panels open on eBay's listing form are told when the products they offer change (a listing written, a product
   sent from the dashboard), so the seller never reloads for it. Their tabs are kept here; a tab that is gone drops out. */

async function rememberEbayTab(sender) {
  const id = sender?.tab?.id;
  if (id == null || !chrome.storage.session) return;
  const { ebayTabs } = await chrome.storage.session.get({ ebayTabs: [] }).catch(() => ({ ebayTabs: [] }));
  if (!ebayTabs.includes(id)) await chrome.storage.session.set({ ebayTabs: [...ebayTabs, id].slice(-20) }).catch(() => {});
}

chrome.storage.onChanged?.addListener(async (changes, area) => {
  if (area !== "local" || !chrome.storage.session || !Object.keys(changes).some((k) => k.startsWith("listing:") || k === "aiQueue" || k === "ebayTarget")) return;
  const { ebayTabs } = await chrome.storage.session.get({ ebayTabs: [] });
  const told = await Promise.all(ebayTabs.map((id) => chrome.tabs.sendMessage(id, { action: "ebayRefresh" }).then(() => true, () => false)));
  if (told.includes(false)) await chrome.storage.session.set({ ebayTabs: ebayTabs.filter((_, i) => told[i]) });
});

async function openOptions(tab = "general") {
  const url = chrome.runtime.getURL(`options/options.html${tab ? `#${tab}` : ""}`);
  const [existing] = await chrome.tabs.query({ url: chrome.runtime.getURL("options/options.html*") });
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { url, active: true });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  return { success: true };
}

const NEW_COLUMNS = { skuCol: "SKU", imageCol: "Image URL" };

// Adds the SKU and/or Image URL column to a sheet's Inventory tab, after the last column that has a value (AliSwift reads
// columns A to Z), with its title in the header row. Only after the seller said yes (options page: "Add missing
// columns?"), and the only place AliSwift changes a sheet's layout. It writes only into the new, empty columns, and the
// new letters are saved in the sheet's settings. The products already there get SKUs numbered as the template does (the
// prefix and their place in the list) and the photo link this device kept, if any. A listing written before the product
// had a SKU stays where it is: listings are filed by AliExpress item number.
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
        if (!(rec.currency in rates)) rates[rec.currency] = (await getRate({ from: rec.currency, to })).rate;
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

    const { fresh, dupes } = await writeRows(sheet, items);
    await rememberPhotos(fresh);
    const gone = [...fresh, ...dupes].map((x) => x.id);
    if (gone.length) await chrome.storage.local.set({ library: libTake(library, gone) });
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
  const stop = keepAlive();
  let raw;
  try {
    ({ answer: raw } = await callAi({ ...build(items), task, timeoutMs: 30000 }));
  } finally {
    stop();
  }
  return { success: true, answer: check(raw, items) };
}

/* Listings (AI). One listing per product, kept under listing:<AliExpress item number> in storage.local, so a product's
   listing never moves when its SKU or sheet changes. Nothing here reads or writes a sheet. */

const IMAGES_MAX = 2; // photos the AI looks at, at AliExpress's small size (SMALL_PHOTO)
const SMALL_PHOTO = "_350x350.jpg";
const PHOTOS_PER_LISTING = 12; // photos kept with a save, and attached to an eBay listing
const VARIANTS_MAX = 40; // variants with a photo of their own kept with a save
// Photos are fetched here, not by the page, from AliExpress's own hosts only. 3 MB each keeps four of them, as
// base64, under Gemini's 20 MB request limit.
const IMAGE_HOSTS = /(^|\.)(alicdn\.com|aliexpress-media\.com|aliexpress\.com|aliexpress\.us)$/;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_BYTES = 3 * 1024 * 1024;

// The AliExpress item number in a product link, or "".
const itemIdOf = (link) => /(?:\/item\/|[?&]productId=)(\d{6,})/.exec(String(link ?? ""))?.[1] ?? "";

// What a listing is filed under: the product's AliExpress item number.
const listingKey = (product) => itemIdOf(product?.link);

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

// Writes a listing for one product with the AI (lib/ai.js), or answers the one already kept (unless `force`).
// `product` is a dashboard card's product ({ sku, title, link, salePrice, image, currency }). Only the sell price
// goes to the AI, never the cost. Answers { success, key, listing, limited, model, createdAt, warnings, cached? }.
// `limited` means no saved details were found, so it was written from the sheet's name alone. Photos go only with
// the aiPhotos setting on. A failed reply has one of AI_CODES as `code`.
async function generateListing({ sheetId, product, force } = {}) {
  const p = product && typeof product === "object" ? product : {};
  const key = listingKey(p);
  if (!key) throw new Error("This product has no AliExpress link to keep its listing under.");
  const sheet = sheetId === LOCAL ? null : await sheetById(sheetId);
  const slot = `listing:${key}`;
  if (!force) {
    const kept = (await chrome.storage.local.get({ [slot]: null }))[slot];
    if (kept) return { success: true, key, cached: true, ...kept };
  }
  const keys = await aiPool();
  if (!keys.length) throw aiError("nokey", "Add an AI key in the AI tab."); // stop before any photo is fetched

  const id = itemIdOf(p.link);
  const details = id ? (await chrome.storage.local.get({ [`details:${id}`]: null }))[`details:${id}`] : null;
  const { aiInstructions, aiPhotos } = await chrome.storage.sync.get({ aiInstructions: "", aiPhotos: false });
  // Photos only when the setting is on and a key can take them (Gemini).
  const withPhotos = aiPhotos === true && keys.some((k) => AI_PROVIDERS[k.provider].images);
  const urls = withPhotos ? [...new Set((details?.images?.length ? details.images : [p.image]).map((u) => fullSizePhoto(u)).filter(Boolean))].slice(0, IMAGES_MAX).map((u) => u + SMALL_PHOTO) : [];
  const photos = (await Promise.all(urls.map(async (url) => ({ url, image: await fetchImage(url) })))).filter((x) => x.image);

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
  // 90 s: a listing with photos takes a while. Not retried on a timeout; the queue (or Regenerate) tries again.
  const check = (raw) => {
    const r = validateListing(raw, { wordsToLeaveOut });
    if (!r.ok) throw aiError("bad-output", "The AI's answer had no usable title and description. Try again.");
    return r;
  };
  const stop = keepAlive();
  let reply;
  try {
    reply = await callAi({ ...request, task: "listing", images: photos.map((x) => x.image), temperature: 0.7, timeoutMs: 90000, check });
  } finally {
    stop();
  }
  const { answer: { listing, warnings }, model } = reply;

  // `product` is what the eBay panel's cards show (SKU, name, sell price), kept with the listing so the panel needs no
  // sheet read. The cost price is never kept here.
  const meta = { sku: text(p.sku).slice(0, 50), title: text(p.title).slice(0, 200), salePrice: num(p.salePrice), currency: text(currency).slice(0, 3), link: text(p.link).slice(0, 2000), image: httpsUrl(p.image) };
  const record = { listing, sheetId, limited: !details, model, createdAt: Date.now(), warnings, product: meta };
  await chrome.storage.local.set({ [slot]: record });
  return { success: true, key, ...record };
}

/* The listing queue. Add queues the product's listing 3 minutes ahead (the undo window: a product removed in that time
   never costs a request), and the ai-queue alarm writes at most one a minute, so ten adds never meet a busy key. The
   queue lives in storage.local, so it survives the worker stopping and the browser restarting.
   aiQueue: [{ itemId, sheetId, product, notBefore, tries, error, failed? }] */

const QUEUE_DELAY = 3 * 60000;
const QUEUE_TRIES = 5;

// One change of the queue at a time: `change` gets the list and returns the new one.
let aiQueueLine = Promise.resolve();
function editAiQueue(change) {
  const run = aiQueueLine.then(async () => {
    const { aiQueue } = await chrome.storage.local.get({ aiQueue: [] });
    await chrome.storage.local.set({ aiQueue: change(aiQueue) });
  });
  aiQueueLine = run.catch(() => {});
  return run;
}

// `product` as generateListing takes it. A product with no AliExpress link has nowhere to keep a listing: not queued.
async function queueListing(sheetId, product) {
  const itemId = itemIdOf(product?.link);
  if (!itemId) return;
  const job = { itemId, sheetId, product, notBefore: Date.now() + QUEUE_DELAY, tries: 0, error: "" };
  await editAiQueue((q) => [...q.filter((j) => j.itemId !== itemId), job]);
}

// Remove: the queued job and the listing go.
async function dropListing(itemId) {
  if (!itemId) return;
  await editAiQueue((q) => q.filter((j) => j.itemId !== itemId));
  await chrome.storage.local.remove(`listing:${itemId}`);
}

// Writes the first due job's listing. A rate or quota error waits until the key is back; any other error waits two
// minutes; the fifth failure marks the job failed (the dashboard's button then writes it). With no AI key nothing runs.
// A key problem only settings can fix (KEY_FIXES) uses no try: the job stops until the keys change.
// One run at a time: a call while one runs gets that run (the eBay panel's Write now waits on it).
const KEY_FIXES = ["nokey", "invalid-key", "bad-model"];
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes.aiKeys) editAiQueue((q) => q.map((j) => (j.failed && KEY_FIXES.includes(j.error) ? { ...j, failed: false, notBefore: Date.now() } : j)));
});
let aiQueueRun = null;
function runAiQueue() {
  return (aiQueueRun ??= runDueJob().finally(() => (aiQueueRun = null)));
}
async function runDueJob() {
  const now = Date.now();
  const { aiQueue } = await chrome.storage.local.get({ aiQueue: [] });
  const job = aiQueue.find((j) => !j.failed && j.notBefore <= now);
  if (!job || !(await aiPool()).length) return;
  try {
    await generateListing({ sheetId: job.sheetId, product: job.product });
    await editAiQueue((q) => q.filter((j) => j.itemId !== job.itemId));
  } catch (error) {
    const keys = KEY_FIXES.includes(error.code);
    const tries = job.tries + (keys ? 0 : 1);
    const notBefore = error.retryAt > now ? error.retryAt : now + 2 * 60000;
    await editAiQueue((q) => q.map((j) => (j.itemId === job.itemId ? { ...j, tries, error: error.code ?? "", provider: error.provider ?? "", notBefore, ...((keys || tries >= QUEUE_TRIES) && { failed: true }) } : j)));
  }
}

// Listings were filed under listing:<sheetId>:<SKU or item number> before; each moves once to its item number. One
// with no link and no item number for a key can't be placed and is dropped (its product's button writes it again).
async function migrateListings() {
  const all = await chrome.storage.local.get(null);
  const moved = {};
  const old = [];
  for (const [k, record] of Object.entries(all)) {
    const m = /^listing:[^:]+:(.+)$/.exec(k);
    if (!m) continue;
    old.push(k);
    const id = itemIdOf(record?.product?.link) || (/^\d{6,}$/.test(m[1]) ? m[1] : "");
    if (id && !all[`listing:${id}`] && !moved[`listing:${id}`]) moved[`listing:${id}`] = record;
  }
  if (!old.length) return;
  await chrome.storage.local.set(moved);
  await chrome.storage.local.remove(old);
}
chrome.runtime.onInstalled?.addListener(({ reason }) => reason === "update" && migrateListings());

// Keeps the seller's edits to a listing's title and description (the dialog's two editable fields).
// { sheetId, key, title?, description? } -> { success, listing }. The title is cut to 80 characters.
async function saveListing({ sheetId, key, title, description } = {}) {
  if (sheetId !== LOCAL) await sheetById(sheetId);
  const slot = `listing:${text(key).slice(0, 40)}`;
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
      const { mapping } = validateAiMapping((await callAi({ ...aiRequest(tabs), task: "map" })).answer, tabs);
      if (!Object.keys(mapping.inv.fields).length) throw importError("bad-output", "Nothing usable in the answer.");
      ai = mapping;
    } catch (error) {
      reason = AI_CODES.includes(error.code) ? error.code : "bad-output";
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

// A message from eBay's other listing pages (/sl/...: the start page, the confirmation after publishing). Only to say that
// the picked product was published; nothing else answers them.
function onSellFlow(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && Object.values(REGIONS).some((r) => r.ebay === u.hostname) && u.pathname.startsWith("/sl/");
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
  if (!id) throw new Error("This product has no AliExpress link to list it under.");
  const p = product && typeof product === "object" ? product : {};
  const region = REGIONS[sheet?.region] ? sheet.region : regionForCurrency(text(p.currency));
  const currency = REGIONS[sheet?.region] ? REGIONS[sheet.region].currency : text(p.currency);
  const price = num(p.salePrice) > 0 && currency === REGIONS[region].currency ? num(p.salePrice) : null;
  const ebayTarget = { sheetId, key: id, sku: text(p.sku).slice(0, 50), title: text(p.title).slice(0, 200), price, region, link: text(p.link).slice(0, 2000), image: httpsUrl(p.image), at: Date.now() };
  await chrome.storage.local.set({ ebayTarget });
  return region;
}

// A product that is Not Listed becomes a Draft when it is sent to eBay. Best effort: a sheet with no Status column (or a
// shared status) keeps the status it has.
async function markDraft(sheetId, product, status) {
  if (status && status !== "Not Listed") return;
  try {
    await setStatus(sheetId, { sku: product?.sku, link: product?.link, title: product?.title }, "Draft");
  } catch {
    // see above
  }
}

// The dashboard's "List on eBay": picks the product, then opens eBay's listing start page for its marketplace.
// The listing was written by the queue; the panel on eBay's form fills it when the seller presses Fill form.
async function listOnEbay({ sheetId, key, product, status } = {}) {
  const region = await pickTarget(sheetId, key, product);
  await markDraft(sheetId, product, status);
  await chrome.tabs.create({ url: `https://${REGIONS[region].ebay}/sl/prelist/suggest` });
  return { success: true, region };
}

// The picked product and its saved listing, or {} when none was picked or its listing is gone.
async function ebayPick() {
  const { ebayTarget: target } = await chrome.storage.local.get({ ebayTarget: null });
  if (!target) return {};
  const slot = `listing:${target.key}`;
  return { target, listing: (await chrome.storage.local.get({ [slot]: null }))[slot]?.listing };
}

// What the panel shows and fills: { target: { sku, title, price, currency, host } | null, listing: { title, description,
// html, specifics } | null }. The description comes as plain text (to copy) and as eBay's HTML (to fill); the listing's
// own item specifics are what the panel offers to copy when the AI step fails. With no listing yet, `queued` says where
// its job stands: { at (when it runs), failed, code }, or null when nothing is queued.
async function ebayContext(fresh = true) {
  const { target, listing } = await ebayPick();
  if (!target) return { success: true, target: null, listing: null };
  const region = REGIONS[target.region] ?? REGIONS.UK;
  const job = listing ? null : (await chrome.storage.local.get({ aiQueue: [] })).aiQueue.find((j) => j.itemId === target.key);
  // The price picked is a copy; the sheet's price now wins (and the picked price stays blank when it was in another currency).
  const price = target.price == null || !fresh ? target.price : (await ebayProductList(target))[0]?.price ?? target.price;
  return {
    success: true,
    target: { sku: target.sku, title: target.title, price: price == null ? "" : price.toFixed(2), currency: region.currency, host: region.ebay },
    listing: listing ? { title: listing.title, description: listing.description, html: toEbayHtml(listing.description), specifics: listing.itemSpecifics ?? [] } : null,
    ...(!listing && { queued: job ? { at: job.notBefore, failed: Boolean(job.failed), code: job.error ?? "" } : null }),
  };
}

// The cards the panel offers, newest first, as { sheetId, key, sku, title, price, currency, state, product }: every product
// with a kept listing (state "ready") or a queued one ("queued", or "failed" after its last try). All from storage, no
// sheet read: a listing names its sheet since it is written, an older one is found in the sheets' indexes or the library,
// and the SKU comes from the index (a formula SKU is read back there). A product whose sheet is gone is left out, and so
// is one whose status is not Draft. `only` ({ sheetId, key }) answers that one card whatever its status, reading one sheet.
// ponytail: reads all of storage.local to find the listing:* keys; chrome.storage.local.getKeys once Chrome 130 is the minimum.
async function ebayProductList(only) {
  const [{ sheets }, all] = await Promise.all([chrome.storage.sync.get({ sheets: [] }), chrome.storage.local.get(null)]);
  const index = (sheetId, itemId) => all[`index:${sheetId}`]?.items?.[itemId];
  const inLibrary = (itemId) => (all.library ?? []).some((x) => x.status !== "Discontinued" && itemIdOf(x.link) === itemId);
  const known = (sheetId) => sheetId === LOCAL || sheets.some((s) => s.id === sheetId);
  const cards = new Map();
  const add = (itemId, record, job) => {
    if (cards.has(itemId)) return;
    const p = record?.product ?? job?.product ?? {};
    let sheetId = record?.sheetId ?? job?.sheetId;
    if (!known(sheetId)) sheetId = sheets.find((s) => index(s.id, itemId))?.id ?? (inLibrary(itemId) ? LOCAL : null);
    if (!sheetId) return;
    const region = sheets.find((s) => s.id === sheetId)?.region;
    const currency = REGIONS[region]?.currency ?? text(p.currency);
    const sku = text(index(sheetId, itemId)?.sku) || text(p.sku);
    const state = record ? "ready" : job.failed ? "failed" : "queued";
    cards.set(itemId, { sheetId, key: itemId, sku: sku || itemId, title: text(p.title) || text(record?.listing?.title), price: num(p.salePrice) > 0 ? num(p.salePrice) : null, currency, state, at: record?.createdAt ?? job?.notBefore ?? 0, product: { ...p, sku, currency } });
  };
  for (const [k, record] of Object.entries(all)) {
    const m = /^listing:(\d{6,})$/.exec(k);
    if (m && record?.listing) add(m[1], record);
  }
  for (const job of all.aiQueue ?? []) if (job?.itemId) add(job.itemId, null, job);
  const list = [...cards.values()].filter((c) => !only || c.sheetId === only.sheetId);
  await freshRows(list, all.library, only ? [only.sheetId] : sheets.map((s) => s.id));
  if (only) return list.filter((c) => c.key === only.key);
  return list.filter((c) => c.status === undefined || c.status === "Draft").sort((a, b) => b.at - a.at).slice(0, 200);
}

// A listing keeps the sell price it was written with; the seller may have changed it in the sheet since. So the cards take
// the price and status the sheet (one read per sheet) or the library holds now. A sheet that can't be read keeps the old
// price, and its cards and those of a sheet with no Status column keep status undefined (offered whatever they are).
// A variant group's status is one merged cell: its first row holds it, so the first row of a link wins.
// The SKU is the sheet's too (a listing keeps the SKU it was saved with, which a formula SKU column may not show), and
// a Draft row of `sheetIds` with no listing or job yet is added as a card (state "none") so the panel offers every draft.
async function freshRows(list, library = [], sheetIds = []) {
  const set = (card, row) => {
    if (row?.salePrice > 0) {
      card.price = row.salePrice;
      card.product.salePrice = row.salePrice;
    }
    if (row?.sku) card.sku = card.product.sku = row.sku;
    if (row) card.status = row.status;
  };
  const byLink = (rows) => {
    const m = new Map();
    for (const r of rows) if (!m.has(itemIdOf(r.link))) m.set(itemIdOf(r.link), r);
    return m;
  };
  for (const sheetId of new Set([...list.map((c) => c.sheetId), ...sheetIds])) {
    const cards = list.filter((c) => c.sheetId === sheetId);
    if (sheetId === LOCAL) {
      const byId = byLink(libToProducts(library).map((p) => ({ ...p, status: p.status || "Not Listed" })));
      for (const c of cards) set(c, byId.get(c.key) ?? { status: "Not Listed" });
      continue;
    }
    try {
      const sheet = await sheetById(sheetId);
      if (!sheet.salePriceCol && !sheet.statusCol && !sheet.skuCol) continue;
      const cols = { link: sheet.linkCol, salePrice: sheet.salePriceCol, status: sheet.statusCol, sku: sheet.skuCol, title: sheet.keywordsCol, image: sheet.imageCol };
      const c = await readFields(sheet.id, sheet.sheetTab, cols, sheet.startRow);
      const byId = byLink(c.link.map((link, i) => ({
        link, salePrice: num(c.salePrice[i]), status: sheet.statusCol ? text(c.status[i]) || "Not Listed" : undefined,
        sku: text(c.sku[i]), title: text(c.title[i]), image: text(c.image[i]),
      })));
      for (const card of cards) set(card, byId.get(card.key) ?? (sheet.statusCol ? { status: "Not Listed" } : null));
      const currency = REGIONS[sheet.region]?.currency ?? "";
      for (const [key, r] of byId) {
        if (!key || r.status !== "Draft" || cards.some((x) => x.key === key)) continue;
        const product = { sku: r.sku, title: r.title, link: r.link, salePrice: r.salePrice || null, image: httpsUrl(r.image), currency };
        list.push({ sheetId, key, sku: r.sku || key, title: r.title, price: r.salePrice > 0 ? r.salePrice : null, currency, state: "none", at: 0, status: "Draft", product });
      }
    } catch {
      // the stored price stands and the card is offered
    }
  }
}

// The panel's "Write now": the picked product's job goes to the front of the queue (queued now when there is none) and
// runs at once, after any write in flight. Answers once the listing is kept; else fails with the job's code, and for a
// busy or spent key the time it runs again. Written from the target the panel is on, never from what the page says.
async function ebayWriteNow() {
  const { target, listing } = await ebayPick();
  if (!target) throw new Error("Choose a product first.");
  if (listing) return { success: true };
  if (!(await aiPool()).length) throw aiError("nokey", "Add an AI key in the AI tab.");
  const region = REGIONS[target.region] ?? REGIONS.UK;
  const product = { sku: target.sku, title: target.title, link: target.link, image: target.image, salePrice: target.price, currency: region.currency };
  const itemId = target.key;
  await editAiQueue((q) => {
    const job = q.find((j) => j.itemId === itemId) ?? { itemId, sheetId: target.sheetId, product, tries: 0 };
    return [{ ...job, notBefore: 0, failed: false, error: "" }, ...q.filter((j) => j.itemId !== itemId)];
  });
  await aiQueueRun; // a write already running (maybe this one) finishes first
  if (!(await ebayPick()).listing) await runAiQueue();
  if ((await ebayPick()).listing) return { success: true };
  const job = (await chrome.storage.local.get({ aiQueue: [] })).aiQueue.find((j) => j.itemId === itemId);
  const waits = ["rate", "quota"].includes(job?.error) && job.notBefore > Date.now();
  throw aiError(job?.error || undefined, "The listing couldn't be written.", { ...(job?.provider && { provider: job.provider }), ...(waits && { retryAt: job.notBefore }) });
}

// The seller published the listing: the picked product becomes Listed, once. { manual } is the panel's own button, the
// other is the confirmation page of eBay, whose text the panel checked against the product's SKU or title.
async function ebayListed() {
  const { ebayTarget: target } = await chrome.storage.local.get({ ebayTarget: null });
  if (!target) throw new Error("No product is picked.");
  if (target.listed) return { success: true, already: true };
  await setStatus(target.sheetId, { sku: target.sku, link: target.link, title: target.title }, "Listed");
  await chrome.storage.local.set({ ebayTarget: { ...target, listed: true } });
  return { success: true };
}

// { products: [{ sheetId, key, sku, title, price, currency, state }], current: { sheetId, key } | null } for the panel's cards.
async function ebayProducts() {
  const { target } = await ebayPick();
  return {
    success: true,
    current: target ? { sheetId: target.sheetId, key: target.key } : null,
    products: (await ebayProductList()).map(({ product, at, status, ...card }) => card),
  };
}

// The card the seller clicked becomes the panel's product, and the answer is its context (as ebayContext). The panel
// names only the card (sheet and key): what is filled into the form, the price included, comes from this list and never
// from the page.
async function ebaySelect({ sheetId, key } = {}) {
  const [card] = await ebayProductList({ sheetId, key });
  if (!card) throw new Error("That product's listing is gone. Add it from its AliExpress page again.");
  await pickTarget(card.sheetId, card.key, card.product);
  return ebayContext(false); // the card's price was just read
}

// The AI matches the form's empty item specifics to the saved listing, after directFillPlan took the ones the listing
// names itself. { fields, category } from the panel (cleaned here) -> { success, answers: [{ name, value }] } of checked
// answers only. A failed reply has the AI's `code`; when the direct answers stand alone, `aiError` says why.
async function planFill({ fields, category } = {}) {
  const { target, listing } = await ebayPick();
  if (!listing) throw new Error("Choose a product on the dashboard first.");
  const list = cleanFields(fields);
  if (!list.some(askable)) return { success: true, answers: [] };

  const direct = directFillPlan(list, listing);
  const matched = new Set(direct.map((a) => a.name));
  const remaining = list.filter((f) => !matched.has(f.name));
  if (!remaining.some(askable)) return { success: true, answers: direct };

  const stop = keepAlive();
  let raw;
  try {
    ({ answer: raw } = await callAi({ ...buildFillRequest(remaining, target, listing, category), task: "fill", timeoutMs: 60000 }));
  } catch (error) {
    if (!direct.length) throw error;
    const { code, provider, retryAt } = fail(error);
    return { success: true, answers: direct, aiError: { code, provider, retryAt } };
  } finally {
    stop();
  }
  const aiAnswers = validateFillPlan(raw, remaining);
  return { success: true, answers: [...direct, ...aiAnswers] };
}

// The panel can't open extension pages itself.
const PAGES = { dashboard: "dashboard/dashboard.html", settings: "options/options.html#ai" };
async function openPage(page) {
  if (!Object.hasOwn(PAGES, page)) throw new Error("Unknown page.");
  await chrome.tabs.create({ url: chrome.runtime.getURL(PAGES[page]) });
  return { success: true };
}
