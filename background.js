chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "appendToSheet") {
    handleAppend(request.data).then(sendResponse);
    return true;
  }
});

async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(token);
      }
    });
  });
}

async function handleAppend(data) {
  try {
    const token = await getAuthToken();

    const storage = await chrome.storage.sync.get({
      sheets: [],
      activeSheetId: "",
    });
    const activeSheet = storage.sheets.find(
      (s) => s.id === storage.activeSheetId,
    );
    if (!activeSheet)
      throw new Error("No sheet configured. Please add a sheet in settings.");

    const settings = {
      keywordsCol: activeSheet.keywordsCol || "B",
      priceCol: activeSheet.priceCol || "D",
      salePriceCol: activeSheet.salePriceCol || "E",
      linkCol: activeSheet.linkCol || "C",
      sheetTab: activeSheet.sheetTab || "Sheet1",
      startRow: parseInt(activeSheet.startRow) || 2,
    };
    const sheetId = activeSheet.id;

    const colMap = {
      [settings.keywordsCol]: data.title,
      [settings.priceCol]: data.price,
      [settings.salePriceCol]: data.salePrice,
      [settings.linkCol]: data.link,
    };

    const sortedCols = Object.keys(colMap).sort();
    const values = [sortedCols.map((col) => colMap[col])];
    const sheetTab = settings.sheetTab;

    // Use keywordsCol (not hardcoded B) to find the next empty row.
    const scanCol = settings.keywordsCol;
    const findRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetTab)}!${scanCol}:${scanCol}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!findRes.ok) throw new Error(`Sheets API error: ${findRes.status}`);
    const findData = await findRes.json();
    const rows = findData.values || [];

    // Start scanning from startRow - 1 (0-indexed) so we never write above the header.
    let nextRow = settings.startRow;
    for (let i = rows.length - 1; i >= settings.startRow - 1; i--) {
      if (rows[i] && rows[i][0] && rows[i][0].toString().trim() !== "") {
        nextRow = i + 2;
        break;
      }
    }

    const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`;
    const response = await fetch(batchUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: sortedCols.map((col, i) => ({
          range: `${sheetTab}!${col}${nextRow}`,
          values: [[values[0][i]]],
        })),
      }),
    });

    if (!response.ok) throw new Error(`Sheets API error: ${response.status}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
