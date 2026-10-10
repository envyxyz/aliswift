importScripts("lib/shared.js");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== "appendToSheet") return;
  appendRow(request.data).then(sendResponse);
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

// Calls the Sheets API. A 401 means the cached token is stale or revoked:
// drop it and retry once with a fresh one.
async function sheetsFetch(path, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const token = await getToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
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

async function writeRow(data) {
  try {
    const { title, price, salePrice, link } = data;
    const sheet = await getActiveSheet();
    if (!sheet) throw new Error("No sheet yet. Add one in AliSwift settings.");

    const tab = `'${sheet.sheetTab.replace(/'/g, "''")}'`;
    // Empty values are skipped so we never blank out a cell the user filled in.
    const cells = [
      [sheet.keywordsCol, title],
      [sheet.priceCol, toNumber(price)],
      [sheet.salePriceCol, toNumber(salePrice)],
      [sheet.linkCol, link],
    ].filter(([, value]) => value !== "");

    // Next row = one below the last non-empty keyword, but never above startRow.
    const range = encodeURIComponent(`${tab}!${sheet.keywordsCol}:${sheet.keywordsCol}`);
    const { values = [] } = await sheetsFetch(`${sheet.id}/values/${range}`);
    const last = values.findLastIndex((r) => String(r[0] ?? "").trim());
    const row = Math.max(last + 2, sheet.startRow);

    // RAW: text is stored as text, so a title like "=IMPORTDATA(...)" can't run as a formula.
    await sheetsFetch(`${sheet.id}/values:batchUpdate`, {
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
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
