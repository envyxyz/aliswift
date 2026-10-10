const $ = (id) => document.getElementById(id);
const pricingForm = $("pricingForm");
const titleForm = $("titleForm");
const editForm = $("editForm");
const addForm = $("addForm");

const PRICING_KEYS = [
  "extraCost",
  "pricingMethod",
  "formulaValue",
  "marginPercent",
  "includeSalePrice",
  "roundToNinetyNine",
];
const TITLE_KEYS = ["titleLength", "excludeKeywords"];
// Column rows in the Edit dialog. Optional columns sit under "More columns" and may be left blank.
const COLUMNS = [
  { key: "keywordsCol", label: "Keywords" },
  { key: "linkCol", label: "Link" },
  { key: "priceCol", label: "Cost price" },
  { key: "salePriceCol", label: "Sell price" },
  { key: "skuCol", label: "SKU", optional: true },
  { key: "statusCol", label: "Status", optional: true },
  { key: "imageCol", label: "Image", optional: true },
  { key: "profitCol", label: "Profit", optional: true },
  { key: "marginCol", label: "Margin", optional: true },
];
// The Orders tab's columns, saved as the sheet's oCols. These three are needed once orders are on.
const ORDER_COLS = [
  { key: "no", label: "Order no.", required: true },
  { key: "sku", label: "SKU", required: true },
  { key: "date", label: "Date" },
  { key: "qty", label: "Quantity" },
  { key: "sell", label: "Sell price" },
  { key: "cost", label: "Cost price" },
  { key: "profit", label: "Profit" },
  { key: "status", label: "Status", required: true },
  { key: "track", label: "Tracking" },
  { key: "notes", label: "Notes" },
];
// oCols is edited through the ORDER_COLS inputs (oc_<key>), not by its own key.
const EDIT_KEYS = [
  "name",
  "sheetTab",
  "startRow",
  "region",
  ...COLUMNS.map((c) => c.key),
  "skuPrefix",
  "oTab",
  "oRow",
];
const SCOPED_TABS = ["pricing", "title"];

const tabs = [...document.querySelectorAll('[role="tab"]')];
const TAB_NAMES = tabs.map((t) => t.id.slice(4));

let sheets = [];
let activeId = "";
let homeCurrency = "";
let editingId = "";
let tab = "";
let statusTimer;

const sheetUrl = (id) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;

