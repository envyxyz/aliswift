importScripts("lib/shared.js", "lib/template.js");

// Every handler resolves to { success: true, ... } or { success: false, error }. pagesOnly handlers
// reject anything but AliSwift's own pages: a content script's sender.url is the web page it runs on.
const handlers = {
  appendToSheet: { run: (request) => appendRow(request.data) },
  createSheet: { pagesOnly: true, run: (request) => createSheet(request.data) },
  authState: { run: () => authState() },
  signIn: { pagesOnly: true, run: () => signIn() },
  signOut: { pagesOnly: true, run: () => signOut() },
  rate: { run: (request) => getRate(request.data) },
  setRate: { pagesOnly: true, run: (request) => setRate(request.data) },
};

// A failed reply keeps the error's code ("signin", "currency") so a page can tell what to offer.
const fail = (error) => ({ success: false, error: error.message, ...(error.code && { code: error.code }) });

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

// One add at a time: two adds racing would pick the same next row.
let queue = Promise.resolve();
function appendRow(data) {
  const run = queue.then(() => writeRow(data));
  queue = run;
  return run;
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

// Calls the Sheets API; path starts with "/" (or is empty for spreadsheets.create).
// A 401 means the cached token is stale or revoked: drop it and retry once with a fresh one.
async function sheetsFetch(path, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const token = await getToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && attempt === 0) {
      await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
      continue;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message ?? `Google Sheets error ${res.status}`);
    }
    return res.json();
  }
}

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

async function writeRow(data) {
  try {
    const { title, price, salePrice, link, currency } = data;
    const sheet = await getActiveSheet();
    if (!sheet) throw new Error("No sheet yet. Add one in AliSwift settings.");

    // The one place every save passes: prices in another currency than the sheet's never get written.
    // `currency` is what the numbers are in. Unknown on either side (no marketplace set) means nothing to compare.
    const sheetCurrency = REGIONS[sheet.region]?.currency;
    if (currency && sheetCurrency && currency !== sheetCurrency) {
      throw Object.assign(new Error(`Prices are in ${currency} but this sheet is ${sheetCurrency}. Nothing was saved.`), { code: "currency" });
    }

    const tab = `'${sheet.sheetTab.replace(/'/g, "''")}'`;

    // The next row and the SKU come from one read of the SKU and keywords columns.
    const read = [sheet.skuCol, sheet.keywordsCol].filter(Boolean);
    const ranges = read.map((c) => `ranges=${encodeURIComponent(`${tab}!${c}:${c}`)}`).join("&");
    const { valueRanges = [] } = await sheetsFetch(`/${sheet.id}/values:batchGet?${ranges}`);
    const column = (c) => valueRanges[read.indexOf(c)]?.values ?? [];
    const row = nextRow(column(sheet.skuCol), column(sheet.keywordsCol), sheet.startRow);
    const sku = sheet.skuCol
      ? nextSku(column(sheet.skuCol).map((r) => r[0]), sheet.skuPrefix, row, sheet.startRow)
      : "";

    // Empty values are skipped so we never blank out a cell the user filled in.
    // ponytail: auto sheets have 1000 rows; past that Google's error is shown. Upgrade: appendDimension, then repeatCell.
    const cells = [
      [sheet.keywordsCol, title],
      [sheet.priceCol, toNumber(price)],
      [sheet.salePriceCol, toNumber(salePrice)],
      [sheet.linkCol, link],
      [sheet.skuCol, sku],
    ].filter(([col, value]) => col && value !== "");

    // RAW: text is stored as text, so a title like "=IMPORTDATA(...)" can't run as a formula.
    await sheetsFetch(`/${sheet.id}/values:batchUpdate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: cells.map(([col, value]) => ({
          range: `${tab}!${col}${row}`,
          values: [[value]],
        })),
      }),
    });
    return { success: true, ...(sku && { sku }) };
  } catch (error) {
    return fail(error);
  }
}
