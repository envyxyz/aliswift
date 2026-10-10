const $ = (id) => document.getElementById(id);
const form = $("settings");
const KEYS = Object.keys(SHEET_DEFAULTS);
const COLS = ["keywordsCol", "linkCol", "priceCol", "salePriceCol"];

let sheets = [];
let activeId = "";
let statusTimer;

function flash(text, isError = false) {
  clearTimeout(statusTimer);
  $("saveStatus").textContent = text;
  $("saveStatus").classList.toggle("error", isError);
  if (!isError) statusTimer = setTimeout(() => ($("saveStatus").textContent = ""), 1500);
}

async function persist() {
  try {
    await chrome.storage.sync.set({ sheets, activeSheetId: activeId });
    flash("Saved");
  } catch (e) {
    flash(`Couldn't save: ${e.message}`, true);
  }
}

function fill(sheet) {
  for (const k of KEYS) {
    const el = form.elements[k];
    if (el.type === "checkbox") el.checked = sheet[k];
    else el.value = sheet[k];
  }
  togglePricing();
}

function read() {
  const out = {};
  for (const k of KEYS) {
    const el = form.elements[k];
    if (el.type === "checkbox") out[k] = el.checked;
    else if (el.type === "number") out[k] = el.value === "" ? SHEET_DEFAULTS[k] : Number(el.value);
    else out[k] = el.value.trim();
    if (k.endsWith("Col")) out[k] = out[k].toUpperCase();
  }
  return out;
}

function togglePricing() {
  const isFormula = form.elements.pricingMethod.value === "formula";
  $("formulaField").hidden = !isFormula;
  $("marginField").hidden = isFormula;
  form.elements.formulaValue.required = isFormula;
  form.elements.marginPercent.required = !isFormula;
}

function validate() {
  const cols = COLS.map((k) => form.elements[k]);
  for (const el of cols) {
    const taken = cols.some((o) => o !== el && o.value.toUpperCase() === el.value.toUpperCase());
    el.setCustomValidity(taken ? "Each field needs its own column." : "");
  }
  const { formulaValue, pricingMethod } = form.elements;
  const badFormula = pricingMethod.value === "formula" && evalFormula(formulaValue.value, 1) === null;
  formulaValue.setCustomValidity(badFormula ? "Use costPrice with + - * / and parentheses." : "");
}

function chip(sheet) {
  const el = document.createElement("div");
  el.className = "chip";
  el.toggleAttribute("data-active", sheet.id === activeId);

  const select = document.createElement("button");
  select.type = "button";
  select.className = "select";
  select.textContent = sheet.name;
  select.setAttribute("aria-pressed", String(sheet.id === activeId));
  select.addEventListener("click", () => {
    activeId = sheet.id;
    persist();
    render();
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `Remove ${sheet.name}`);
  remove.addEventListener("click", () => {
    if (!confirm(`Remove "${sheet.name}"? Its settings are deleted. The Google Sheet itself is untouched.`)) return;
    sheets = sheets.filter((s) => s.id !== sheet.id);
    render();
    persist();
  });

  el.append(select, remove);
  return el;
}

function render() {
  const active = sheets.find((s) => s.id === activeId) ?? sheets[0];
  activeId = active?.id ?? "";
  $("chips").replaceChildren(...sheets.map(chip));
  $("empty").hidden = sheets.length > 0;
  form.hidden = !active;
  if (active) fill({ ...SHEET_DEFAULTS, ...active });
}

form.addEventListener("change", () => {
  togglePricing();
  validate();
  if (!form.reportValidity()) return;
  const patch = read();
  sheets = sheets.map((s) => (s.id === activeId ? { ...s, ...patch } : s));
  persist();
});

$("showPageButton").addEventListener("change", (e) =>
  chrome.storage.sync.set({ showPageButton: e.target.checked }),
);

$("addSheetBtn").addEventListener("click", () => {
  $("addForm").reset();
  $("addError").textContent = "";
  $("addDialog").showModal();
});

$("cancelBtn").addEventListener("click", () => $("addDialog").close());

$("addForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const ref = $("sheetRef").value.trim();
  const id = ref.match(/\/d\/([\w-]+)/)?.[1] ?? ref;
  if (!/^[\w-]{10,}$/.test(id)) {
    $("addError").textContent = "That doesn't look like a Google Sheets link or ID.";
    return;
  }
  if (sheets.some((s) => s.id === id)) {
    $("addError").textContent = "That sheet is already added.";
    return;
  }
  sheets.push({
    name: $("sheetName").value.trim(),
    id,
    sheetTab: $("newSheetTab").value.trim() || SHEET_DEFAULTS.sheetTab,
  });
  activeId = id;
  render();
  persist();
  $("addDialog").close();
});

// The popup can change the selected sheet while this page is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  const next = changes.sheets?.newValue ?? sheets;
  const nextId = changes.activeSheetId?.newValue ?? activeId;
  if (JSON.stringify([next, nextId]) === JSON.stringify([sheets, activeId])) return;
  sheets = next;
  activeId = nextId;
  render();
});

(async () => {
  $("version").textContent = `v${chrome.runtime.getManifest().version}`;
  const stored = await chrome.storage.sync.get({
    sheets: [],
    activeSheetId: "",
    showPageButton: true,
  });
  sheets = stored.sheets;
  activeId = stored.activeSheetId;
  $("showPageButton").checked = stored.showPageButton;
  render();
})();