function flash(text, isError = false) {
  const el = $("saveStatus");
  clearTimeout(statusTimer);
  el.textContent = text;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  if (!isError) statusTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

// Shows `text` in a .notice banner, or hides the banner when text is empty.
function setNotice(el, text) {
  el.querySelector("div").textContent = text;
  el.hidden = !text;
}

// A name made only of spaces would save as an empty name.
function checkName(input) {
  input.setCustomValidity(input.value.trim() ? "" : "Enter a name.");
}

// Writes to sync storage. Returns the error on failure, nothing on success.
async function persist(list = sheets, id = activeId) {
  try {
    await chrome.storage.sync.set({
      sheets: list,
      activeSheetId: id,
      ...(homeCurrency && { homeCurrency }),
    });
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

// Writes settings that are not the sheet list. On failure `undo` puts the control back
// and a Retry toast offers `retry`.
async function setSync(patch, undo, retry) {
  try {
    await chrome.storage.sync.set(patch);
    flash("Saved");
  } catch (e) {
    undo();
    flash("Not saved", true);
    toast("Couldn't save your changes.", {
      kind: "error",
      detail: e.message,
      action: { label: "Retry", onClick: retry },
    });
  }
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

// Everything the Edit dialog checks or keeps in step: column letters (each used once per scope),
// the SKU prefix, which Orders columns are required, the name and the "n of 5 set" count.
function validateEdit() {
  const cols = [...editForm.querySelectorAll(".col")];
  const scopeOf = (el) => el.closest("[data-scope]").dataset.scope;
  for (const el of cols) {
    const v = el.value.toUpperCase();
    const taken = v && cols.some((o) => o !== el && scopeOf(o) === scopeOf(el) && o.value.toUpperCase() === v);
    const notLetter = v && !/^[A-Z]$/.test(v);
    el.setCustomValidity(
      notLetter ? "Use one letter, A to Z." : taken ? "Each field needs its own column." : "",
    );
  }
  const { skuCol, skuPrefix, oTab, name } = editForm.elements;
  skuPrefix.disabled = !skuCol.value.trim();
  skuPrefix.setCustomValidity(
    /^[A-Za-z0-9-]{0,8}$/.test(skuPrefix.value) ? "" : "Use 8 characters or fewer: letters, numbers and dashes.",
  );
  for (const c of ORDER_COLS) editForm.elements[`oc_${c.key}`].required = !!c.required && !!oTab.value.trim();
  checkName(name);
  const optional = COLUMNS.filter((c) => c.optional);
  const set = optional.filter((c) => editForm.elements[c.key].value.trim()).length;
  $("moreCount").textContent = `${set} of ${optional.length} set`;
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
    chipOf(sheet.id)?.querySelector(".select").focus(); // render() rebuilt the chip
  });

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "icon-btn edit";
  edit.title = `Edit ${sheet.name}`;
  edit.setAttribute("aria-label", `Edit ${sheet.name}`);
  edit.setAttribute("aria-haspopup", "dialog");
  edit.innerHTML = svgIcon(ICONS.pencil, 16);
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
    setNotice($("editNotice"), "This sheet was deleted in another window.");
    $("editSave").disabled = $("deleteBtn").disabled = $("delBtn").disabled = true;
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
  const merged = { ...SHEET_DEFAULTS, ...sheets.find((s) => s.id === id) };
  fill(editForm, EDIT_KEYS, merged);
  const oCols = { ...SHEET_DEFAULTS.oCols, ...merged.oCols };
  for (const c of ORDER_COLS) editForm.elements[`oc_${c.key}`].value = oCols[c.key];
  validateEdit();
  $("editId").value = id;
  $("editOpen").href = sheetUrl(id);
  setNotice($("editNotice"), "");
  $("deleteBtn").disabled = $("delBtn").disabled = false;
  $("moreCols").open = $("orderCols").open = false;
  setSaving(false);
  showConfirm(false);
  $("editDialog").showModal();
}

const colRow = ({ key, label, optional }) => {
  const row = document.createElement("div");
  row.className = "col-row";
  row.innerHTML =
    `<label for="edit-${key}">${label}${optional ? ' <span class="muted">(optional)</span>' : ""}</label>` +
    `<input id="edit-${key}" name="${key}" class="col" maxlength="1" pattern="[A-Za-z]" autocomplete="off" ` +
    `${optional ? 'placeholder="–"' : "required"} />`;
  return row;
};

$("colList").replaceChildren(...COLUMNS.filter((c) => !c.optional).map(colRow));
$("prefixRow").before(...COLUMNS.filter((c) => c.optional).map(colRow));
$("orderGrid").prepend(
  ...ORDER_COLS.map(({ key, label, required }) => {
    const cell = document.createElement("div");
    cell.innerHTML =
      `<label for="edit-oc-${key}">${label}</label>` +
      `<input id="edit-oc-${key}" name="oc_${key}" class="col" maxlength="1" pattern="[A-Za-z]" autocomplete="off" ` +
      `${required ? "" : 'placeholder="–"'} />`;
    return cell;
  }),
);
const regionOptions = () => Object.entries(REGIONS).map(([key, r]) => new Option(r.label, key));
// Only a sheet that already exists can have no marketplace: a new sheet needs one.
$("editRegion").replaceChildren(new Option("Not set", ""), ...regionOptions());
$("region").replaceChildren(...regionOptions());

editForm.addEventListener("input", validateEdit);

// A message can't point at a field inside a closed section, so open the section first.
editForm.addEventListener(
  "invalid",
  (e) => {
    const section = e.target.closest("details");
    if (section) section.open = true;
  },
  true,
);

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!$("deleteConfirm").hidden) return; // Enter while the delete question shows must not save
  setSaving(true);
  const patch = read(editForm, EDIT_KEYS);
  if (patch.oTab) {
    patch.oCols = Object.fromEntries(
      ORDER_COLS.map((c) => [c.key, editForm.elements[`oc_${c.key}`].value.trim().toUpperCase()]),
    );
  }
  const err = await persist(sheets.map((s) => (s.id === editingId ? { ...s, ...patch } : s)));
  if (err) {
    setNotice($("editNotice"), `Couldn't save: ${err.message}`);
    return setSaving(false);
  }
  render();
  $("editDialog").close();
});

