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
  const lack = lacking((k) => editForm.elements[k].value.trim());
  $("colsOffer").hidden = !lack.length;
  $("colsOfferText").textContent = `This sheet has no ${nameList(lack)} column. Without ${lack.length > 1 ? "them" : "it"}, AliSwift is less useful. AliSwift can add ${lack.length > 1 ? "them" : "it"} for you.`;
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
  $("chips").hidden = $("groupActions").hidden = !has;
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

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (adding) return;
  setNotice($("addNotice"), "");
  return createAuto();
});

addForm.addEventListener("change", (e) => {
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
for (const id of ["gsOpen", "gsOpenEmpty"]) $(id).addEventListener("click", (e) => locked() || openGs(e.currentTarget));
// Unknown (null, or no event yet) counts as signed in, so the buttons never flicker locked on load.
// The buttons point at the hint only while it shows: a hidden element would still be read out as their description.
document.addEventListener("authchange", (e) => {
  const lock = e.detail.signedIn === false;
  $("lockSheets").hidden = !lock;
  for (const id of ["addSheetBtn", "emptyAddBtn", "gsOpen", "gsOpenEmpty"]) {
    $(id).setAttribute("aria-disabled", String(lock));
    if (lock) $(id).setAttribute("aria-describedby", "lockSheets");
    else $(id).removeAttribute("aria-describedby");
  }
  if (e.detail.signedIn && $("gsDialog").open && gsListFailed) gsLoad(); // signed back in from the dialog
});
$("cancelBtn").addEventListener("click", () => {
  if (!adding) $("addDialog").close();
});

/* Add missing columns. A sheet with no SKU or Image column works, but less well: no custom label to list under, no photos
   on the dashboard. So the seller is asked, once, whether AliSwift may add them (the worker's addColumns). Nothing is
   added without a Yes, and this is the only place this page changes a sheet's layout. */

const MISSING = {
  skuCol: ["SKU", "a short code for each product. It is your eBay custom label, and how an order finds its product."],
  imageCol: ["Image", "the link to each product's photo, so the dashboard can show it. It stays in your sheet, so it survives reinstalling AliSwift."],
};
const lacking = (has) => Object.keys(MISSING).filter((k) => !has(k));
const nameList = (keys) => keys.map((k) => MISSING[k][0]).join(" or ");

// "yes", "no" or "back" (Go back, or Escape). `back` is for the import, where the seller can still pick a column themselves.
function askColumns(keys, { prefix = SHEET_DEFAULTS.skuPrefix, back = true } = {}) {
  const li = (k) => {
    const item = document.createElement("li");
    const note = k === "skuCol" ? ` Products already in the sheet are numbered ${prefix}01, ${prefix}02 and so on.` : "";
    item.append(Object.assign(document.createElement("strong"), { textContent: MISSING[k][0] }), ` is ${MISSING[k][1]}${note}`);
    return item;
  };
  const plural = keys.length > 1;
  $("colsLead").textContent = `Your sheet has no ${nameList(keys)} column. Without ${plural ? "them" : "it"}, AliSwift is less useful:`;
  $("colsList").replaceChildren(...keys.map(li));
  $("colsIfYes").textContent = `If you say yes, AliSwift adds ${plural ? "them" : "it"} after the last column of the Inventory tab, with a title in the header row. Nothing else in your sheet changes.`;
  $("colsIfNo").textContent = "If you say no, AliSwift still works. It keeps product photos on this device instead. They survive updates, and Export settings saves them, but removing the extension loses them.";
  $("colsBack").hidden = !back;
  const dialog = $("colsDialog");
  dialog.returnValue = "";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue || "back"), { once: true });
    dialog.showModal();
  });
}

// Asks the worker to add the columns to a sheet it already has in its settings, and keeps the letters it saved.
async function addColumnsTo(id, keys) {
  const res = await chrome.runtime.sendMessage({ action: "addColumns", sheetId: id, columns: keys }).catch((e) => ({ success: false, error: e.message }));
  if (res?.success) {
    sheets = sheets.map((s) => (s.id === id ? { ...s, ...res.columns } : s));
    render();
  }
  return res ?? { success: false, error: "AliSwift didn't answer. Reload the extension and try again." };
}

const columnsAdded = (res) => Object.entries(res.columns).map(([k, letter]) => `${MISSING[k][0]} in ${letter}`).join(", ");

