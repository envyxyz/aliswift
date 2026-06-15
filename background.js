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
      startRow: "2",
    });

    const sheetId = settings.activeSheetId;
    if (!sheetId)
      throw new Error("No sheet configured. Please add a sheet in settings.");

    const colMap = {
      [settings.keywordsCol]: data.title,
      [settings.priceCol]: data.price,
      [settings.salePriceCol]: data.salePrice,
      [settings.linkCol]: data.link,
    };

    const sortedCols = Object.keys(colMap).sort();
    const values = [sortedCols.map((col) => colMap[col])];
    const sheetTab = "Inventory";
    const findRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetTab}!A:A`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const findData = await findRes.json();
    const nextRow = (findData.values?.length ?? 1) + 1;
    const range = `${sheetTab}!${sortedCols[0]}${nextRow}:${sortedCols[sortedCols.length - 1]}${nextRow}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=USER_ENTERED`;
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    });

    if (!response.ok) throw new Error(`Sheets API error: ${response.status}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