$("editCancel").addEventListener("click", () => $("editDialog").close());

// Fills every field to match the sheets AliSwift creates. Nothing is saved until Save.
$("presetBtn").addEventListener("click", () => {
  const btn = $("presetBtn");
  const changed = [];
  const set = (el, value) => {
    if (el.value === String(value)) return;
    el.value = value;
    changed.push(el);
  };
  for (const key of EDIT_KEYS.filter((k) => k !== "name" && k !== "region")) {
    set(editForm.elements[key], TEMPLATE_LAYOUT[key]);
  }
  for (const c of ORDER_COLS) set(editForm.elements[`oc_${c.key}`], TEMPLATE_LAYOUT.oCols[c.key]);
  $("moreCols").open = true;
  validateEdit();
  for (const el of changed) el.dataset.flash = "";
  setTimeout(() => changed.forEach((el) => el.removeAttribute("data-flash")), 600);
  btn.dataset.state = "success";
  btn.textContent = "Applied";
  setTimeout(() => {
    btn.dataset.state = "";
    btn.textContent = "Use AliSwift template layout";
  }, 1500);
});

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
    setNotice($("editNotice"), `Couldn't save: ${err.message}`);
    return keepSheet();
  }
  render();
  $("editDialog").close();
  toast(`Deleted "${name}"`);
  (chipOf(near)?.querySelector(".select") ?? $("emptyAddBtn")).focus();
});

$("editDialog").addEventListener("close", () => {
  // After a delete editingId is already empty and focus has moved on. Otherwise go back to the
  // pencil, or to the active chip when the sheet was deleted in another window.
  if (editingId) {
    (
      chipOf(editingId)?.querySelector(".edit") ??
      chipOf(activeId)?.querySelector(".select") ??
      $("emptyAddBtn")
    ).focus();
  }
  editingId = "";
});

/* Add dialog */

let adding = false; // a create request is in flight
let orphanId = ""; // a file that was created but not set up, so Retry setup can finish it

const mode = () => addForm.elements.addMode.value;

function setMode() {
  const auto = mode() === "auto";
  $("autoFields").hidden = $("autoFields").disabled = !auto;
  $("manualFields").hidden = $("manualFields").disabled = auto;
  $("modeCaption").textContent = auto
    ? "AliSwift creates a ready-made Google Sheet for you."
    : "Connect a Google Sheet you already have.";
  if (!orphanId) $("addSubmit").textContent = auto ? "Create sheet" : "Add";
}

// With the same currency on both sides there is no rate to look up.
function syncRate() {
  const same = $("homeCur").value.trim().toUpperCase() === REGIONS[$("region").value].currency;
  $("rate").disabled = same;
  if (same) $("rate").value = "";
  $("rate").placeholder = same ? "Not needed" : "e.g. 374.37";
}

function validateAuto() {
  const cur = $("homeCur");
  cur.setCustomValidity(/^[A-Za-z]{3}$/.test(cur.value.trim()) ? "" : "Use a 3-letter currency code, like PKR.");
  const rate = $("rate").value;
  // 0.000001 is the smallest rate the service worker accepts.
  $("rate").setCustomValidity(rate === "" || Number(rate) >= 1e-6 ? "" : "Enter a rate of 0.000001 or more, or leave this empty.");
  checkName($("sheetName"));
}

// busy: a request is running. The submit button keeps focus (aria-disabled, not disabled).
function setBusy(busy, label) {
  adding = busy;
  addForm.setAttribute("aria-busy", String(busy));
  $("addInputs").disabled = busy || !!orphanId;
  $("addSubmit").dataset.state = busy ? "loading" : "";
  $("addSubmit").setAttribute("aria-disabled", String(busy));
  $("addSubmit").textContent = label;
  $("cancelBtn").setAttribute("aria-disabled", String(busy));
  $("addStatus").hidden = !busy;
  $("addStatus").textContent = busy ? "Creating your sheet. This takes a few seconds." : "";
}

function showOrphan(name, message, id) {
  const text = (tag, ...nodes) => {
    const p = document.createElement(tag);
    p.append(...nodes);
    return p;
  };
  const strong = document.createElement("strong");
  strong.textContent = "Setup didn't finish.";
  const link = document.createElement("a");
  link.href = sheetUrl(id);
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Open it in Google Sheets";
  $("addNotice").querySelector("div").replaceChildren(
    text("p", strong),
    text("p", `“${name}” was created in your Drive, but its tabs and formulas weren't set up. ${message}`),
    text("p", "Cancel leaves the unfinished file in your Drive. ", link),
  );
  $("addNotice").hidden = false;
}