// The same offer for a sheet added earlier, in its Edit dialog. The worker works from the saved settings, so the fields it
// uses must be saved first.
$("colsOfferBtn").addEventListener("click", async () => {
  const btn = $("colsOfferBtn");
  if (btn.getAttribute("aria-disabled") === "true") return;
  const saved = { ...SHEET_DEFAULTS, ...sheets.find((s) => s.id === editingId) };
  const changed = ["sheetTab", "startRow", "keywordsCol", "linkCol", "skuPrefix"].some((k) => String(editForm.elements[k].value).trim().toUpperCase() !== String(saved[k]).toUpperCase());
  if (changed) return setNotice($("editNotice"), "Save your changes to the tab, first row, Keywords, Link and SKU prefix first, then add the columns.");
  const keys = lacking((k) => editForm.elements[k].value.trim());
  if ((await askColumns(keys, { prefix: saved.skuPrefix, back: false })) !== "yes") return btn.focus();
  btn.dataset.state = "loading";
  btn.setAttribute("aria-disabled", "true");
  const res = await addColumnsTo(editingId, keys);
  btn.dataset.state = "";
  btn.removeAttribute("aria-disabled");
  if (!res.success) {
    setNotice($("editNotice"), `Couldn't add the columns. ${res.error}`);
    return btn.focus();
  }
  setNotice($("editNotice"), "");
  for (const [k, letter] of Object.entries(res.columns)) editForm.elements[k].value = letter;
  validateEdit();
  toast(`New columns: ${columnsAdded(res)}.`);
  editForm.elements.name.focus();
});

/* Import from Google Sheets. It reads the user's sheet and changes nothing in it, except the columns the seller said
   yes to above. A new sheet is otherwise only a settings entry here. The service worker does the reading and matching
   (lib/importmap.js). */

const gsForm = $("gsForm");
const send = (message) => chrome.runtime.sendMessage(message).catch((e) => ({ success: false, error: e.message }));
// One row per field, from the same lists the Edit dialog uses. Orders fields are named oc_<key> there too.
const GS_ROWS = [
  ...COLUMNS.map((c) => ({ ...c, scope: "inv", name: c.key, required: !c.optional })),
  ...ORDER_COLS.map((c) => ({ ...c, scope: "ord", name: `oc_${c.key}` })),
];
const GS_KEYS = ["name", "sheetTab", "startRow", "region", ...COLUMNS.map((c) => c.key), "oTab", "oRow"];
const GS_PANES = ["gsChoose", "gsRead", "gsMap"];
const GS_TAGS = { matched: ["green", "success", "Matched"], guessed: ["amber", "warning", "Guessed"], yours: ["blue", "", "Your pick"], formula: ["amber", "warning", "Has formulas"] };
const GS_NOTICE_ICON = { error: ICONS.error, warn: ICONS.warning, info: ICONS.info };
const GS_REASONS = {
  nokey: "Add a Gemini key in the AI tab to map with AI.",
  "invalid-key": "Gemini rejected your key. Check it in the AI tab.",
  rate: "Gemini is busy right now.",
  network: "Couldn't reach Gemini.",
  timeout: "Gemini took too long.",
  "bad-output": "Gemini's answer didn't pass checks.",
  "bad-model": "Gemini doesn't know the model name. Check the model in the AI tab.",
};
const GS_RETRY = ["rate", "network", "timeout", "bad-output"];
const GS_ERRORS = {
  forbidden: "You don't have access to that sheet.",
  xlsx: "That's an Excel file opened in Google Sheets. In Sheets, choose File, then Save as Google Sheets, and try again.",
  noheaders: "Couldn't find column headers in any tab. Put titles like “Product” and “Price” in the first rows of a tab, then try again.",
  network: "Couldn't reach Google. Check your connection.",
  timeout: "Couldn't reach Google. Check your connection.",
  rate: "Google is busy. Try again in a minute.",
  signin: "Signed out.",
};
const clip = (s, n = 36) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

let gsFiles = [];
let gsTruncated = false;
let gsPicked = ""; // the radio the user chose; a pasted link excludes it
let gsListFailed = false;
let gsMeta = null; // what the service worker read
let gsDraft = null; // what it matched
let gsOpener = null;
let gsAfter = null; // where focus goes on close instead of the opener
let gsSaving = false;
let gsWasMissing = false;
let gsOpenId = 0; // bumped on open and close: a late list reply is ignored
let gsRun = 0; // bumped when a read or match is abandoned or replaced
let gsPaneTimer;
let gsAiTimer;

// A confidence tag: always words, never colour alone.
function setTag(el, conf, required) {
  const [tone, icon, word] = GS_TAGS[conf] ?? (required ? ["red", "error", "Not found"] : ["grey", "", "Not found"]);
  el.dataset.tone = tone;
  el.dataset.conf = conf;
  el.innerHTML = (icon ? svgIcon(ICONS[icon], 12) : "") + word;
}

// The Choose pane's banner; no text hides it. action: { label, quiet, data } adds a button the notice's click handler answers.
function gsNotify(tone, text, action) {
  const el = $("gsNotice");
  el.querySelector("button")?.remove();
  el.hidden = !text;
  if (!text) return;
  if (tone === "info") el.removeAttribute("data-tone");
  else el.dataset.tone = tone;
  el.querySelector("path").setAttribute("d", GS_NOTICE_ICON[tone]);
  el.querySelector("div").textContent = text;
  if (!action) return;
  const btn = Object.assign(document.createElement("button"), { type: "button", className: action.quiet ? "btn btn-quiet btn-sm" : "link-btn", textContent: action.label });
  Object.assign(btn.dataset, action.data);
  el.append(btn);
}

