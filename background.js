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
      sheetId: "",
      keywordsCol: "A",
      priceCol: "B",
      linkCol: "C",
      startRow: "2"
    });

    const range = `Sheet1!${settings.keywordsCol}${settings.startRow}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${settings.sheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
body: JSON.stringify({
  values: [[data.title, data.price, data.salePrice, data.link]]
})
    });

    if (!response.ok) throw new Error(`Sheets API error: ${response.status}`);
    return { success: true };

  } catch (error) {
    return { success: false, error: error.message };
  }
}