function openAdd() {
  addForm.reset();
  orphanId = "";
  setNotice($("addNotice"), "");
  setBusy(false, "Create sheet");
  $("homeCur").value = homeCurrency;
  setMode();
  syncRate();
  validateAuto();
  $("addDialog").showModal();
}

async function createAuto() {
  const rate = $("rate").value;
  const data = {
    name: $("sheetName").value.trim(),
    region: $("region").value,
    homeCurrency: $("homeCur").value.trim().toUpperCase(),
    rate: rate === "" ? null : Number(rate),
    ...(orphanId && { resumeId: orphanId }),
  };
  setNotice($("addNotice"), "");
  $("addSubmit").focus(); // before the fields lock, so focus never falls to the page
  setBusy(true, orphanId ? "Retrying..." : "Creating...");
  const res = await chrome.runtime
    .sendMessage({ action: "createSheet", data })
    .catch((err) => ({ success: false, error: err.message }));

  if (!res?.success) {
    if (res?.orphanId) orphanId = res.orphanId;
    setBusy(false, orphanId ? "Retry setup" : "Create sheet");
    const reason = res?.error ?? "AliSwift didn't answer. Reload the extension and try again.";
    if (orphanId) showOrphan(data.name, reason, orphanId);
    else setNotice($("addNotice"), `Couldn't create the sheet. ${reason}`);
    // Esc can close the dialog while it works (the browser stops honouring preventDefault after a few presses).
    if (!$("addDialog").open) $("addDialog").showModal();
    return $("addSubmit").focus();
  }
  const { sheet } = res;
  sheets = [...sheets, sheet];
  activeId = sheet.id;
  homeCurrency = data.homeCurrency;
  orphanId = "";
  setBusy(false, "Create sheet");
  $("addDialog").close();
  render();
  save();
  toast(`Created “${sheet.name}”.`, {
    action: { label: "Open sheet", onClick: () => window.open(sheetUrl(sheet.id), "_blank", "noopener") },
  });
  chipOf(sheet.id)?.querySelector(".select").focus();
}

function addManual() {
  const ref = $("sheetRef").value.trim();
  const id = ref.match(/\/d\/([\w-]+)/)?.[1] ?? ref;
  if (!/^[\w-]{10,}$/.test(id)) {
    return setNotice($("addNotice"), "That doesn't look like a Google Sheets link or ID.");
  }
  if (sheets.some((s) => s.id === id)) {
    return setNotice($("addNotice"), "That sheet is already added.");
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
}

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (adding) return;
  setNotice($("addNotice"), "");
  return mode() === "auto" ? createAuto() : addManual();
});

addForm.addEventListener("change", (e) => {
  if (e.target.name === "addMode") {
    setNotice($("addNotice"), ""); // an error from the other mode does not apply here
    setMode();
  }
  if (e.target === $("region")) syncRate();
});

addForm.addEventListener("input", (e) => {
  if (e.target === $("homeCur")) {
    $("homeCur").value = $("homeCur").value.toUpperCase();
    syncRate();
  }
  validateAuto();
});

// A half-built sheet must not be walked away from by accident.
$("addDialog").addEventListener("cancel", (e) => {
  if (adding) e.preventDefault();
});
// The finished file is added to AliSwift by this page, so closing the tab mid-create would lose it.
window.addEventListener("beforeunload", (e) => {
  if (adding) e.preventDefault();
});

// Adding a sheet needs Google, so the buttons stay visible but inert while signed out (see lockSheets).
const locked = () => !$("lockSheets").hidden;
$("addSheetBtn").addEventListener("click", () => locked() || openAdd());
$("emptyAddBtn").addEventListener("click", () => locked() || openAdd());
// Unknown counts as signed in, so the buttons never flicker locked on load.
document.addEventListener("authchange", (e) => {
  $("lockSheets").hidden = e.detail.signedIn;
  for (const id of ["addSheetBtn", "emptyAddBtn"]) $(id).setAttribute("aria-disabled", String(!e.detail.signedIn));
});
$("cancelBtn").addEventListener("click", () => {
  if (!adding) $("addDialog").close();
});