function gsStopTimers() {
  clearTimeout(gsPaneTimer);
  clearTimeout(gsAiTimer);
  $("gsSkipAi").hidden = true;
}

function gsPane(id) {
  for (const p of GS_PANES) $(p).hidden = $(p).disabled = p !== id;
  $("gsBack").hidden = id !== "gsMap";
  $("gsGo").hidden = id === "gsRead";
  $("gsGo").textContent = id === "gsMap" ? "Add sheet" : "Continue";
  $("gsGo").disabled = id === "gsChoose" && !(gsPicked || $("gsPaste").value.trim());
  if (id === "gsRead") $("gsCancel").focus();
}

// Continue and Add sheet answer the press on the same frame; Cancel never waits for a request.
function gsWait(on, label) {
  const go = $("gsGo");
  go.dataset.state = on ? "loading" : "";
  go.textContent = on ? label : $("gsMap").hidden ? "Continue" : "Add sheet";
  if (on) go.setAttribute("aria-disabled", "true");
  else go.removeAttribute("aria-disabled");
  if (!on && !$("gsMap").hidden) gsValidate();
}

/* Choose */

function gsState(text, spin) {
  const el = document.createElement("div");
  el.className = "gs-state";
  if (spin) el.innerHTML = '<span class="gs-spinner" aria-hidden="true"></span>';
  el.append(Object.assign(document.createElement("p"), { textContent: text }));
  return el;
}

function gsEdited(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (Number.isNaN(d.getTime())) return "";
  if (d.toDateString() === now.toDateString()) return "Edited today";
  const year = d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" };
  return `Edited ${d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...year })}`;
}

function gsRow(file) {
  const label = Object.assign(document.createElement("label"), { className: "pick" });
  const radio = Object.assign(document.createElement("input"), { type: "radio", name: "gsPick", value: file.id, checked: file.id === gsPicked });
  const span = (cls, text) => Object.assign(document.createElement("span"), { className: cls, textContent: text });
  label.append(radio, span("pick-name", file.name));
  if (sheets.some((s) => s.id === file.id)) label.append(span("tag", "Added"));
  label.append(span("pick-date", gsEdited(file.modified)));
  return label;
}

function gsRenderList() {
  const q = $("gsSearch").value.trim();
  const shown = gsFiles.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));
  if (!shown.some((f) => f.id === gsPicked)) gsPicked = "";
  $("gsList").replaceChildren(...(shown.length ? shown.map(gsRow) : [gsState(`No sheets match “${q}”.`)]));
  $("gsCount").textContent =
    (q ? `${shown.length} of ${countOf(gsFiles.length)}` : countOf(gsFiles.length)) +
    (gsTruncated ? ". Showing your 100 most recent sheets. Paste a link for older ones." : "");
  $("gsGo").disabled = !(gsPicked || $("gsPaste").value.trim());
}

async function gsLoad() {
  const mine = gsOpenId;
  gsListFailed = false;
  gsNotify("", "");
  $("gsListWrap").hidden = false;
  $("gsEmpty").hidden = true;
  $("gsPasteLabel").textContent = "Or paste the sheet link or ID";
  $("gsList").replaceChildren(gsState("Loading your sheets...", true));
  $("gsCount").textContent = "";
  const reply = await send({ action: "listSpreadsheets" });
  if (mine !== gsOpenId) return;
  if (!reply.success) {
    // The picker is a convenience: pasting a link always works.
    gsListFailed = true;
    $("gsListWrap").hidden = true;
    $("gsPasteLabel").textContent = "Paste the sheet link or ID";
    if (reply.code === "signin") gsNotify("error", "Signed out.", { label: "Sign in", data: { signin: "" } });
    else if (reply.code === "api-disabled") gsNotify("warn", "Google Drive API isn't enabled for this app, so your sheets can't be listed. Paste a link instead.");
    else {
      const allow = reply.code === "scope";
      gsNotify("warn", "Couldn't list your sheets. Paste a link instead.", { label: allow ? "Allow access" : "Try again", data: { act: allow ? "allow" : "list" } });
    }
    return $("gsPaste").focus();
  }
  gsFiles = reply.files;
  gsTruncated = reply.truncated;
  $("gsListWrap").hidden = !gsFiles.length;
  $("gsEmpty").hidden = !!gsFiles.length;
  gsRenderList();
}

function openGs(opener) {
  gsOpener = opener;
  gsOpenId++;
  gsRun++;
  gsStopTimers();
  gsFiles = [];
  gsPicked = "";
  gsMeta = gsDraft = null;
  gsSaving = false;
  gsForm.reset();
  gsWait(false);
  gsPane("gsChoose");
  $("gsDialog").showModal();
  gsLoad();
}

