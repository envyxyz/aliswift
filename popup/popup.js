const $ = (id) => document.getElementById(id);
const PRODUCT_URL = /^https:\/\/([\w-]+\.)?aliexpress\.(com|us)\/(item\/|.*\/buyNow)/;

let tabId;
let resetTimer;

function show(view, message = "") {
  $("setup").hidden = view !== "setup";
  $("form").hidden = view !== "form";
  $("notice").hidden = view !== "notice";
  $("notice").textContent = message;
}

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

function setButton(state, text) {
  $("addBtn").dataset.state = state;
  $("addBtn").textContent = text;
  $("addBtn").disabled = state === "loading" || state === "disabled";
}

// The page may still be rendering, so ask a few times. Settle for a row with
// only a title so the user can type the price themselves.
async function scrape() {
  let partial = null;
  for (let i = 0; i < 5; i++) {
    const row = await chrome.tabs.sendMessage(tabId, { action: "scrape" }).catch(() => null);
    if (row?.title && row.price) return row;
    partial = row?.title ? row : partial;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return partial;
}

async function loadProduct() {
  show("form");
  setButton("disabled", "Add to Sheet");
  setStatus("Reading product...");
  const row = await scrape();
  if (!row) return show("notice", "Couldn't read this page. Refresh it and try again.");
  $("title").value = row.title;
  $("price").value = row.price;
  $("salePrice").value = row.salePrice;
  $("link").value = row.link;
  setStatus("");
  setButton("", "Add to Sheet");
}

async function init() {
  const { sheets, activeSheetId } = await chrome.storage.sync.get({
    sheets: [],
    activeSheetId: "",
  });
  if (!sheets.length) return show("setup");

  $("sheet").replaceChildren(
    ...sheets.map((s) => new Option(s.name, s.id, false, s.id === (activeSheetId || sheets[0].id))),
  );

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!PRODUCT_URL.test(tab?.url ?? "")) {
    return show("notice", "Open an AliExpress product page, then click the AliSwift icon.");
  }
  tabId = tab.id;
  await loadProduct();
}

$("settingsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("setupBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());

// Each sheet has its own pricing rules, so a different sheet means a new price.
$("sheet").addEventListener("change", async () => {
  await chrome.storage.sync.set({ activeSheetId: $("sheet").value });
  await loadProduct();
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearTimeout(resetTimer);
  setStatus("");
  setButton("loading", "Adding...");
  const result = await chrome.runtime
    .sendMessage({
      action: "appendToSheet",
      data: {
        title: $("title").value,
        price: $("price").value,
        salePrice: $("salePrice").value,
        link: $("link").value,
      },
    })
    .catch((err) => ({ error: err.message }));

  if (result?.success) {
    setButton("success", result.sku ? `Added as ${result.sku}` : "Added");
  } else {
    setButton("", "Add to Sheet");
    setStatus(result?.error ?? "Something went wrong.", true);
    return;
  }
  resetTimer = setTimeout(() => setButton("", "Add to Sheet"), 3000); // long enough to read the SKU
});

init();