/* Settings backup */

const IMPORT_ERRORS = {
  json: "That file isn't a valid settings file.",
  app: "That file isn't from AliSwift.",
  version: "That file is from a newer version of AliSwift. Update the extension and try again.",
  structure: "That file is damaged or was edited. Export a fresh copy and try again.",
  size: "That file is too large to import.",
};
const countOf = (n) => `${n} ${n === 1 ? "sheet" : "sheets"}`;
let pendingImport = null;

$("exportBtn").addEventListener("click", async () => {
  try {
    // sheets is always there, so a backup of an empty setup can be imported again.
    const sync = { sheets: [], activeSheetId: "", ...(await chrome.storage.sync.get(EXPORT_KEYS)) };
    const file = { app: "aliswift", version: 1, exportedAt: new Date().toISOString(), sync };
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: "aliswift-settings.json" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast("Exported aliswift-settings.json.");
  } catch (e) {
    toast("Couldn't export your settings.", {
      kind: "error",
      detail: e.message,
      action: { label: "Retry", onClick: () => $("exportBtn").click() },
    });
  }
});

$("importBtn").addEventListener("click", () => $("importFile").click());

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // so choosing the same file again still fires change
  if (!file) return;
  setNotice($("importNotice"), "");
  let result = { ok: false, reason: "size" };
  if (file.size <= 200 * 1024) {
    try {
      result = validateImport(JSON.parse(await file.text()));
    } catch {
      result = { ok: false, reason: "json" };
    }
  }
  if (!result.ok) return setNotice($("importNotice"), IMPORT_ERRORS[result.reason]);
  pendingImport = result.sync;
  const [n, m] = [sheets.length, pendingImport.sheets.length];
  const from = m ? `${m} from the file` : "none from the file";
  $("impQ").textContent = n ? `Replace your ${countOf(n)} with ${from}?` : `Import ${countOf(m)} from the file?`;
  $("impGo").textContent = n ? "Replace" : "Import";
  $("impGo").classList.toggle("btn-danger", n > 0); // nothing is replaced when there are no sheets
  $("importDialog").showModal();
});

$("impKeep").addEventListener("click", () => $("importDialog").close());

$("impGo").addEventListener("click", async () => {
  const next = pendingImport;
  if (!next || $("impGo").dataset.state === "loading") return;
  const label = $("impGo").textContent;
  $("impGo").dataset.state = "loading";
  $("impGo").setAttribute("aria-disabled", "true");
  $("impGo").textContent = "Replacing...";
  try {
    await chrome.storage.sync.set(next);
  } catch (err) {
    flash("Not saved", true);
    setNotice($("importNotice"), `Couldn't import: ${err.message}`);
    return $("importDialog").close();
  } finally {
    $("impGo").dataset.state = "";
    $("impGo").removeAttribute("aria-disabled");
    $("impGo").textContent = label;
  }
  sheets = next.sheets;
  activeId = next.activeSheetId;
  if (next.homeCurrency) homeCurrency = next.homeCurrency;
  if ("showPageButton" in next) $("showPageButton").checked = next.showPageButton;
  render();
  flash("Saved");
  $("importDialog").close();
  toast(`Imported ${countOf(next.sheets.length)}.`);
  $("importBtn").focus();
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

function savePageButton(on) {
  $("showPageButton").checked = on;
  return setSync(
    { showPageButton: on },
    () => ($("showPageButton").checked = !on),
    () => savePageButton(on),
  );
}
$("showPageButton").addEventListener("change", (e) => savePageButton(e.target.checked));

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
  if (canonical([next, nextId]) === canonical([sheets, activeId])) return;
  sheets = next;
  activeId = nextId;
  render();
});

showTab(location.hash.slice(1));
profileButton($("profile"));

(async () => {
  $("version").textContent = `v${chrome.runtime.getManifest().version}`;
  const stored = await chrome.storage.sync.get({
    sheets: [],
    activeSheetId: "",
    showPageButton: true,
    homeCurrency: "",
  });
  sheets = stored.sheets;
  activeId = stored.activeSheetId;
  homeCurrency = stored.homeCurrency;
  $("showPageButton").checked = stored.showPageButton;
  render();
})();