// A read or match that failed: back to Choose, with the reason and what to do about it.
function gsFail(reply) {
  gsStopTimers();
  gsWait(false);
  gsPane("gsChoose");
  const known = Object.hasOwn(GS_ERRORS, reply.code);
  const retry = ["network", "timeout", "rate"].includes(reply.code) || !known;
  const text = known ? GS_ERRORS[reply.code] : `Couldn't read that sheet. ${reply.error ?? ""}`.trim();
  const action = retry ? { label: "Retry", quiet: true, data: { act: "retry" } } : reply.code === "signin" ? { label: "Sign in", data: { signin: "" } } : null;
  gsNotify("error", text, action);
  ($("gsNotice").querySelector("button") ?? $("gsList").querySelector(":checked") ?? $("gsPaste")).focus();
}

async function gsContinue() {
  if ($("gsGo").dataset.state === "loading") return;
  const picked = gsFiles.find((f) => f.id === gsPicked);
  const ref = gsPicked ? { id: gsPicked } : parseSheetRef($("gsPaste").value);
  if (ref.error) {
    gsNotify("error", ref.error);
    return $("gsPaste").focus();
  }
  const have = sheets.find((s) => s.id === ref.id);
  if (have) return gsNotify("info", `“${have.name}” is already added.`, { label: "Show it", quiet: true, data: { act: "show", id: have.id } });
  gsNotify("", "");
  const run = ++gsRun;
  gsWait(true, "Reading...");
  $("gsReadMsg").textContent = picked ? `Reading “${clip(picked.name, 32)}”...` : "Reading your sheet...";
  gsPaneTimer = setTimeout(() => run === gsRun && gsPane("gsRead"), 250); // no flash when it is quick
  const meta = await send({ action: "readSpreadsheetMeta", id: ref.id });
  if (run !== gsRun) return;
  if (!meta.success) return gsFail(meta);
  gsMeta = meta;
  gsMatch(false, run);
}

// The AI step, or titles alone (skipAi: the user chose that). "Try AI again" runs it again on what was read.
async function gsMatch(skipAi, run = ++gsRun) {
  clearTimeout(gsAiTimer);
  $("gsSkipAi").hidden = true;
  const ai = hasKey && !skipAi;
  $("gsReadMsg").textContent = ai ? "Matching columns with AI..." : "Matching columns...";
  if (ai) {
    gsAiTimer = setTimeout(() => {
      $("gsReadMsg").textContent = "Still working. AI can take about 30 seconds.";
      $("gsSkipAi").hidden = false;
    }, 5000);
  }
  const { id, title, tabs, skipped } = gsMeta;
  const reply = await send({ action: "mapSheet", data: { id, title, tabs, skipped, skipAi } });
  if (run !== gsRun) return;
  if (!reply.success) return gsFail(reply);
  gsStopTimers();
  gsDraft = reply.draft;
  gsWait(false);
  gsPane("gsMap");
  gsShowMap();
}

/* Map */

const gsCols = (tab) => gsDraft.tabs.find((t) => t.name === tab)?.columns ?? [];
const gsTabOf = (scope) => $(scope === "inv" ? "gsInvTab" : "gsOrdTab");
const gsKind = (scope) => (scope === "inv" ? "inventory" : "orders");
// Would AliSwift's write to this column replace a formula in the tab chosen? (The importmap.js rule.)
const gsClash = (r, letter) => formulaClash(gsKind(r.scope), r.key, letter, gsDraft.tabs.find((t) => t.name === gsTabOf(r.scope).value)?.formulas ?? []);

// Every select of a scope: the columns of the tab chosen, set to the matched one.
function gsFill(scope, fields) {
  const cols = gsCols(gsTabOf(scope).value);
  for (const r of GS_ROWS.filter((x) => x.scope === scope)) {
    const sel = gsForm.elements[r.name];
    const f = fields[r.key] ?? { letter: "", conf: "none" };
    sel.replaceChildren(new Option(r.required ? "Choose a column" : "Not used", ""), ...cols.map((c) => new Option(clip(`${c.letter} · ${c.header || "(no header)"}`), c.letter)));
    sel.value = f.letter;
    setTag($(`gs-c-${r.name}`), f.formula || gsClash(r, f.letter) ? "formula" : f.conf, r.required);
  }
}

// The tab chosen in one tab select is not offered in the other.
function gsLockTabs() {
  for (const scope of ["inv", "ord"]) {
    for (const o of gsTabOf(scope).options) o.disabled = !!o.value && o.value === gsTabOf(scope === "inv" ? "ord" : "inv").value;
  }
}

