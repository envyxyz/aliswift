const $ = (id) => document.getElementById(id);
const pricingForm = $("pricingForm");
const titleForm = $("titleForm");
const editForm = $("editForm");

const PRICING_KEYS = [
  "extraCost",
  "pricingMethod",
  "formulaValue",
  "marginPercent",
  "includeSalePrice",
  "roundToNinetyNine",
];
const TITLE_KEYS = ["titleLength", "excludeKeywords"];
// Column rows in the Edit dialog. A row with `optional: true` may be left blank.
const COLUMNS = [
  { key: "keywordsCol", label: "Keywords" },
  { key: "linkCol", label: "Link" },
  { key: "priceCol", label: "Cost price" },
  { key: "salePriceCol", label: "Sell price" },
];
const EDIT_KEYS = ["name", "sheetTab", "startRow", ...COLUMNS.map((c) => c.key)];
const SCOPED_TABS = ["pricing", "title"];

const PENCIL =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

const tabs = [...document.querySelectorAll('[role="tab"]')];
const TAB_NAMES = tabs.map((t) => t.id.slice(4));

let sheets = [];
let activeId = "";
let editingId = "";
let tab = "";
let statusTimer;

function flash(text, isError = false) {
  const el = $("saveStatus");
  clearTimeout(statusTimer);
  el.textContent = text;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  if (!isError) statusTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

// Writes to sync storage. Returns the error on failure, nothing on success.
async function persist(list = sheets, id = activeId) {
  try {
    await chrome.storage.sync.set({ sheets: list, activeSheetId: id });
    sheets = list;
    activeId = id;
    flash("Saved");
  } catch (e) {
    flash("Not saved", true);
    return e;
  }
}

async function save() {
  const err = await persist();
  if (!err) return;
  toast("Couldn't save your changes.", {
    kind: "error",
    detail: err.message,
    action: { label: "Retry", onClick: save },
  });
}

function fill(form, keys, sheet) {
  for (const k of keys) {
    const el = form.elements[k];
    if (el.type === "checkbox") el.checked = sheet[k];
    else el.value = sheet[k];
  }
}

function read(form, keys) {
  const out = {};
  for (const k of keys) {
    const el = form.elements[k];
    if (el.type === "checkbox") out[k] = el.checked;
    else if (el.type === "number") out[k] = el.value === "" ? SHEET_DEFAULTS[k] : Number(el.value);
    else out[k] = el.value.trim();
    if (k.endsWith("Col")) out[k] = out[k].toUpperCase();
  }
  return out;
}

function togglePricing() {
  const isFormula = pricingForm.elements.pricingMethod.value === "formula";
  $("formulaField").hidden = !isFormula;
  $("marginField").hidden = isFormula;
  pricingForm.elements.formulaValue.required = isFormula;
  pricingForm.elements.marginPercent.required = !isFormula;
}

function validateFormula() {
  const { formulaValue, pricingMethod } = pricingForm.elements;
  const bad = pricingMethod.value === "formula" && evalFormula(formulaValue.value, 1) === null;
  formulaValue.setCustomValidity(
    bad ? "Use costPrice with + - * / and brackets, for example costPrice * 1.7." : "",
  );
}

function validateColumns() {
  const cols = [...editForm.querySelectorAll(".col")];
  for (const el of cols) {
    const v = el.value.toUpperCase();
    const taken = v && cols.some((o) => o !== el && o.value.toUpperCase() === v);
    const notLetter = v && !/^[A-Z]$/.test(v);
    el.setCustomValidity(
      notLetter ? "Use one letter, A to Z." : taken ? "Each field needs its own column." : "",
    );
  }
}

// Pricing and Title save as you change them. Each form checks only its own fields,
// so an invalid value in one tab never blocks a save in another.
function autosave(form, keys, prepare) {
  form.addEventListener("change", () => {
    prepare?.();
    if (!form.reportValidity()) return flash("Not saved", true);
    const patch = read(form, keys);
    sheets = sheets.map((s) => (s.id === activeId ? { ...s, ...patch } : s));
    save();
  });
}

/* Tabs */

function updateScope() {
  $("scope").hidden = !sheets.length || !SCOPED_TABS.includes(tab);
}

function showTab(name, focus = false) {
  tab = TAB_NAMES.includes(name) ? name : TAB_NAMES[0];
  for (const t of tabs) {
    const on = t.id === `tab-${tab}`;
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
    if (on && focus) t.focus();
  }
  history.replaceState(null, "", `#${tab}`);
  updateScope();
}

/* Sheets */

const chipOf = (id) => [...$("chips").children].find((c) => c.dataset.id === id);

function chip(sheet) {
  const el = document.createElement("div");
  el.className = "chip";
  el.dataset.id = sheet.id;
  el.toggleAttribute("data-active", sheet.id === activeId);

  const select = document.createElement("button");
  select.type = "button";
  select.className = "select";
  select.textContent = sheet.name;
  select.setAttribute("aria-pressed", String(sheet.id === activeId));
  select.addEventListener("click", () => {
    activeId = sheet.id;
    save();
    render();
  });

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "icon-btn edit";
  edit.title = `Edit ${sheet.name}`;
  edit.setAttribute("aria-label", `Edit ${sheet.name}`);
  edit.setAttribute("aria-haspopup", "dialog");
  edit.innerHTML = PENCIL;
  edit.addEventListener("click", () => openEdit(sheet.id));

  el.append(select, edit);
  return el;
}

function render() {
  const active = sheets.find((s) => s.id === activeId) ?? sheets[0];
  activeId = active?.id ?? "";
  const has = sheets.length > 0;
  $("chips").replaceChildren(...sheets.map(chip));
  $("chips").hidden = $("addSheetBtn").hidden = !has;
  $("empty").hidden = has;
  $("pricingEmpty").hidden = $("titleEmpty").hidden = has;
  pricingForm.hidden = titleForm.hidden = !has;
  $("scopeSheet").replaceChildren(...sheets.map((s) => new Option(s.name, s.id, false, s.id === activeId)));
  updateScope();
  if (active) {
    const merged = { ...SHEET_DEFAULTS, ...active };
    fill(pricingForm, PRICING_KEYS, merged);
    fill(titleForm, TITLE_KEYS, merged);
    togglePricing();
  }
  // The Edit dialog works on a snapshot, so it is never refilled here.
  if (editingId && !sheets.some((s) => s.id === editingId)) {
    $("editNotice").textContent = "This sheet was deleted in another window.";
    $("editSave").disabled = $("deleteBtn").disabled = true;
  }
}

/* Edit dialog */

function setSaving(on) {
  const btn = $("editSave");
  btn.dataset.state = on ? "loading" : "";
  btn.textContent = on ? "Saving..." : "Save";
  btn.disabled = on;
}

function showConfirm(on) {
  $("editActions").hidden = on;
  $("deleteConfirm").hidden = !on;
}

function keepSheet() {
  showConfirm(false);
  $("deleteBtn").focus();
}

function openEdit(id) {
  editingId = id;
  fill(editForm, EDIT_KEYS, { ...SHEET_DEFAULTS, ...sheets.find((s) => s.id === id) });
  validateColumns();
  $("editId").value = id;
  $("editOpen").href = `https://docs.google.com/spreadsheets/d/${id}/edit`;
  $("editNotice").textContent = "";
  $("deleteBtn").disabled = false;
  setSaving(false);
  showConfirm(false);
  $("editDialog").showModal();
}

$("colList").replaceChildren(
  ...COLUMNS.map(({ key, label, optional }) => {
    const row = document.createElement("div");
    row.className = "col-row";
    row.innerHTML =
      `<label for="edit-${key}">${label}${optional ? ' <span class="muted">(optional)</span>' : ""}</label>` +
      `<input id="edit-${key}" name="${key}" class="col" maxlength="1" pattern="[A-Za-z]" autocomplete="off" ` +
      `${optional ? 'placeholder="–"' : "required"} />`;
    return row;
  }),
);

editForm.addEventListener("input", validateColumns);

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setSaving(true);
  const patch = read(editForm, EDIT_KEYS);
  const err = await persist(sheets.map((s) => (s.id === editingId ? { ...s, ...patch } : s)));
  if (err) {
    $("editNotice").textContent = `Couldn't save: ${err.message}`;
    return setSaving(false);
  }
  render();
  $("editDialog").close();
});

