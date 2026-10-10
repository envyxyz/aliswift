importScripts("lib/shared.js", "lib/template.js");

// Every handler resolves to { success: true, ... } or { success: false, error }. pagesOnly handlers
// reject anything but AliSwift's own pages: a content script's sender.url is the web page it runs on.
const handlers = {
  appendToSheet: { run: (request) => appendRow(request.data) },
  createSheet: { pagesOnly: true, run: (request) => createSheet(request.data) },
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!Object.hasOwn(handlers, request?.action)) return;
  const handler = handlers[request.action];
  if (handler.pagesOnly && !sender.url?.startsWith(chrome.runtime.getURL(""))) {
    sendResponse({ success: false, error: "Not allowed." });
    return;
  }
  Promise.resolve()
    .then(() => handler.run(request))
    .catch((error) => ({ success: false, error: error.message }))
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

function getToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError ?? new Error("Google sign-in failed."));
      } else {
        resolve(token);
      }
    });
  });
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
    const { title, price, salePrice, link } = data;
    const sheet = await getActiveSheet();
    if (!sheet) throw new Error("No sheet yet. Add one in AliSwift settings.");

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
    return { success: false, error: error.message };
  }
}