// Checks what the form can't say by itself and keeps the notice, the counts and Add sheet in step.
// Returns the required columns still missing, per scope.
function gsValidate() {
  const ordOn = !!$("gsOrdTab").value;
  const miss = { inv: [], ord: [] };
  for (const r of GS_ROWS) {
    const sel = gsForm.elements[r.name];
    const on = r.scope === "inv" || ordOn;
    sel.required = !!r.required && on;
    const dupe = on && sel.value && GS_ROWS.some((o) => o !== r && o.scope === r.scope && gsForm.elements[o.name].value === sel.value);
    const empty = sel.required && !sel.value;
    const formula = on && r.required && r.key !== "salePriceCol" && gsClash(r, sel.value); // optional ones are left unused when saved
    sel.setCustomValidity(
      empty ? `Choose a column for ${r.label}.` : formula ? `Column ${sel.value} holds formulas, and AliSwift writes values there. Choose another column.` : dupe ? "Each field needs its own column." : "",
    );
    if (empty) miss[r.scope].push(r.label);
  }
  $("gsInvTab").setCustomValidity($("gsInvTab").value ? "" : "Choose the Inventory tab.");
  checkName($("gsName"));
  $("gsFormulaNote").hidden = !GS_ROWS.some((r) => (r.scope === "inv" || ordOn) && $(`gs-c-${r.name}`).dataset.conf === "formula");
  $("gsOrdRowWrap").hidden = $("gsOrdCols").hidden = !ordOn;
  $("gsOrdRow").required = ordOn;
  const optional = COLUMNS.filter((c) => c.optional);
  $("gsInvCount").textContent = `${optional.filter((c) => gsForm.elements[c.key].value).length} of ${optional.length} set`;
  $("gsOrdCount").textContent = `${ORDER_COLS.filter((c) => gsForm.elements[`oc_${c.key}`].value).length} of ${ORDER_COLS.length} set`;

  const list = (m) => (m.length > 1 ? `${m.slice(0, -1).join(", ")} and ${m.at(-1)}` : m[0]);
  const parts = [["Inventory", miss.inv], ["Orders", miss.ord]].filter(([, m]) => m.length);
  const text = parts.length ? `Pick a column for ${parts.map(([scope, m]) => list(m) + (parts.length > 1 ? ` (${scope})` : "")).join(", ")} to continue.` : "";
  setNotice($("gsMissing"), text);
  const go = $("gsGo");
  go.setAttribute("aria-disabled", String(!!text));
  if (text) go.setAttribute("aria-describedby", "gsMissing");
  else go.removeAttribute("aria-describedby");
  if (!text && gsWasMissing) $("gsLive").textContent = "All required columns are set.";
  gsWasMissing = !!text;
  return miss;
}

function gsShowMap() {
  const d = gsDraft;
  gsWasMissing = false;
  $("gsInvTab").replaceChildren(new Option("Choose a tab", ""), ...d.tabs.map((t) => new Option(clip(t.name), t.name)));
  $("gsOrdTab").replaceChildren(new Option("Not used", ""), ...d.tabs.map((t) => new Option(clip(t.name), t.name)));
  $("gsInvTab").value = d.inv.tab;
  $("gsOrdTab").value = d.ord.tab;
  $("gsInvRow").value = d.inv.startRow;
  $("gsOrdRow").value = d.ord.startRow;
  $("gsName").value = d.title.slice(0, 40);
  $("gsRegion").value = d.region;
  $("gsSaveNotice").hidden = true;
  setTag($("gsInvTabC"), d.inv.tabConf, true);
  setTag($("gsOrdTabC"), d.ord.tabConf, false);
  gsLockTabs();
  gsFill("inv", d.inv.fields);
  gsFill("ord", d.ord.fields);

  const ai = d.method === "ai";
  const method = ai ? "Mapped with AI" : "Mapped by matching headers";
  $("gsMethod").dataset.tone = ai ? "blue" : "grey";
  $("gsMethod").innerHTML = (ai ? svgIcon(ICONS.sparkle, 12) : "") + method;
  $("gsAiInfo").hidden = !ai;
  $("gsReason").textContent = GS_REASONS[d.reason] ?? "";
  $("gsReason").hidden = !$("gsReason").textContent;
  $("gsRetryAi").hidden = !GS_RETRY.includes(d.reason);
  const sk = d.skipped;
  $("gsSkipped").hidden = !sk.length;
  $("gsSkipped").textContent = `Skipped ${sk.length} empty ${sk.length === 1 ? "tab" : "tabs"}: ${sk.slice(0, 3).join(", ")}${sk.length > 3 ? ` and ${sk.length - 3} more` : ""}.`;
  $("gsInvMore").open = false;

  const miss = gsValidate();
  $("gsOrdCols").open = !!d.ord.tab && miss.ord.length > 0;
  const rows = GS_ROWS.filter((r) => r.scope === "inv" || d.ord.tab);
  const found = rows.filter((r) => gsForm.elements[r.name].value).length;
  const need = miss.inv.length + miss.ord.length;
  $("gsLive").textContent = `${method}. ${found} of ${rows.length} columns matched.${need ? ` ${need} required ${need === 1 ? "column needs" : "columns need"} a match.` : ""}`;
  $("gsName").focus();
}