$("editCancel").addEventListener("click", () => $("editDialog").close());

$("deleteBtn").addEventListener("click", () => {
  $("delQ").textContent = `Delete "${sheets.find((s) => s.id === editingId)?.name}"?`;
  showConfirm(true);
  $("keepBtn").focus();
});

$("keepBtn").addEventListener("click", keepSheet);

// The first Escape in the delete confirmation goes back to the buttons. The second closes the dialog.
$("editDialog").addEventListener("cancel", (e) => {
  if ($("deleteConfirm").hidden) return;
  e.preventDefault();
  keepSheet();
});

$("delBtn").addEventListener("click", async () => {
  const id = editingId;
  const name = sheets.find((s) => s.id === id)?.name;
  const near = afterRemoval(sheets, id);
  editingId = ""; // so the storage change from this write does not flag the sheet as deleted elsewhere
  const err = await persist(
    sheets.filter((s) => s.id !== id),
    activeId === id ? near : activeId,
  );
  if (err) {
    editingId = id;
    $("editNotice").textContent = `Couldn't save: ${err.message}`;
    return keepSheet();
  }
  render();
  $("editDialog").close();
  toast(`Deleted "${name}"`);
  (chipOf(near)?.querySelector(".select") ?? $("emptyAddBtn")).focus();
});

$("editDialog").addEventListener("close", () => {
  chipOf(editingId)?.querySelector(".edit")?.focus();
  editingId = "";
});

/* Add dialog */

function openAdd() {
  $("addForm").reset();
  $("addError").textContent = "";
  $("addDialog").showModal();
}

$("addSheetBtn").addEventListener("click", openAdd);
$("emptyAddBtn").addEventListener("click", openAdd);
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
  save();
  $("addDialog").close();
  chipOf(id).querySelector(".select").focus();
});

/* Page wiring */

autosave(pricingForm, PRICING_KEYS, () => {
  togglePricing();
  validateFormula();
});
autosave(titleForm, TITLE_KEYS);

// The scope bar picks the same active sheet as the chips and the popup.
$("scopeSheet").addEventListener("change", (e) => {
  activeId = e.target.value;
  save();
  render();
});

$("showPageButton").addEventListener("change", (e) =>
  chrome.storage.sync.set({ showPageButton: e.target.checked }).then(() => flash("Saved")),
);

$("tabs").addEventListener("click", (e) => {
  const t = e.target.closest('[role="tab"]');
  if (t) showTab(t.id.slice(4));
});

$("tabs").addEventListener("keydown", (e) => {
  const i = tabs.indexOf(e.target);
  const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  showTab(TAB_NAMES[(to + tabs.length) % tabs.length], true);
});

for (const btn of document.querySelectorAll("[data-goto]")) {
  btn.addEventListener("click", () => showTab(btn.dataset.goto, true));
}

window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));

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

showTab(location.hash.slice(1));

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
