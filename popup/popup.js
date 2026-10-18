const $ = (id) => document.getElementById(id);
const PRODUCT_URL = /^https:\/\/([\w-]+\.)?aliexpress\.(com|us)\/(item\/|.*\/buyNow)/;
const ON_ALIEXPRESS = /^https:\/\/([\w-]+\.)*aliexpress\./;
// Saving goes to the active sheet, or to the on-device library when signed out or without a sheet.
const WORDS = { sheet: { idle: "Add to Sheet", busy: "Adding..." }, local: { idle: "Save to library", busy: "Saving..." } };

let tabId;
let resetTimer;
let row; // the product the page button would save: see scrapeRow in content.js
let signedIn = true; // false only when the account button knows the user is signed out
let dest = "sheet"; // "sheet" or "local", see destination()
let ebayHost;
const idle = () => WORDS[dest].idle;

function show(view, message = "") {
  $("launch").hidden = view !== "launch";
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
    const found = await chrome.tabs.sendMessage(tabId, { action: "scrape", dest }).catch(() => null);
    if (found?.title && found.price) return found;
    partial = found?.title ? found : partial;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return partial;
}

const amount = (n) => n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const noRate = () => row.kind === "convert" && !(row.fx.rate > 0);

// The price fields, their currency labels and the Add button. With no rate they show the page's own
// amounts, read-only, and nothing can be added.
function renderPrices() {
  $("price").value = row.price;
  $("salePrice").value = row.salePrice;
  $("price").readOnly = $("salePrice").readOnly = noRate();
  $("priceCur").textContent = $("saleCur").textContent = row.currency ? `(${row.currency})` : "";
  setButton(noRate() ? "disabled" : "", idle());
  if (noRate()) $("addBtn").setAttribute("aria-describedby", "fxWarn");
  else $("addBtn").removeAttribute("aria-describedby");
}

// One state at a time: no rate, marketplace not set, currency unknown, converted. Same currency shows nothing.
function renderCurrency() {
  const { kind, fx } = row;
  const rated = kind === "convert" && !noRate();
  const warn = noRate()
    ? `Couldn't get the ${fx.from} to ${fx.to} exchange rate. Check your connection and reopen this.`
    : kind === "unset" && dest === "sheet"
      ? "This sheet's marketplace isn't set, so prices are saved as shown."
      : kind === "unknown"
        ? "Couldn't tell this page's currency. Check the prices."
        : "";
  $("fxWarn").hidden = !warn;
  $("fxWarnText").textContent = warn;
  $("fxSettings").hidden = !(kind === "unset" && dest === "sheet");

  $("fxNote").hidden = !rated;
  if (rated) {
    const day = new Date(fx.at ?? Date.now()).toLocaleDateString("en", { day: "numeric", month: "short" });
    $("fxNote").textContent = `${amount(fx.price + fx.shipping)} ${fx.from} ≈ ${row.price} ${fx.to}`;
    $("fxNote").title = `1 ${fx.to} = ${Number(fx.rate.toPrecision(6))} ${fx.from}, live rate (${day}, ExchangeRate-API)`;
  }
}

async function loadProduct() {
  show("form");
  setButton("disabled", idle());
  setStatus("Reading product...");
  const found = await scrape();
  if (!found) return show("notice", "Couldn't read this page. Refresh it and try again.");
  row = found;
  $("title").value = row.title;
  $("link").value = row.link;
  renderPrices();
  renderCurrency();
  setStatus("");
}

// The destination field: the sheet picker, or a fixed line with the one action that would unlock the sheet.
function renderDest(sheets, activeSheetId) {
  $("sheet").hidden = dest === "local";
  $("dest").hidden = $("lockNote").hidden = dest === "sheet";
  $("sheet").replaceChildren(...sheets.map((s) => new Option(s.name, s.id, false, s.id === (activeSheetId || sheets[0].id))));
  $("lockAct").textContent = signedIn ? "Add a sheet" : "Sign in";
  $("lockAct").toggleAttribute("data-signin", !signedIn);
}

async function init() {
  const { sheets, activeSheetId } = await chrome.storage.sync.get({
    sheets: [],
    activeSheetId: "",
  });
  dest = destination(signedIn, sheets[0]);
  renderDest(sheets, activeSheetId);

  // The eBay links follow the active sheet's marketplace; the library has none, so eBay US.
  ebayHost = REGIONS[sheets.find((s) => s.id === activeSheetId)?.region ?? sheets[0]?.region]?.ebay ?? REGIONS.US.ebay;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";
  if (!PRODUCT_URL.test(url)) {
    show("launch");
    $("hint").hidden = !ON_ALIEXPRESS.test(url); // here the next step is a product, so say so
    return $("query").focus(); // typing can start the moment the popup opens
  }
  tabId = tab.id;
  await loadProduct();
}

$("settingsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("dashBtn").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") }));
const open = (url) => chrome.tabs.create({ url });
$("find").addEventListener("submit", (e) => {
  e.preventDefault();
  open(`https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent($("query").value.trim())}`);
});
$("hubBtn").addEventListener("click", () => open(`https://${ebayHost}/sh/ovw`));
$("listBtn").addEventListener("click", () => open(`https://${ebayHost}/sl/prelist/suggest`)); // same page as the dashboard's "List on eBay"
$("lockAct").addEventListener("click", () => signedIn && chrome.runtime.openOptionsPage()); // Sign in is the account button's job
$("fxSettings").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Each sheet has its own pricing rules, so a different sheet means a new price.
$("sheet").addEventListener("change", async () => {
  await chrome.storage.sync.set({ activeSheetId: $("sheet").value });
  await loadProduct();
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearTimeout(resetTimer);
  setStatus("");
  setButton("loading", WORDS[dest].busy);
  const result = await chrome.runtime
    .sendMessage({
      action: "appendToSheet",
      data: {
        title: $("title").value,
        price: $("price").value,
        salePrice: $("salePrice").value,
        link: $("link").value,
        currency: row.currency,
        image: row.image,
        details: row.details,
        dest,
      },
    })
    .catch((err) => ({ error: err.message }));

  if (result?.success) {
    const done = dest === "local" ? "Saved to library" : "Added";
    setButton("success", result.sku ? `${done} as ${result.sku}` : done);
  } else {
    setButton("", idle());
    // Signed out since the popup opened: setAuth(false) tells the account button too, and the form comes back
    // with the library as its destination. Signing in again fires authchange and brings the sheet back.
    if (result?.code === "signin") return setAuth(false);
    setStatus(result?.error ?? "Something went wrong.", true);
    return;
  }
  resetTimer = setTimeout(() => setButton("", idle()), 3000); // long enough to read the SKU
});

// The account button reports the sign-in state once it knows it, and again whenever it changes.
// null means it couldn't tell (offline): carry on as signed in, a save will say if sign-in is needed.
const setAuth = profileButton($("profile"));
document.addEventListener("authchange", (e) => {
  signedIn = e.detail.signedIn !== false;
  init();
});