// A tab changed: its columns are matched again by title (no AI) and the selects that moved flash.
function gsTabChanged(scope) {
  const name = gsTabOf(scope).value;
  const els = GS_ROWS.filter((r) => r.scope === scope).map((r) => gsForm.elements[r.name]);
  const before = els.map((el) => el.value);
  const matched = name ? matchTab({ headers: gsCols(name).map((c) => c.header) }, gsKind(scope)) : {};
  gsFill(scope, guardFormulas(gsKind(scope), matched, gsDraft.tabs.find((t) => t.name === name)?.formulas ?? []));
  const changed = els.filter((el, i) => el.value !== before[i]);
  for (const el of changed) el.dataset.flash = "";
  setTimeout(() => changed.forEach((el) => el.removeAttribute("data-flash")), 600);
  const row = gsMeta.tabs.find((t) => t.title === name)?.startRow;
  if (row) $(scope === "inv" ? "gsInvRow" : "gsOrdRow").value = row;
  setTag($(scope === "inv" ? "gsInvTabC" : "gsOrdTabC"), name ? "yours" : "none", scope === "inv");
  gsLockTabs();
  const miss = gsValidate();
  if (scope === "ord") $("gsOrdCols").open = !!name && miss.ord.length > 0;
  $("gsLive").textContent = `${scope === "inv" ? "Inventory" : "Orders"} tab changed. Columns matched again.`;
}

async function gsSave() {
  const id = gsDraft.id;
  setNotice($("gsSaveNotice"), "");
  if (sheets.some((s) => s.id === id)) return setNotice($("gsSaveNotice"), "That sheet is already added.");
  const sheet = { id, ...read(gsForm, GS_KEYS) };
  if (sheet.oTab) sheet.oCols = Object.fromEntries(ORDER_COLS.map((c) => [c.key, gsForm.elements[`oc_${c.key}`].value]));
  else {
    delete sheet.oTab;
    delete sheet.oRow;
  }
  // AliSwift never writes over a formula: an optional column that holds them is left unused, and the sell price is
  // not added to the sheet. (A required column that holds them is refused by gsValidate.)
  const cleared = new Set();
  for (const r of GS_ROWS.filter((x) => x.scope === "inv" || sheet.oTab)) {
    if (!gsClash(r, gsForm.elements[r.name].value)) continue;
    if (r.key === "salePriceCol") sheet.includeSalePrice = false;
    else if (r.scope === "inv") {
      sheet[r.key] = "";
      cleared.add(r.key);
    } else sheet.oCols[r.key] = "";
  }
  // A sheet with no SKU or Image column is asked before it is added whether AliSwift may add them. (A column that was
  // only left out because it holds formulas is not missing.)
  const missing = lacking((k) => sheet[k] || cleared.has(k));
  const answer = missing.length ? await askColumns(missing) : "no";
  if (answer === "back") return $("gsGo").focus();
  gsSaving = true;
  $("gsMap").disabled = true;
  $("gsCancel").setAttribute("aria-disabled", "true");
  gsWait(true, "Adding...");
  const err = await persist([...sheets, sheet], id);
  if (err) {
    gsSaving = false;
    $("gsMap").disabled = false;
    $("gsCancel").removeAttribute("aria-disabled");
    gsWait(false);
    setNotice($("gsSaveNotice"), `Couldn't save: ${err.message}`);
    return $("gsGo").focus();
  }
  render();
  let res = null;
  if (answer === "yes") {
    gsWait(true, "Adding columns...");
    res = await addColumnsTo(id, missing);
  }
  gsAfter = () => chipOf(id)?.querySelector(".select");
  $("gsDialog").close();
  const open = { label: "Open sheet", onClick: () => window.open(sheetUrl(id), "_blank", "noopener") };
  if (res && !res.success) {
    // The sheet is added and works; only the columns are missing, and the sheet's Edit dialog offers them again.
    return toast(`Added “${sheet.name}”, but couldn't add the columns.`, { kind: "error", detail: res.error, action: open });
  }
  toast(res ? `Added “${sheet.name}”. New columns: ${columnsAdded(res)}.` : `Added “${sheet.name}”.`, { action: open });
}

/* Wiring */

const gsRowEl = ({ name, label, optional }) => {
  const tr = document.createElement("tr");
  tr.setAttribute("role", "row");
  tr.innerHTML =
    `<th role="rowheader" scope="row"><label for="gs-${name}">${label}${optional ? ' <span class="muted">(optional)</span>' : ""}</label></th>` +
    `<td role="cell"><select id="gs-${name}" name="${name}" aria-describedby="gs-c-${name}"></select></td>` +
    `<td role="cell" class="conf"><span id="gs-c-${name}" class="tag"></span></td>`;
  return tr;
};
$("gsInvRows").replaceChildren(...GS_ROWS.filter((r) => r.scope === "inv" && r.required).map(gsRowEl));
$("gsInvMoreRows").replaceChildren(...GS_ROWS.filter((r) => r.scope === "inv" && !r.required).map(gsRowEl));
$("gsOrdRows").replaceChildren(...GS_ROWS.filter((r) => r.scope === "ord").map((r) => gsRowEl({ ...r, optional: !r.required })));
$("gsRegion").replaceChildren(new Option("Not set", ""), ...regionOptions());

gsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (gsSaving) return;
  if (!$("gsMap").hidden) gsSave();
  else if (!$("gsChoose").hidden) gsContinue();
});

gsForm.addEventListener("input", () => $("gsMap").hidden || gsValidate());

