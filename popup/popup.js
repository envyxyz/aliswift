const $ = (id) => document.getElementById(id);
const PRODUCT_URL = /^https:\/\/([\w-]+\.)?aliexpress\.(com|us)\/(item\/|.*\/buyNow)/;
// Saving goes to the active sheet, or to the on-device library when signed out or without a sheet.
const WORDS = { sheet: { idle: "Add to Sheet", busy: "Adding..." }, local: { idle: "Save to library", busy: "Saving..." } };

let tabId;
let resetTimer;
let row; // the product the page button would save: see scrapeRow in content.js
let sheet; // the active sheet's settings, to price a rate typed here
let editing = false; // the rate box is open
let typed = false; // the rate was typed here and is saved when the product is added
let rateBad = false; // what was typed is not a rate AliSwift accepts (see validRate)
let signedIn = true; // false only when the account button knows the user is signed out
let dest = "sheet"; // "sheet" or "local", see destination()
const idle = () => WORDS[dest].idle;

function show(view, message = "") {
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
    ? rateBad
      ? RATE_MESSAGE
      : `No ${fx.from} to ${fx.to} rate found. Enter one to continue.`
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
    const how = fx.source === "typed" ? `your rate (${day})` : "sheet rate";
    const text = `Converted from ${fx.from} ${amount(fx.price + fx.shipping)} at 1 ${fx.to} = ${Number(fx.rate.toPrecision(6))} ${fx.from}, ${how}`;
    const change = Object.assign(document.createElement("button"), { type: "button", className: "link-btn", textContent: "Change" });
    change.addEventListener("click", () => {
      editing = true;
      $("rate").value = String(Number(fx.rate.toPrecision(6)));
      renderCurrency();
      $("rate").focus();
    });
    $("fxNote").replaceChildren(text, ...(fx.source === "typed" && !editing ? [" ", change] : []));
  }

  $("rateRow").hidden = kind !== "convert" || !(editing || noRate());
  $("rate").setAttribute("aria-invalid", String(rateBad));
  $("rateTo").textContent = fx?.to ?? "";
  $("rateUnit").textContent = fx?.from ?? "";
}

async function loadProduct() {
  show("form");
  setButton("disabled", idle());
  setStatus("Reading product...");
  const found = await scrape();
  if (!found) return show("notice", "Couldn't read this page. Refresh it and try again.");
  row = found;
  sheet = (await getActiveSheet()) ?? SHEET_DEFAULTS;
  editing = typed = rateBad = false;
  $("rate").value = "";
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

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!PRODUCT_URL.test(tab?.url ?? "")) {
    return show("notice", "Open an AliExpress product page, then click the AliSwift icon.");
  }
  tabId = tab.id;
  await loadProduct();
}

$("settingsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
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

// A rate typed here prices the product again, in the sheet's currency, as the page button would. A rate the
// service worker would refuse (validRate) counts as no rate, with the reason shown, so nothing is saved on it.
$("rate").addEventListener("input", () => {
  const text = $("rate").value.trim();
  const rate = /^\d+([.,]\d+)?$/.test(text) ? Number(text.replace(",", ".")) : 0;
  const { fx } = row;
  editing = typed = true;
  rateBad = text !== "" && !validRate(rate);
  fx.rate = validRate(rate) ? rate : null;
  fx.source = "typed";
  fx.at = Date.now();
  if (fx.rate) {
    Object.assign(row, priceProduct(fx.price / rate, fx.shipping / rate, sheet), { currency: fx.to });
  } else {
    Object.assign(row, { price: (fx.price + fx.shipping).toFixed(2), salePrice: "", currency: fx.from });
  }
  renderPrices();
  renderCurrency();
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearTimeout(resetTimer);
  setStatus("");
  setButton("loading", WORDS[dest].busy);
  const { fx } = row;
  if (typed && fx?.rate) {
    await chrome.runtime.sendMessage({ action: "setRate", data: { from: fx.from, to: fx.to, rate: fx.rate } }).catch(() => {});
  }
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
