chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "appendToSheet") {
    handleAppend(request.data).then(sendResponse);
    return true;
  }
});

async function getAuthToken() {
  const clientId =
    "969152943077-1qkbqj3sdfoehcuqog2bns9mt5a24l0q.apps.googleusercontent.com";
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const scope = "https://www.googleapis.com/auth/spreadsheets";
  const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scope)}`;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      (redirectUrl) => {
        if (chrome.runtime.lastError || !redirectUrl) {
          reject(chrome.runtime.lastError || new Error("Auth failed"));
          return;
        }
        const match = redirectUrl.match(/access_token=([^&]+)/);
        if (match) {
          resolve(match[1]);
        } else {
          reject(new Error("No token in redirect"));
        }
      },
    );
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
      sheetTab: activeSheet.sheetTab || "Inventory",
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
    const findRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetTab}!B:B`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const findData = await findRes.json();
    const rows = findData.values || [];
    let nextRow = 3;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i][0] && rows[i][0].toString().trim() !== "") {
        nextRow = i + 2;
        break;
      }
    }
    console.log(
      "nextRow:",
      nextRow,
      "sortedCols:",
      sortedCols,
      "values:",
      JSON.stringify(values),
    );
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