gsForm.addEventListener("change", (e) => {
  const el = e.target;
  if (el.name === "gsPick") {
    gsPicked = el.value;
    $("gsPaste").value = "";
    gsNotify("", "");
    $("gsGo").disabled = false;
  } else if (el.matches("table.map select")) {
    const r = GS_ROWS.find((x) => x.name === el.name);
    setTag($(`gs-c-${r.name}`), el.value ? (gsClash(r, el.value) ? "formula" : "yours") : "none", r.required);
    $("gsRetryAi").hidden = true;
    gsValidate();
  } else if (el === $("gsInvTab") || el === $("gsOrdTab")) {
    $("gsRetryAi").hidden = true;
    gsTabChanged(el === $("gsInvTab") ? "inv" : "ord");
  }
});

// A message can't point at a field inside a closed section, so open the section first.
gsForm.addEventListener(
  "invalid",
  (e) => {
    const section = e.target.closest("details");
    if (section) section.open = true;
  },
  true,
);

$("gsSearch").addEventListener("input", gsRenderList);
$("gsPaste").addEventListener("input", () => {
  if ($("gsPaste").value) {
    gsPicked = "";
    const radio = $("gsList").querySelector(":checked");
    if (radio) radio.checked = false;
  }
  $("gsGo").disabled = !(gsPicked || $("gsPaste").value.trim());
});

$("gsNotice").addEventListener("click", async (e) => {
  const { act, id } = e.target.closest("[data-act]")?.dataset ?? {};
  if (act === "retry") gsContinue();
  if (act === "list") gsLoad();
  if (act === "allow") {
    await send({ action: "signIn" });
    gsLoad();
  }
  if (act === "show") {
    gsAfter = () => chipOf(id)?.querySelector(".select");
    $("gsDialog").close();
  }
});

$("gsSkipAi").addEventListener("click", () => gsMatch(true));
$("gsRetryAi").addEventListener("click", () => {
  gsPane("gsRead");
  gsMatch(false);
});

$("gsBack").addEventListener("click", () => {
  gsRun++;
  gsDraft = null;
  gsPane("gsChoose");
  ($("gsList").querySelector(":checked") ?? $("gsPaste")).focus();
});

$("gsCancel").addEventListener("click", () => gsSaving || $("gsDialog").close());
$("gsDialog").addEventListener("cancel", (e) => gsSaving && e.preventDefault());
$("gsDialog").addEventListener("close", () => {
  gsOpenId++;
  gsRun++;
  gsStopTimers();
  (gsAfter?.() ?? gsOpener)?.focus();
  gsAfter = null;
});

/* AI tab: the Gemini key. It lives in storage.local only: never synced, never exported, never shown back. */

const keyInput = $("geminiKey");
let hasKey = false;

function renderKey(has) {
  hasKey = has;
  keyInput.placeholder = has ? "Saved. Paste a new key to replace it." : "Paste your Gemini API key";
  $("keyState").innerHTML = has
    ? 'Key saved on this device. <button type="button" class="link-btn">Remove key</button>'
    : 'No key saved. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Get one from Google AI Studio</a>.';
}

// A pasted key often carries a space or a newline at its end: it is trimmed when saved.
keyInput.addEventListener("input", () => {
  const v = keyInput.value.trim();
  keyInput.setCustomValidity(!keyInput.value || /^\S{20,200}$/.test(v) ? "" : "That doesn't look like an API key.");
});

$("keyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = keyInput.value.trim();
  if (!key) {
    keyInput.value = "";
    return keyInput.focus();
  }
  try {
    await chrome.storage.local.set({ geminiKey: key });
  } catch {
    return toast("Couldn't save your key.", { kind: "error", action: { label: "Retry", onClick: () => $("keyForm").requestSubmit() } });
  }
  keyInput.value = "";
  renderKey(true);
  flash("Saved");
  toast("Key saved.");
});

$("keyState").addEventListener("click", async (e) => {
  if (!e.target.closest(".link-btn")) return;
  await chrome.storage.local.remove("geminiKey");
  renderKey(false);
  toast("Key removed.");
  keyInput.focus();
});

chrome.storage.onChanged.addListener((changes, area) => area === "local" && changes.geminiKey && renderKey(Boolean(changes.geminiKey.newValue)));
chrome.storage.local.get({ geminiKey: "" }).then(({ geminiKey }) => renderKey(Boolean(String(geminiKey).trim())));

/* AI tab: the model and the listing instructions. Settings, not secrets, so they sync and export.
   Blank means the default: the instructions are stored as "" until the seller edits them. */

const modelInput = $("aiModel");
const instInput = $("aiInstructions");
const aiSaved = { aiModel: "", aiInstructions: "" };

function showAi() {
  modelInput.value = aiSaved.aiModel;
  instInput.value = aiSaved.aiInstructions || DEFAULT_INSTRUCTIONS;
  $("aiCount").textContent = `${instInput.value.length}/6000`;
}

// Shows the new value at once; a failed save puts the old one back.
function saveAi(patch) {
  const before = { ...aiSaved };
  Object.assign(aiSaved, patch);
  showAi();
  return setSync(
    patch,
    () => {
      Object.assign(aiSaved, before);
      showAi();
    },
    () => saveAi(patch),
  );
}

