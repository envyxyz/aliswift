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

    const settings = await chrome.storage.sync.get({
      sheets: [],
      activeSheetId: "",
      keywordsCol: "A",
      priceCol: "B",
      salePriceCol: "C",
      linkCol: "D",
      startRow: "2"
    });

    const sheetId = settings.activeSheetId;
    if (!sheetId) throw new Error("No sheet configured. Please add a sheet in settings.");

    const colMap = {
      [settings.keywordsCol]: data.title,
      [settings.priceCol]: data.price,
      [settings.salePriceCol]: data.salePrice,
      [settings.linkCol]: data.link
    };

    const sortedCols = Object.keys(colMap).sort();
    const values = [sortedCols.map(col => colMap[col])];
    const range = `Sheet1!${sortedCols[0]}${settings.startRow}`;

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ values })
    });

    if (!response.ok) throw new Error(`Sheets API error: ${response.status}`);
    return { success: true };

  } catch (error) {
    return { success: false, error: error.message };
  }
}