modelInput.addEventListener("change", () => {
  const v = modelInput.value.trim();
  modelInput.setCustomValidity(/^[\w.-]{0,100}$/.test(v) ? "" : "Use a model id from Google, like gemini-3.8-flash.");
  if (!modelInput.reportValidity()) return flash("Not saved", true);
  saveAi({ aiModel: v });
});

instInput.addEventListener("input", () => ($("aiCount").textContent = `${instInput.value.length}/6000`));
instInput.addEventListener("change", () => saveAi({ aiInstructions: instInput.value.trim() === DEFAULT_INSTRUCTIONS ? "" : instInput.value.trim() }));

$("aiReset").addEventListener("click", () => {
  const before = aiSaved.aiInstructions;
  if (!before && instInput.value === DEFAULT_INSTRUCTIONS) return;
  saveAi({ aiInstructions: "" });
  toast("Instructions reset.", { duration: 8000, action: { label: "Undo", onClick: () => saveAi({ aiInstructions: before }) } });
});

// Another tab, or a settings import, changed them.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !("aiModel" in changes || "aiInstructions" in changes)) return;
  for (const key of Object.keys(aiSaved)) if (key in changes) aiSaved[key] = changes[key].newValue ?? "";
  if (document.activeElement !== instInput && document.activeElement !== modelInput) showAi();
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
let pendingLibrary = [];
let pendingPhotos = {};

$("exportBtn").addEventListener("click", async () => {
  try {
    // sheets is always there, so a backup of an empty setup can be imported again.
    const sync = { sheets: [], activeSheetId: "", ...(await chrome.storage.sync.get(EXPORT_KEYS)) };
    // The library and the product photos live on this device only, so the file is the only way they survive a reinstall.
    const { library, photos } = await chrome.storage.local.get({ library: [], photos: {} });
    const file = { app: "aliswift", version: 1, exportedAt: new Date().toISOString(), sync, library, photos };
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
  if (file.size <= 5 * 1024 * 1024) { // room for a full library: LIBRARY_MAX records of up to ~5 KB
    try {
      result = validateImport(JSON.parse(await file.text()));
    } catch {
      result = { ok: false, reason: "json" };
    }
  }
  if (!result.ok) return setNotice($("importNotice"), IMPORT_ERRORS[result.reason]);
  pendingImport = result.sync;
  pendingLibrary = result.library ?? [];
  pendingPhotos = result.photos ?? {};
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
  let added = 0;
  try {
    // First, and only ever adding: a failure here leaves the sheets as they were.
    if (pendingLibrary.length || Object.keys(pendingPhotos).length) {
      const res = await chrome.runtime.sendMessage({ action: "importLibrary", library: pendingLibrary, photos: pendingPhotos });
      if (!res?.success) throw new Error(res?.error ?? "No answer from the extension.");
      added = res.added;
    }
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
  if ("includeImages" in next) {
    $("includeImages").checked = next.includeImages;
    imagesNoteFor(next.includeImages);
  }
  render();
  flash("Saved");
  $("importDialog").close();
  toast(`Imported ${countOf(next.sheets.length)}${added ? ` and ${added} saved ${added === 1 ? "product" : "products"}` : ""}.`);
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

// Include images: switching it on asks for the optional Downloads permission, in the same click so it counts as the seller's.
// Without it the photos can still be attached to eBay's form; they just can't be saved to a folder when that fails.
function showImagesNote(on, granted) {
  $("imagesNote").textContent = !on
    ? ""
    : granted
      ? "Downloads allowed: the download button on AliExpress saves gallery and variant photos to your Downloads folder, and Create Listing attaches photos to eBay forms."
      : "Downloads permission was not allowed. Switch this off and on to prompt for permission.";
}

async function saveIncludeImages(on) {
  $("includeImages").checked = on;
  let granted = true;
  if (on) granted = await chrome.permissions.request({ permissions: ["downloads"] }).catch(() => false);
  showImagesNote(on, granted);
  return setSync(
    { includeImages: on },
    () => {
      $("includeImages").checked = !on;
      showImagesNote(!on, true);
    },
    () => saveIncludeImages(on),
  );
}
$("includeImages").addEventListener("change", (e) => saveIncludeImages(e.target.checked));
const imagesNoteFor = async (on) => showImagesNote(on, await chrome.permissions.contains({ permissions: ["downloads"] }).catch(() => false));

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
    includeImages: false,
    homeCurrency: "",
    aiModel: "",
    aiInstructions: "",
  });
  sheets = stored.sheets;
  activeId = stored.activeSheetId;
  homeCurrency = stored.homeCurrency;
  $("showPageButton").checked = stored.showPageButton;
  $("includeImages").checked = stored.includeImages;
  imagesNoteFor(stored.includeImages);
  Object.assign(aiSaved, { aiModel: stored.aiModel, aiInstructions: stored.aiInstructions });
  showAi();
  render();
})();
