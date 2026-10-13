// AliSwift dashboard: the Products and Orders views, and the listing dialog.
// Plain JavaScript, no build step, no dependencies. Loaded after lib/shared.js and lib/ui.js, which provide
// the helpers used here: httpsUrl, formatDate, formatCurrency, marginTone, createStaleGuard, toast, liveSay, copyText.
// Tests (Node) load this file after putting lib/shared.js's exports on globalThis; see test/dashboard.test.js.

// Helper: returns true if the current view supports status column operations
function sheetHasStatus(isLib = isLibraryMode, sheet = activeSheet) {
  return Boolean(isLib || sheet?.statusCol);
}

// Pure helper: row identity key builder
function buildOrderKey(order) {
  if (!order) return "";
  return `${order.orderNumber || ""}|${order.sku || ""}`;
}

// Pure helper: updateOrder payload builder
function buildOrderPatchRequest(sheetId, orderOrNumber, patch, key = {}) {
  const isObj = typeof orderOrNumber === "object" && orderOrNumber !== null;
  const orderNumber = isObj ? orderOrNumber.orderNumber : orderOrNumber;
  const k = isObj
    ? { orderNumber: orderOrNumber.orderNumber, sku: orderOrNumber.sku, row: orderOrNumber.row }
    : key || {};
  const payload = {
    action: "updateOrder",
    sheetId,
    orderNumber,
    patch,
  };
  if (k && (k.sku != null || k.row != null || k.orderNumber != null)) {
    payload.key = k;
  }
  return payload;
}

// Pure helper: setStatus payload builder
function buildSetStatusRequest(sheetId, product, status) {
  return {
    action: "setStatus",
    sheetId,
    key: {
      sku: product.sku,
      row: product.row,
      link: product.link,
      title: product.title,
    },
    status,
  };
}

// Pure helper: the fields the Edit order dialog changed. Empty when nothing did, and then nothing is sent.
function orderEditPatch(initial, current) {
  const patch = {};
  for (const field of ["status", "tracking", "notes"]) {
    if (current[field] !== initial[field]) patch[field] = current[field];
  }
  return patch;
}

// Pure helper: the status Undo writes back. A blank old status is shown as Pending, and "" is never sent.
const undoOrderStatus = (oldStatus) => (ORDER_STATUSES.includes(oldStatus) ? oldStatus : "Pending");

// The key a product's listing is kept under: its SKU, or the AliExpress item number when it has none.
// The same rule as listingKey in background.js, which files the listing.
function listingKeyOf(product) {
  const sku = String(product?.sku ?? "").trim().slice(0, 40);
  return sku || /(?:\/item\/|[?&]productId=)(\d{6,})/.exec(String(product?.link ?? ""))?.[1] || "";
}

// What the listing writer is given about a product: its name, link, photo and sell price, never the cost price.
function listingProductOf(product) {
  const { sku, title, link, salePrice, image, currency } = product ?? {};
  return { sku, title, link, salePrice, image, currency };
}

// What a failed generateListing reply means to the dialog: the sentence, the detail, whether Try again makes
// sense, and whether the Settings AI tab is the fix. The detail is cut to 140 characters.
function listingError(res) {
  const detail = String(res?.error ?? "").slice(0, 140);
  const generic = { message: "Couldn't write the listing.", detail, retry: true, settings: false };
  if (res?.code === "nokey") return { message: "Add your Gemini key to write listings.", detail: "Paste a key in Settings, on the AI tab.", retry: false, settings: true };
  if (res?.code === "invalid-key") return { message: "That key didn't work.", detail: "Check it in Settings, on the AI tab.", retry: false, settings: true };
  if (res?.status === 404) return { message: "Couldn't write the listing.", detail: `The model “${String(res.model ?? "").slice(0, 60)}” isn't available. Check it in Settings, AI.`, retry: false, settings: true };
  if (res?.code === "rate") return { message: "Gemini says you've reached its limit for now.", detail: "Wait a minute, then try again.", retry: true, settings: false };
  if (res?.code === "timeout") return { ...generic, detail: "It took too long to answer." };
  if (res?.code === "network") return { ...generic, detail: "Couldn't reach Gemini. Check your connection." };
  return generic;
}

// The listing score's band: 75 and up Strong, 50 to 74 Fair, below Weak. null when the model gave no score.
function scoreBand(score) {
  if (!Number.isFinite(score)) return null;
  return score >= 75 ? { tone: "green", word: "Strong" } : score >= 50 ? { tone: "amber", word: "Fair" } : { tone: "red", word: "Weak" };
}

// "Copy all": the title, the item specifics as "Name: value" lines, and the description, with a blank line between.
function listingCopyText({ title, itemSpecifics, description }) {
  return [title, (itemSpecifics ?? []).map((s) => `${s.name}: ${s.value}`).join("\n"), description]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

// Filters products by search query, status, and listing filter
function filterProducts(products, { q = "", status = "active", hasListing = false, hasStatusCol = true, listingsMap = {} } = {}) {
  const query = q.trim().toLowerCase();

  return products.filter((p) => {
    // 1. Search text (name and SKU)
    if (query) {
      const titleMatch = (p.title || "").toLowerCase().includes(query);
      const skuMatch = (p.sku || "").toLowerCase().includes(query);
      if (!titleMatch && !skuMatch) return false;
    }

    // 2. Status filter
    if (hasStatusCol) {
      const pStatus = p.status || "Not Listed";
      if (status === "active") {
        if (pStatus === "Discontinued") return false;
      } else if (status === "Not Listed") {
        if (pStatus !== "Not Listed" && pStatus !== "") return false;
      } else if (status === "Removed") {
        if (pStatus !== "Discontinued") return false;
      } else {
        if (pStatus !== status) return false;
      }
    }

    // 3. Has listing checkbox
    if (hasListing) {
      if (!listingsMap[listingKeyOf(p)]) return false;
    }

    return true;
  });
}

// Sorts products by given key
function sortProducts(products, sortKey = "new") {
  const list = [...products];

  if (sortKey === "name") {
    list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  } else if (sortKey === "price") {
    list.sort((a, b) => {
      const pA = a.salePrice !== null && a.salePrice !== undefined && a.salePrice !== "" && !isNaN(a.salePrice) ? Number(a.salePrice) : -Infinity;
      const pB = b.salePrice !== null && b.salePrice !== undefined && b.salePrice !== "" && !isNaN(b.salePrice) ? Number(b.salePrice) : -Infinity;
      return pB - pA;
    });
  } else if (sortKey === "margin") {
    list.sort((a, b) => {
      const mA = a.margin !== null && a.margin !== undefined && !isNaN(a.margin) ? Number(a.margin) : -Infinity;
      const mB = b.margin !== null && b.margin !== undefined && !isNaN(b.margin) ? Number(b.margin) : -Infinity;
      return mB - mA;
    });
  } else {
    // "new" (by row descending)
    list.sort((a, b) => (Number(b.row) || 0) - (Number(a.row) || 0));
  }

  return list;
}

// Filters orders by search query and status
function filterOrders(orders, { q = "", status = "all" } = {}) {
  const query = q.trim().toLowerCase();

  return orders.filter((o) => {
    // Search query matches orderNumber, sku, product, or notes
    if (query) {
      const numMatch = (o.orderNumber || "").toLowerCase().includes(query);
      const skuMatch = (o.sku || "").toLowerCase().includes(query);
      const prodMatch = (o.product || "").toLowerCase().includes(query);
      const noteMatch = (o.notes || "").toLowerCase().includes(query);
      if (!numMatch && !skuMatch && !prodMatch && !noteMatch) return false;
    }

    // Status filter
    if (status !== "all" && (o.status || "Pending") !== status) {
      return false;
    }

    return true;
  });
}

// Calculates orders totals line (excluding Cancelled orders)
function calculateOrderTotals(orders) {
  let count = 0;
  let units = 0;
  let revenue = 0;
  let profit = 0;

  for (const o of orders) {
    if (o.status === "Cancelled") continue;
    count += 1;
    units += Number(o.qty) || 1;
    revenue += Number(o.sell) || 0;
    profit += Number(o.profit) || 0;
  }

  revenue = round2(revenue);
  profit = round2(profit);
  const marginStr = revenue > 0 ? (Math.round((profit / revenue) * 1000) / 10).toFixed(1) + "%" : "-";

  return {
    ordersCount: count,
    units,
    revenue,
    profit,
    marginStr,
  };
}

// Parses URL hash for view and parameters
function parseHash(hashStr) {
  const h = (hashStr || "").replace(/^#/, "");
  if (!h) return { view: "products", params: {} };

  const [viewPart, queryPart] = h.split("?");
  const view = viewPart === "orders" ? "orders" : "products";
  const params = {};

  if (queryPart) {
    const q = new URLSearchParams(queryPart);
    for (const [k, v] of q.entries()) params[k] = v;
  }

  return { view, params };
}

// Builds URL hash string from view and parameters
function buildHash(view, params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "" && v !== false) {
      q.set(k, String(v));
    }
  }
  const qStr = q.toString();
  return `#${view}${qStr ? "?" + qStr : ""}`;
}

/* ==========================================================================
   Dashboard Page Controller
   ========================================================================== */

let sheets = [];
let activeSheet = null;
let currentProducts = [];
let currentOrders = [];
let listingsCache = {}; // listing:<sheetId>:<key> records of the products on screen, by key
const listingJobs = new Map(); // "<sheetId>:<key>" -> the generateListing request in flight
let isLibraryMode = false;
let authSignedIn = true;
let activeView = "products";
let isRefreshing = false;
let dataAt = 0;
const removingKeys = new Set();

const productsGuard = createStaleGuard();
const ordersGuard = createStaleGuard();

// The sheet a write goes to, read when an action starts so a later sheet switch can't redirect it.
const currentSheetId = () => (isLibraryMode ? "local" : activeSheet?.id);

// Never guesses a currency: the library and a sheet with no marketplace show bare numbers.
function getSheetCurrency() {
  return isLibraryMode ? "" : REGIONS[activeSheet?.region]?.currency || "";
}

function getSheetCurrencySymbol() {
  return isLibraryMode ? "" : REGIONS[activeSheet?.region]?.symbol || "";
}

// Update UI count announcements
function updateCountAnnouncements() {
  const pFiltered = getFilteredProducts();
  const oFiltered = getFilteredOrders();

  const pCountEl = document.getElementById("pCount");
  if (pCountEl) {
    const total = currentProducts.length;
    const shown = pFiltered.length;
    pCountEl.textContent =
      shown === total ? `${total} product${total === 1 ? "" : "s"}` : `${shown} of ${total} products`;
    if (isRefreshing) {
      const up = document.createElement("span");
      up.className = "muted";
      up.textContent = " Updating...";
      pCountEl.append(up);
    }
  }

  const oCountEl = document.getElementById("oCount");
  if (oCountEl) {
    const isLocked = isLibraryMode || !authSignedIn || !activeSheet?.oTab;
    if (isLocked) {
      oCountEl.textContent = "";
    } else {
      const total = currentOrders.length;
      const shown = oFiltered.length;
      oCountEl.textContent =
        shown === total ? `${total} order${total === 1 ? "" : "s"}` : `${shown} of ${total} orders`;
    }
  }
}

// Render offline banner
function renderOfflineBanner(show, timestamp = null) {
  const el = document.getElementById("offline");
  if (!el) return;
  if (!show) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const msgEl = document.getElementById("offlineMsg");
  if (msgEl) {
    const timeStr = formatTime(timestamp || dataAt || Date.now());
    msgEl.textContent = navigator.onLine
      ? `Showing saved copy from ${timeStr}.`
      : `You're offline. Showing saved copy from ${timeStr}.`;
  }
}

// The library products a move would take: removed ones stay where they are.
const movableCount = () => currentProducts.filter((p) => p.status !== "Discontinued").length;

// Render library banner according to design-p2b section 5.3
function renderLibraryBanner() {
  const el = document.getElementById("libraryBanner");
  if (!el) return;

  if (!isLibraryMode) {
    el.hidden = true;
    return;
  }

  el.hidden = false;
  el.innerHTML = "";

  const iconSvg = createSvgPath(
    "16",
    "16",
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"
  );
  el.append(iconSvg);

  const textDiv = document.createElement("div");
  const p = document.createElement("p");
  textDiv.append(p);
  el.append(textDiv);

  if (!authSignedIn) {
    p.textContent = "Your library is saved on this device only.";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-quiet btn-sm";
    btn.dataset.signin = "true";
    btn.textContent = "Sign in";
    el.append(btn);
  } else if (!sheets.length) {
    p.textContent = "Your library is saved on this device only.";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-quiet btn-sm";
    btn.textContent = "Create a sheet";
    btn.onclick = openSettings;
    el.append(btn);
  } else if (movableCount()) {
    const count = movableCount();
    p.textContent = `${count === 1 ? "1 product is" : `${count} products are`} saved on this device only.`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-quiet btn-sm";
    btn.id = "libMoveBtn";
    btn.textContent = "Move to a sheet";
    btn.onclick = openMoveDialog;
    el.append(btn);
  } else {
    p.textContent = "Your library is saved on this device only.";
  }
}

// Update Orders tab locked state and tooltip
function updateTabStates() {
  const oTab = document.getElementById("tab-orders");
  const tipOrders = document.getElementById("tip-orders");
  const addOrderBtn = document.getElementById("addOrderBtn");

  const isLocked = isLibraryMode || !authSignedIn || !activeSheet?.oTab;

  if (oTab) {
    if (isLibraryMode || !authSignedIn) {
      oTab.setAttribute("aria-disabled", "true");
      oTab.classList.add("has-tip");
      oTab.setAttribute("aria-describedby", "tip-orders");
      if (tipOrders) tipOrders.hidden = false;
    } else {
      oTab.removeAttribute("aria-disabled");
      oTab.classList.remove("has-tip");
      oTab.removeAttribute("aria-describedby");
      if (tipOrders) tipOrders.hidden = true;
    }
  }

  if (addOrderBtn) {
    if (isLocked) {
      addOrderBtn.setAttribute("aria-disabled", "true");
    } else {
      addOrderBtn.removeAttribute("aria-disabled");
    }
  }
}

// Switch view tabs
function setView(viewName, updateHash = true) {
  activeView = viewName === "orders" ? "orders" : "products";

  const pTab = document.getElementById("tab-products");
  const oTab = document.getElementById("tab-orders");
  const pPanel = document.getElementById("panel-products");
  const oPanel = document.getElementById("panel-orders");

  if (pTab && oTab && pPanel && oPanel) {
    const isProd = activeView === "products";
    pTab.setAttribute("aria-selected", isProd ? "true" : "false");
    pTab.setAttribute("tabindex", isProd ? "0" : "-1");
    pPanel.hidden = !isProd;

    oTab.setAttribute("aria-selected", !isProd ? "true" : "false");
    oTab.setAttribute("tabindex", !isProd ? "0" : "-1");
    oPanel.hidden = isProd;
  }

  updateTabStates();

  if (updateHash) {
    syncHashFromControls();
  }
}

// Sync controls state into URL hash
function syncHashFromControls() {
  if (activeView === "products") {
    const q = document.getElementById("pSearch")?.value || "";
    const statusRadio = document.querySelector('input[name="pStatus"]:checked');
    const status = statusRadio ? statusRadio.value : "active";
    const listing = document.getElementById("pListing")?.checked || false;
    const sort = document.getElementById("pSort")?.value || "new";

    const params = {};
    if (isLibraryMode) params.src = "local";
    if (q) params.q = q;
    if (status !== "active") params.status = status;
    if (listing) params.listing = "1";
    if (sort !== "new") params.sort = sort;

    const newHash = buildHash("products", params);
    if (window.location.hash !== newHash) {
      history.replaceState(null, "", newHash);
    }
  } else {
    const q = document.getElementById("oSearch")?.value || "";
    const statusRadio = document.querySelector('input[name="oStatus"]:checked');
    const status = statusRadio ? statusRadio.value : "all";

    const params = {};
    if (isLibraryMode) params.src = "local";
    if (q) params.q = q;
    if (status !== "all") params.status = status;

    const newHash = buildHash("orders", params);
    if (window.location.hash !== newHash) {
      history.replaceState(null, "", newHash);
    }
  }
}

// Apply hash parameters to controls safely without CSS selector injection
function applyHashParams() {
  const { view, params } = parseHash(window.location.hash);
  setView(view, false);

  if (view === "products") {
    const pSearch = document.getElementById("pSearch");
    if (pSearch) pSearch.value = params.q || "";

    const wantedStatus = params.status || "active";
    const radio = [...document.querySelectorAll('input[name="pStatus"]')].find(
      (r) => r.value === wantedStatus
    );
    if (radio) radio.checked = true;

    const pListing = document.getElementById("pListing");
    if (pListing) pListing.checked = params.listing === "1";

    const pSort = document.getElementById("pSort");
    if (pSort) pSort.value = params.sort || "new";
  } else {
    const oSearch = document.getElementById("oSearch");
    if (oSearch) oSearch.value = params.q || "";

    const wantedStatus = params.status || "all";
    const radio = [...document.querySelectorAll('input[name="oStatus"]')].find(
      (r) => r.value === wantedStatus
    );
    if (radio) radio.checked = true;
  }
}

// Helper to get filtered products
function getFilteredProducts() {
  const q = document.getElementById("pSearch")?.value || "";
  const statusRadio = document.querySelector('input[name="pStatus"]:checked');
  const status = statusRadio ? statusRadio.value : "active";
  const hasListing = document.getElementById("pListing")?.checked || false;
  const sortKey = document.getElementById("pSort")?.value || "new";
  const hasStatusCol = sheetHasStatus();

  const filtered = filterProducts(currentProducts, {
    q,
    status,
    hasListing,
    hasStatusCol,
    listingsMap: listingsCache,
  });

  return sortProducts(filtered, sortKey);
}

// Helper to get filtered orders
function getFilteredOrders() {
  const q = document.getElementById("oSearch")?.value || "";
  const statusRadio = document.querySelector('input[name="oStatus"]:checked');
  const status = statusRadio ? statusRadio.value : "all";

  const filtered = filterOrders(currentOrders, { q, status });

  // Sorted newest first (date descending, then row descending)
  filtered.sort((a, b) => {
    const dA = parseSheetDate(a.date);
    const dB = parseSheetDate(b.date);
    const tA = dA ? dA.getTime() : 0;
    const tB = dB ? dB.getTime() : 0;
    if (tA !== tB) return tB - tA;
    return (Number(b.row) || 0) - (Number(a.row) || 0);
  });

  return filtered;
}

// Update counts on filter tabs
function updateFilterCounts() {
  // Products counts
  const counts = {
    active: 0,
    "Not Listed": 0,
    Draft: 0,
    Listed: 0,
    Removed: 0,
  };

  for (const p of currentProducts) {
    const s = p.status || "Not Listed";
    if (s === "Discontinued") {
      counts.Removed++;
    } else {
      counts.active++;
      if (s === "Not Listed" || s === "") counts["Not Listed"]++;
      if (s === "Draft") counts.Draft++;
      if (s === "Listed") counts.Listed++;
    }
  }

  const setCnt = (id, n) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(n);
  };

  setCnt("cntActive", counts.active);
  setCnt("cntNotListed", counts["Not Listed"]);
  setCnt("cntDraft", counts.Draft);
  setCnt("cntListed", counts.Listed);
  setCnt("cntRemoved", counts.Removed);

  // Orders counts
  const oCounts = {
    all: currentOrders.length,
    Pending: 0,
    Ordered: 0,
    Shipped: 0,
    Delivered: 0,
    Cancelled: 0,
    Disputed: 0,
  };

  for (const o of currentOrders) {
    const s = o.status || "Pending";
    if (oCounts[s] !== undefined) oCounts[s]++;
  }

  setCnt("cntAllOrders", oCounts.all);
  setCnt("cntPending", oCounts.Pending);
  setCnt("cntOrdered", oCounts.Ordered);
  setCnt("cntShipped", oCounts.Shipped);
  setCnt("cntDelivered", oCounts.Delivered);
  setCnt("cntCancelled", oCounts.Cancelled);
  setCnt("cntDisputed", oCounts.Disputed);
  syncOrderSelect(oCounts);
}

// The status dropdown mirrors the (hidden) radios that hold the filter: same choices, with their counts.
function syncOrderSelect(counts) {
  const select = document.getElementById("oStatusSelect");
  if (!select) return;
  const picked = document.querySelector('input[name="oStatus"]:checked')?.value ?? "all";
  select.replaceChildren(
    ...["all", "Pending", "Ordered", "Shipped", "Delivered", "Cancelled", "Disputed"].map((v) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = `${v === "all" ? "All" : v} (${counts[v] ?? 0})`;
      return o;
    }),
  );
  select.value = picked;
}

// Render Products View
function renderProducts() {
  const container = document.getElementById("productsContainer");
  if (!container) return;
  container.innerHTML = "";

  updateFilterCounts();

  const pStatusGroup = document.getElementById("pStatusGroup");
  if (pStatusGroup) {
    const hasStatus = sheetHasStatus();
    pStatusGroup.hidden = !hasStatus;
    if (!hasStatus) {
      const actRad = document.querySelector('input[name="pStatus"][value="active"]');
      if (actRad) actRad.checked = true;
    }
  }

  const pClear = document.getElementById("pClear");
  const pSearch = document.getElementById("pSearch");
  const statusRadio = document.querySelector('input[name="pStatus"]:checked');
  const hasListing = document.getElementById("pListing")?.checked;

  const isDefaultFilters =
    (!pSearch || !pSearch.value) &&
    (!statusRadio || statusRadio.value === "active") &&
    !hasListing;

  if (pClear) pClear.hidden = isDefaultFilters;

  // Case 1: Sheet has no products
  if (!currentProducts.length) {
    container.append(
      createEmptyState({
        title: "No products yet",
        body: "Save a product from an AliExpress page and it appears here.",
        icon: "shopping_bag",
      })
    );
    updateCountAnnouncements();
    return;
  }

  const filtered = getFilteredProducts();

  // Case 2: Zero results from filters
  if (!filtered.length) {
    const statusVal = statusRadio ? statusRadio.value : "active";
    if (statusVal === "Removed") {
      container.append(
        createEmptyState({
          title: "Nothing removed",
          body: "Products you remove with the x show up here, and you can restore them.",
        })
      );
    } else if (statusVal === "active" && currentProducts.every((p) => p.status === "Discontinued")) {
      container.append(
        createEmptyState({
          title: "Everything here is removed",
          body: "Your active list is empty. Show removed products to restore them.",
          buttonText: "Show removed",
          buttonClass: "btn-quiet",
          onButtonClick: () => {
            const radio = document.querySelector('input[name="pStatus"][value="Removed"]');
            if (radio) {
              radio.checked = true;
              syncHashFromControls();
              renderProducts();
            }
          },
        })
      );
    } else {
      const q = pSearch?.value;
      container.append(
        createEmptyState({
          title: "No matches",
          body: q ? `Nothing found for "${q}".` : "Nothing fits these filters.",
          buttonText: "Clear filters",
          buttonClass: "btn-quiet",
          onButtonClick: clearProductFilters,
        })
      );
    }
    updateCountAnnouncements();
    return;
  }

  // Case 3: Normal grid of cards
  const grid = document.createElement("ul");
  grid.className = "grid";
  grid.setAttribute("role", "list");
  grid.setAttribute("aria-label", "Products");

  const currencyCode = getSheetCurrency();
  const isRemovedView = statusRadio && statusRadio.value === "Removed";

  for (const product of filtered) {
    const li = document.createElement("li");
    const card = createProductCard(product, { currencyCode, isRemovedView });
    li.append(card);
    grid.append(li);
  }

  container.append(grid);
  updateCountAnnouncements();
}

// Create a single Product Card element
function createProductCard(product, { currencyCode = "", isRemovedView = false }) {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.key = product.sku || `row-${product.row}`;
  card.dataset.status = product.status || "Not Listed";
  card.setAttribute("aria-labelledby", `n-${product.row}`);

  // 1. Media
  const media = document.createElement("div");
  media.className = "card-media";

  const safeImg = httpsUrl(product.image);
  if (safeImg) media.append(createProductImage(safeImg, media, product.link));
  else media.append(createImagePlaceholder());

  // Slot start: Status control
  const slotStart = document.createElement("div");
  slotStart.className = "title-row card-slot";
  slotStart.dataset.pos = "start";

  const hasStatusCol = sheetHasStatus();
  if (hasStatusCol) {
    if (product.statusShared) {
      // Read-only tag for merged variant rows
      const tag = document.createElement("span");
      tag.className = "tag has-tip";
      tag.tabIndex = 0;
      tag.dataset.tone = getStatusTone(product.status);
      const tipId = `tip-ro-${product.row}`;
      tag.setAttribute("aria-describedby", tipId);

      const lockSvg = createSvgPath(
        "12",
        "12",
        "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"
      );
      tag.append(lockSvg);

      const label = document.createElement("span");
      label.textContent = product.status || "Not listed";
      tag.append(label);

      const sr = document.createElement("span");
      sr.className = "sr-only";
      sr.textContent = ", read only";
      tag.append(sr);

      const tip = document.createElement("span");
      tip.id = tipId;
      tip.className = "tip";
      tip.setAttribute("role", "tooltip");
      tip.textContent = "This status is shared by other variant rows. Change it in the sheet.";

      slotStart.append(tag, tip);
    } else {
      // Editable status select tag
      const statusWrap = document.createElement("span");
      statusWrap.className = "status";
      statusWrap.dataset.tone = getStatusTone(product.status);

      const sel = document.createElement("select");
      sel.setAttribute("aria-label", `Status of ${product.sku || product.title}`);

      const statuses = PRODUCT_STATUSES.map((val) => ({
        val,
        label: { "Not Listed": "Not listed", Discontinued: "Removed" }[val] ?? val,
      }));

      const currentStatusVal = product.status || "Not Listed";
      const isKnown = statuses.some((st) => st.val === currentStatusVal);

      for (const st of statuses) {
        const opt = document.createElement("option");
        opt.value = st.val;
        opt.textContent = st.label;
        if (currentStatusVal === st.val) {
          opt.selected = true;
        }
        sel.append(opt);
      }

      if (!isKnown && product.status) {
        const opt = document.createElement("option");
        opt.value = product.status;
        opt.textContent = product.status;
        opt.selected = true;
        sel.append(opt);
        statusWrap.dataset.tone = "grey";
      }

      sel.addEventListener("change", async () => {
        const oldStatus = product.status;
        const newStatus = sel.value;
        const capturedSheetId = currentSheetId();

        if (!isRemovedView && newStatus === "Discontinued") {
          handleRemoveProduct(product, card);
          return;
        }
        if (isRemovedView && newStatus !== "Discontinued") {
          handleRestoreProduct(product, card, newStatus);
          return;
        }

        product.status = newStatus;
        statusWrap.dataset.tone = getStatusTone(newStatus);
        statusWrap.dataset.busy = "true";

        const res = await callSetStatus(capturedSheetId, product, newStatus);
        delete statusWrap.dataset.busy;

        if (!res.success) {
          product.status = oldStatus;
          sel.value = oldStatus || "Not Listed";
          statusWrap.dataset.tone = getStatusTone(oldStatus);
          toast(`Couldn't update status for ${product.sku || "product"}.`, {
            kind: "error",
            detail: res.error,
          });
        } else {
          updateFilterCounts();
        }
      });

      statusWrap.append(sel);
      slotStart.append(statusWrap);
    }
  }
  media.append(slotStart);

  // Slot end: "x" remove button (absent in Removed view)
  if (!isRemovedView) {
    const slotEnd = document.createElement("div");
    slotEnd.className = "title-row card-slot";
    slotEnd.dataset.pos = "end";
    slotEnd.dataset.align = "end";

    const xBtn = document.createElement("button");
    xBtn.type = "button";
    xBtn.className = "icon-btn card-x";
    xBtn.setAttribute("aria-label", `Delete ${product.sku || product.title}`);
    xBtn.append(
      createSvgPath("18", "18", "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z")
    );

    if (!hasStatusCol) {
      xBtn.setAttribute("aria-disabled", "true");
      xBtn.classList.add("has-tip");
      xBtn.setAttribute("aria-describedby", `tip-nox-${product.row}`);

      const tip = document.createElement("span");
      tip.id = `tip-nox-${product.row}`;
      tip.className = "tip";
      tip.setAttribute("role", "tooltip");
      tip.textContent = "This sheet has no Status column, so products can't be removed.";

      xBtn.addEventListener("click", () => {
        toast("This sheet has no Status column, so products can't be removed.", {
          kind: "neutral",
          detail: "Add one in this sheet's settings, under More columns.",
          action: { label: "Open settings", onClick: openSettings },
        });
      });
      slotEnd.append(xBtn, tip);
    } else if (product.statusShared) {
      xBtn.setAttribute("aria-disabled", "true");
      xBtn.classList.add("has-tip");
      xBtn.setAttribute("aria-describedby", `tip-nox-${product.row}`);

      const tip = document.createElement("span");
      tip.id = `tip-nox-${product.row}`;
      tip.className = "tip";
      tip.setAttribute("role", "tooltip");
      tip.textContent = "This status is shared by other variant rows. Change it in the sheet.";

      xBtn.addEventListener("click", () => {
        toast("This status is shared by other variant rows. Change it in the sheet.", {
          kind: "neutral",
        });
      });
      slotEnd.append(xBtn, tip);
    } else {
      xBtn.addEventListener("click", () => {
        openDeleteDialog(product, card, xBtn);
      });
      slotEnd.append(xBtn);
    }

    media.append(slotEnd);
  }

  card.append(media);

  // 2. Body
  const body = document.createElement("div");
  body.className = "card-body";

  // Meta row: SKU & Add Order icon
  const meta = document.createElement("div");
  meta.className = "card-meta";

  if (product.sku) {
    const skuSpan = document.createElement("span");
    skuSpan.className = "card-sku";
    skuSpan.textContent = product.sku;
    meta.append(skuSpan);
  }

  if (activeSheet?.oTab && authSignedIn && !isLibraryMode) {
    const addOrderBtn = document.createElement("button");
    addOrderBtn.type = "button";
    addOrderBtn.className = "icon-btn";
    addOrderBtn.setAttribute("aria-label", `Add order for ${product.sku || product.title}`);
    addOrderBtn.title = "Add order";
    addOrderBtn.append(
      createSvgPath("16", "16", "M11 9h2V6h3V4h-3V1h-2v3H8v2h3v3zm-4 9c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2zm-9.83-3.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.86-7.01L19.42 4h-.01l-1.1 2-2.76 5H8.53l-.13-.27L6.16 6l-.95-2-.94-2H1v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.13 0-.25-.11-.25-.25z")
    );
    addOrderBtn.addEventListener("click", () => openAddOrderDialog(product));
    meta.append(addOrderBtn);
  }

  body.append(meta);

  // Name (2-line clamped h3)
  const name = document.createElement("h3");
  name.className = "card-name";
  name.id = `n-${product.row}`;
  name.title = product.title || "";
  name.textContent = product.title || "Untitled Product";
  body.append(name);

  // Price & Margin row
  const priceRow = document.createElement("div");
  priceRow.className = "card-price";

  // The sell price. A library save has none (the sheet prices it when it is moved), so its saved price is
  // shown instead, marked as the cost it is; a sheet's blank sell price stays "-" and never shows the cost.
  const hasSell = product.salePrice !== null && product.salePrice !== undefined && product.salePrice !== "";
  const shown = hasSell ? product.salePrice : isLibraryMode ? product.price : null;
  const priceSpan = document.createElement("span");
  priceSpan.className = hasSell ? "price" : "price muted";
  priceSpan.textContent = formatCurrency(shown, product.currency || currencyCode, { display: product.currency ? "code" : "symbol" });
  priceRow.append(priceSpan);
  if (!hasSell && shown != null && shown !== "") {
    const costNote = document.createElement("span");
    costNote.className = "note";
    costNote.textContent = "cost";
    priceRow.append(costNote);
  }

  body.append(priceRow);
  card.append(body);

  // 3. Actions
  const actions = document.createElement("div");
  actions.className = "card-actions";

  // "View product"
  const safeProdLink = httpsUrl(product.link);
  if (safeProdLink) {
    const viewBtn = document.createElement("a");
    viewBtn.className = "btn btn-quiet btn-sm";
    viewBtn.href = safeProdLink;
    viewBtn.target = "_blank";
    viewBtn.rel = "noopener";
    viewBtn.textContent = "View product";
    actions.append(viewBtn);
  } else {
    const viewBtn = document.createElement("a");
    viewBtn.className = "btn btn-quiet btn-sm";
    viewBtn.setAttribute("aria-disabled", "true");
    viewBtn.title = "No product link";
    viewBtn.textContent = "View product";
    actions.append(viewBtn);
  }

  // Primary action: Restore (in Removed view) or Create listing
  if (isRemovedView) {
    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "btn btn-sm";
    restoreBtn.textContent = "Restore";
    restoreBtn.addEventListener("click", () => handleRestoreProduct(product, card));
    actions.append(restoreBtn);
  } else {
    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.dataset.lkey = listingKeyOf(product);
    createBtn.setAttribute("aria-haspopup", "dialog");
    // A kept listing opens in the dialog; otherwise the product goes to eBay as a draft, where the panel writes its listing.
    createBtn.addEventListener("click", () => (listingsCache[createBtn.dataset.lkey] || listingJobs.has(`${currentSheetId()}:${createBtn.dataset.lkey}`) ? openListing(product) : listOnEbayFromCard(product)));
    setListingButton(createBtn);
    actions.append(createBtn);
  }

  card.append(actions);
  return card;
}

// Animate card removal smoothly
function animateCardRemoval(card, onComplete) {
  card.classList.add("removing");
  setTimeout(() => {
    card.remove();
    if (onComplete) onComplete();
  }, 160);
}

// Handle card removal ("x")
async function handleRemoveProduct(product, card) {
  const key = product.sku || `row-${product.row}`;
  if (removingKeys.has(key)) return;
  removingKeys.add(key);

  const oldStatus = product.status;
  product.status = "Discontinued";
  const capturedSheetId = currentSheetId();

  const grid = document.querySelector(".grid");
  const cards = grid ? [...grid.querySelectorAll(".card")] : [];
  const idx = cards.indexOf(card);

  animateCardRemoval(card, () => {
    renderProducts();
    const newCards = document.querySelectorAll(".card");
    if (newCards.length > 0) {
      const target = newCards[Math.min(idx, newCards.length - 1)];
      target.setAttribute("tabindex", "-1");
      target.focus();
    } else {
      const g = document.querySelector(".grid");
      if (g) {
        g.setAttribute("tabindex", "-1");
        g.focus();
      } else {
        const emptyHeading = document.querySelector(".empty h3");
        if (emptyHeading) {
          emptyHeading.setAttribute("tabindex", "-1");
          emptyHeading.focus();
        }
      }
    }
  });

  const res = await callSetStatus(capturedSheetId, product, "Discontinued");

  if (!res.success) {
    removingKeys.delete(key);
    product.status = oldStatus;
    if (currentSheetId() === capturedSheetId) {
      renderProducts();
    }
    toast(`Couldn't remove ${product.sku || product.title}.`, {
      kind: "error",
      detail: res.error,
      action: {
        label: "Retry",
        onClick: () => handleRemoveProduct(product, card),
      },
    });
    return;
  }

  // Success toast with 8-second Undo
  const nameLabel = product.sku ? product.sku : `"${(product.title || "").slice(0, 32)}"`;
  toast(`Removed ${nameLabel}.`, {
    duration: 8000,
    action: {
      label: "Undo",
      onClick: async () => {
        const revertTo = oldStatus && oldStatus !== "Discontinued" ? oldStatus : "Not Listed";
        const resUndo = await callSetStatus(capturedSheetId, product, revertTo);
        if (resUndo.success) {
          removingKeys.delete(key);
          product.status = revertTo;
          if (currentSheetId() === capturedSheetId) {
            renderProducts();
          }
        } else {
          toast(`Couldn't undo. ${resUndo.error || ""}`, { kind: "error" });
        }
      },
    },
  });
}

// Handle restoring a product from Removed view
async function handleRestoreProduct(product, card, restoreTo = "Not Listed") {
  const key = product.sku || `row-${product.row}`;
  if (removingKeys.has(key)) return;
  removingKeys.add(key);

  const oldStatus = product.status;
  product.status = restoreTo;
  const capturedSheetId = currentSheetId();

  const grid = document.querySelector(".grid");
  const cards = grid ? [...grid.querySelectorAll(".card")] : [];
  const idx = cards.indexOf(card);

  animateCardRemoval(card, () => {
    renderProducts();
    const newCards = document.querySelectorAll(".card");
    if (newCards.length > 0) {
      const target = newCards[Math.min(idx, newCards.length - 1)];
      target.setAttribute("tabindex", "-1");
      target.focus();
    } else {
      const g = document.querySelector(".grid");
      if (g) {
        g.setAttribute("tabindex", "-1");
        g.focus();
      } else {
        const emptyHeading = document.querySelector(".empty h3");
        if (emptyHeading) {
          emptyHeading.setAttribute("tabindex", "-1");
          emptyHeading.focus();
        }
      }
    }
  });

  const res = await callSetStatus(capturedSheetId, product, restoreTo);
  if (!res.success) {
    removingKeys.delete(key);
    product.status = oldStatus;
    if (currentSheetId() === capturedSheetId) {
      renderProducts();
    }
    toast(`Couldn't restore ${product.sku || product.title}.`, {
      kind: "error",
      detail: res.error,
      action: {
        label: "Retry",
        onClick: () => handleRestoreProduct(product, card, restoreTo),
      },
    });
    return;
  }

  const nameLabel = product.sku ? product.sku : `"${(product.title || "").slice(0, 32)}"`;
  toast(`Restored ${nameLabel}.`, {
    duration: 8000,
    action: {
      label: "Undo",
      onClick: async () => {
        const resUndo = await callSetStatus(capturedSheetId, product, "Discontinued");
        if (resUndo.success) {
          removingKeys.delete(key);
          product.status = "Discontinued";
          if (currentSheetId() === capturedSheetId) {
            renderProducts();
          }
        } else {
          toast(`Couldn't undo. ${resUndo.error || ""}`, { kind: "error" });
        }
      },
    },
  });
}

// Clear product filters
function clearProductFilters() {
  const pSearch = document.getElementById("pSearch");
  if (pSearch) pSearch.value = "";

  const radio = document.querySelector('input[name="pStatus"][value="active"]');
  if (radio) radio.checked = true;

  const pListing = document.getElementById("pListing");
  if (pListing) pListing.checked = false;

  syncHashFromControls();
  renderProducts();
}

// Clear order filters
function clearOrderFilters() {
  const oSearch = document.getElementById("oSearch");
  if (oSearch) oSearch.value = "";

  const radio = document.querySelector('input[name="oStatus"][value="all"]');
  if (radio) radio.checked = true;

  syncHashFromControls();
  renderOrders();
}

// Render Orders View
function renderOrders() {
  const container = document.getElementById("ordersContainer");
  if (!container) return;
  container.innerHTML = "";

  updateFilterCounts();

  const oClear = document.getElementById("oClear");
  const oSearch = document.getElementById("oSearch");
  const statusRadio = document.querySelector('input[name="oStatus"]:checked');
  const isDefaultFilters = (!oSearch || !oSearch.value) && (!statusRadio || statusRadio.value === "all");

  if (oClear) oClear.hidden = isDefaultFilters;

  const currencyCode = getSheetCurrency();

  // Case 1: Library mode or signed out (orders locked)
  if (isLibraryMode || !authSignedIn) {
    const bodyText = !authSignedIn
      ? "Sign in to use orders."
      : "Orders belong to a sheet. Switch to a sheet to see them.";
    container.append(
      createEmptyState({
        title: "Orders need a Google Sheet",
        body: bodyText,
        icon: "receipt_long",
      })
    );
    updateOrderTotals([], currencyCode);
    updateCountAnnouncements();
    return;
  }

  // Case 2: Sheet has no Orders tab configured
  if (!activeSheet?.oTab) {
    container.append(
      createEmptyState({
        title: "Orders aren't set up for this sheet",
        body: "Enter the name of its Orders tab in the sheet's settings.",
        buttonText: "Open settings",
        onButtonClick: openSettings,
        icon: "receipt_long",
      })
    );
    updateOrderTotals([], currencyCode);
    updateCountAnnouncements();
    return;
  }

  // Case 3: No orders in sheet
  if (!currentOrders.length) {
    container.append(
      createEmptyState({
        title: "No orders yet",
        body: "Add an order when a buyer purchases something. It appears here.",
        buttonText: "Add order",
        onButtonClick: () => openAddOrderDialog(),
        icon: "receipt_long",
      })
    );
    updateOrderTotals([], currencyCode);
    updateCountAnnouncements();
    return;
  }

  const filtered = getFilteredOrders();

  // Case 4: Zero results from filters
  if (!filtered.length) {
    container.append(
      createEmptyState({
        title: "No matches",
        body: "No orders match these filters.",
        buttonText: "Clear filters",
        buttonClass: "btn-quiet",
        onButtonClick: clearOrderFilters,
      })
    );
    updateOrderTotals([], currencyCode);
    updateCountAnnouncements();
    return;
  }

  // Case 5: Render Orders table
  const table = document.createElement("table");
  table.className = "orders";
  table.setAttribute("role", "table");
  table.setAttribute("aria-label", "Orders");

  // thead
  const thead = document.createElement("thead");
  thead.setAttribute("role", "rowgroup");
  const trHead = document.createElement("tr");
  trHead.setAttribute("role", "row");

  const headers = [
    { label: "Order", num: false },
    { label: "Product", num: false },
    { label: "Date", num: false },
    { label: "Qty", num: true },
    { label: "Sell", num: true },
    { label: "Profit", num: true },
    { label: "Status", num: false },
    { label: "Tracking", num: false },
    { label: "Actions", num: false, srOnly: true },
  ];

  for (const h of headers) {
    const th = document.createElement("th");
    th.setAttribute("role", "columnheader");
    if (h.num) th.className = "num";
    if (h.srOnly) {
      const sr = document.createElement("span");
      sr.className = "sr-only";
      sr.textContent = h.label;
      th.append(sr);
    } else {
      th.textContent = h.label;
    }
    trHead.append(th);
  }
  thead.append(trHead);
  table.append(thead);

  // tbody
  const tbody = document.createElement("tbody");
  tbody.setAttribute("role", "rowgroup");

  for (const order of filtered) {
    const tr = createOrderRow(order, currencyCode);
    tbody.append(tr);
  }

  table.append(tbody);
  container.append(table);

  // Update totals line
  updateOrderTotals(filtered, currencyCode);
  updateCountAnnouncements();
}

// Create a single order table row
function createOrderRow(order, currencyCode) {
  const tr = document.createElement("tr");
  tr.setAttribute("role", "row");
  tr.setAttribute("tabindex", "-1");
  const rowKey = buildOrderKey(order);
  tr.dataset.key = rowKey;
  tr.dataset.row = String(order.row || "");
  tr.dataset.status = order.status || "Pending";

  // td: Order
  const tdOrder = document.createElement("td");
  tdOrder.setAttribute("role", "cell");
  tdOrder.className = "c-order";
  tdOrder.dataset.label = "Order";
  tdOrder.textContent = order.orderNumber ? `#${order.orderNumber}` : "-";
  tr.append(tdOrder);

  // td: Product
  const tdProd = document.createElement("td");
  tdProd.setAttribute("role", "cell");
  tdProd.className = "c-prod";

  const prodBox = document.createElement("div");
  prodBox.className = "prod";

  const matchedProd = currentProducts.find((p) => p.sku === order.sku);
  const safeImg = httpsUrl(matchedProd?.image);

  // The sheet's photo first; when it is missing or won't load, the product page's share image, else the icon.
  const showThumb = (src, rescue) => {
    const thumb = document.createElement("img");
    thumb.src = src;
    thumb.alt = "";
    thumb.loading = "lazy";
    thumb.referrerPolicy = "no-referrer";
    thumb.onerror = () => {
      const ph = createSmallThumbPlaceholder();
      thumb.replaceWith(ph);
      if (rescue) rescueThumb(matchedProd, (url) => ph.replaceWith(showThumb(url, false)));
    };
    return thumb;
  };
  if (safeImg) prodBox.append(showThumb(safeImg, true));
  else {
    const ph = createSmallThumbPlaceholder();
    prodBox.append(ph);
    rescueThumb(matchedProd, (url) => ph.replaceWith(showThumb(url, false)));
  }

  const textWrap = document.createElement("div");
  const nameEl = document.createElement("div");
  nameEl.className = "name";
  nameEl.textContent = nameEl.title = order.product || matchedProd?.title || "-";
  textWrap.append(nameEl);

  if (order.sku) {
    const subEl = document.createElement("div");
    subEl.className = "sub";
    subEl.textContent = order.sku;
    textWrap.append(subEl);
  }
  prodBox.append(textWrap);
  tdProd.append(prodBox);
  tr.append(tdProd);

  // td: Date
  const tdDate = document.createElement("td");
  tdDate.setAttribute("role", "cell");
  tdDate.className = "c-date";
  tdDate.dataset.label = "Date";

  const timeEl = document.createElement("time");
  const pDate = parseSheetDate(order.date);
  if (pDate) {
    timeEl.setAttribute("datetime", formatDateAttr(order.date));
    timeEl.textContent = formatDate(pDate);
    timeEl.title = pDate.toLocaleDateString();
  } else {
    timeEl.textContent = "-";
  }
  tdDate.append(timeEl);
  tr.append(tdDate);

  // td: Qty
  const tdQty = document.createElement("td");
  tdQty.setAttribute("role", "cell");
  tdQty.className = "num c-qty";
  tdQty.dataset.label = "Qty";
  tdQty.textContent = String(order.qty !== undefined && order.qty !== null && order.qty !== "" ? order.qty : 1);
  tr.append(tdQty);

  // td: Sell
  const tdSell = document.createElement("td");
  tdSell.setAttribute("role", "cell");
  tdSell.className = "num c-sell";
  tdSell.dataset.label = "Sell";
  tdSell.textContent = formatCurrency(order.sell, currencyCode);
  tr.append(tdSell);

  // td: Profit
  const tdProfit = document.createElement("td");
  tdProfit.setAttribute("role", "cell");
  tdProfit.className = "num c-profit";
  tdProfit.dataset.label = "Profit";
  if (order.profit === "" || order.profit == null) {
    const sp = document.createElement("span");
    sp.className = "muted";
    sp.textContent = "-";
    tdProfit.append(sp);
  } else {
    const profNum = Number(order.profit);
    if (isNaN(profNum)) {
      const sp = document.createElement("span");
      sp.className = "muted";
      sp.textContent = "-";
      tdProfit.append(sp);
    } else if (profNum < 0) {
      tdProfit.dataset.neg = "true";
      tdProfit.textContent = `-${formatCurrency(Math.abs(profNum), currencyCode)}`;
    } else {
      tdProfit.textContent = formatCurrency(profNum, currencyCode);
    }
  }
  tr.append(tdProfit);

  // td: Status
  const tdStatus = document.createElement("td");
  tdStatus.setAttribute("role", "cell");
  tdStatus.className = "c-status";

  const statusWrap = document.createElement("span");
  statusWrap.className = "status";
  statusWrap.dataset.tone = getOrderStatusTone(order.status);

  const sel = document.createElement("select");
  sel.setAttribute("aria-label", `Status of order #${order.orderNumber}`);

  const currentOrdStatus = order.status || "Pending";
  const isKnownOrdStatus = ORDER_STATUSES.includes(currentOrdStatus);

  for (const st of ORDER_STATUSES) {
    const opt = document.createElement("option");
    opt.value = st;
    opt.textContent = st;
    if (currentOrdStatus === st) {
      opt.selected = true;
    }
    sel.append(opt);
  }

  if (!isKnownOrdStatus && order.status) {
    const opt = document.createElement("option");
    opt.value = order.status;
    opt.textContent = order.status;
    opt.selected = true;
    sel.append(opt);
    statusWrap.dataset.tone = "grey";
  }

  async function commit(newStatus) {
    const oldStatus = order.status;
    order.status = newStatus;
    tr.dataset.status = newStatus;
    statusWrap.dataset.tone = getOrderStatusTone(newStatus);
    statusWrap.dataset.busy = "true";

    const capturedSheetId = currentSheetId();
    const res = await callUpdateOrder(capturedSheetId, order, { status: newStatus });
    delete statusWrap.dataset.busy;

    if (!res.success) {
      order.status = oldStatus;
      tr.dataset.status = oldStatus;
      sel.value = oldStatus || "Pending";
      statusWrap.dataset.tone = getOrderStatusTone(oldStatus);
      toast(`Couldn't update order #${order.orderNumber}.`, {
        kind: "error",
        detail: res.error,
        action: {
          label: "Retry",
          onClick: () => {
            sel.value = newStatus;
            tr.dataset.status = newStatus;
            statusWrap.dataset.tone = getOrderStatusTone(newStatus);
            commit(newStatus);
          },
        },
      });
    } else {
      updateFilterCounts();
      updateOrderTotals(getFilteredOrders(), currencyCode);

      if (newStatus === "Cancelled") {
        toast(`Order #${order.orderNumber} cancelled.`, {
          duration: 8000,
          action: {
            label: "Undo",
            onClick: async () => {
              const back = undoOrderStatus(oldStatus); // a blank old status is Pending: "" is never sent
              const resUndo = await callUpdateOrder(capturedSheetId, order, { status: back });
              if (resUndo.success) {
                order.status = back;
                tr.dataset.status = back;
                sel.value = back;
                statusWrap.dataset.tone = getOrderStatusTone(back);
                updateFilterCounts();
                updateOrderTotals(getFilteredOrders(), currencyCode);
              } else {
                toast(`Couldn't undo. ${resUndo.error || ""}`, { kind: "error" });
              }
            },
          },
        });
      }
    }
  }

  sel.addEventListener("change", () => commit(sel.value));

  statusWrap.append(sel);
  tdStatus.append(statusWrap);
  tr.append(tdStatus);

  // td: Tracking
  const tdTrack = document.createElement("td");
  tdTrack.setAttribute("role", "cell");
  tdTrack.className = "c-track";
  tdTrack.dataset.label = "Tracking";
  tdTrack.textContent = order.tracking || "-";
  tr.append(tdTrack);

  // td: Actions
  const tdAct = document.createElement("td");
  tdAct.setAttribute("role", "cell");
  tdAct.className = "c-act";

  const actInner = document.createElement("div");
  actInner.className = "c-act-inner";

  // Edit order button
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "icon-btn";
  editBtn.setAttribute("aria-label", `Edit order #${order.orderNumber}`);
  editBtn.setAttribute("aria-haspopup", "dialog");
  editBtn.append(
    createSvgPath("16", "16", "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z")
  );
  editBtn.addEventListener("click", () => openEditOrderDialog(order, editBtn));
  actInner.append(editBtn);

  // Supplier link
  const supLink = httpsUrl(matchedProd?.link);
  if (supLink) {
    const aSup = document.createElement("a");
    aSup.className = "icon-btn";
    aSup.href = supLink;
    aSup.target = "_blank";
    aSup.rel = "noopener";
    aSup.setAttribute("aria-label", "Order from supplier");
    aSup.title = "Order from supplier";
    aSup.append(
      createSvgPath("16", "16", "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z")
    );
    actInner.append(aSup);
  } else {
    const aSup = document.createElement("a");
    aSup.className = "icon-btn";
    aSup.setAttribute("aria-disabled", "true");
    aSup.setAttribute("aria-label", "No supplier link");
    aSup.title = "No supplier link";
    aSup.append(
      createSvgPath("16", "16", "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z")
    );
    actInner.append(aSup);
  }

  tdAct.append(actInner);
  tr.append(tdAct);

  return tr;
}

// Update the totals bar in Orders view
function updateOrderTotals(orders, currencyCode) {
  const totalsBox = document.querySelector("#panel-orders .totals");
  if (!orders || !orders.length) {
    if (totalsBox) totalsBox.hidden = true;
    return;
  }
  if (totalsBox) totalsBox.hidden = false;

  const totals = calculateOrderTotals(orders);

  const tOrders = document.getElementById("totOrders");
  const tUnits = document.getElementById("totUnits");
  const tRev = document.getElementById("totRevenue");
  const tProf = document.getElementById("totProfit");

  if (tOrders) tOrders.textContent = String(totals.ordersCount);
  if (tUnits) tUnits.textContent = String(totals.units);
  if (tRev) tRev.textContent = formatCurrency(totals.revenue, currencyCode);
  if (tProf) tProf.textContent = formatCurrency(totals.profit, currencyCode);
}

// Map product status to tone
function getStatusTone(status) {
  if (status === "Draft") return "amber";
  if (status === "Listed") return "green";
  if (status === "Discontinued") return "grey";
  return "grey"; // "Not Listed" or blank
}

// Map order status to tone
function getOrderStatusTone(status) {
  if (status === "Pending") return "amber";
  if (status === "Ordered" || status === "Shipped") return "blue";
  if (status === "Delivered") return "green";
  if (status === "Cancelled") return "grey";
  if (status === "Disputed") return "red";
  return "grey";
}

// Helper to create empty state section
function createEmptyState({ title, body, buttonText, buttonClass = "", onButtonClick, icon }) {
  const sec = document.createElement("section");
  sec.className = "empty";

  if (icon === "table_chart") {
    sec.append(
      createSvgPath("40", "40", "M10 10.02h5V21h-5zM17 21h3c1.1 0 2-.9 2-2v-9h-5v11zm3-18H5c-1.1 0-2 .9-2 2v3h19V5c0-1.1-.9-2-2-2zM3 19c0 1.1.9 2 2 2h3V10H3v9z")
    );
  } else if (icon === "shopping_bag") {
    sec.append(
      createSvgPath("40", "40", "M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm6 16H6V8h2v2c0 .55.45 1 1 1s1-.45 1-1V8h4v2c0 .55.45 1 1 1s1-.45 1-1V8h2v12z")
    );
  } else if (icon === "receipt_long") {
    sec.append(
      createSvgPath("40", "40", "M19.5 3.5L18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2v14H3v3c0 1.66 1.34 3 3 3h12c1.66 0 3-1.34 3-3V2l-1.5 1.5zM19 19c0 .55-.45 1-1 1s-1-.45-1-1v-1h2v1zm0-3.5h-4V5h4v10.5zM9 7h6v2H9V7zm0 3h6v2H9v-2zm7 3H9v2h7v-2z")
    );
  } else if (icon === "error") {
    sec.dataset.tone = "error";
    sec.setAttribute("role", "alert");
    sec.append(
      createSvgPath("40", "40", "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z")
    );
  }

  const h3 = document.createElement("h3");
  h3.textContent = title;
  sec.append(h3);

  const p = document.createElement("p");
  p.textContent = body;
  sec.append(p);

  if (buttonText && onButtonClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn ${buttonClass}`.trim();
    btn.textContent = buttonText;
    btn.addEventListener("click", onButtonClick);
    sec.append(btn);
  }

  return sec;
}

// Helpers for SVGs
function createSvgPath(w, h, d) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

// The photo of a card (the sheet's link comes first); when it won't load, the placeholder takes its place and the product's
// share image is asked for (see backfillPhotos), which replaces the placeholder if the product's page has one.
let brokenTimer;
function createProductImage(src, media, link) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.onload = () => {
    img.dataset.loaded = "true";
  };
  img.onerror = () => {
    img.remove();
    media.prepend(createImagePlaceholder());
    if (link && !photoAsked.has(link)) {
      broken.add(link);
      clearTimeout(brokenTimer); // one request for the cards that fail together
      brokenTimer = setTimeout(() => photoToken && backfillPhotos(currentSheetId(), photoToken), 400);
    }
  };
  return img;
}

function createImagePlaceholder() {
  const ph = document.createElement("div");
  ph.className = "card-ph";
  ph.append(
    createSvgPath("32", "32", "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z")
  );
  return ph;
}

function createSmallThumbPlaceholder() {
  const ph = document.createElement("div");
  ph.className = "ph";
  ph.append(
    createSvgPath("20", "20", "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z")
  );
  return ph;
}

// Render skeleton loading cards
function renderProductsSkeleton() {
  const container = document.getElementById("productsContainer");
  if (!container) return;
  container.innerHTML = "";

  const panel = document.getElementById("panel-products");
  if (panel) {
    panel.setAttribute("aria-busy", "true");
    panel.setAttribute("aria-label", "Loading products");
  }

  const grid = document.createElement("ul");
  grid.className = "grid";
  grid.setAttribute("role", "list");
  grid.setAttribute("aria-hidden", "true");

  for (let i = 0; i < 8; i++) {
    const li = document.createElement("li");
    const card = document.createElement("article");
    card.className = "card skeleton-card";

    const media = document.createElement("div");
    media.className = "skeleton skeleton-media";
    card.append(media);

    const l1 = document.createElement("div");
    l1.className = "skeleton skeleton-line";
    card.append(l1);

    const l2 = document.createElement("div");
    l2.className = "skeleton skeleton-line-sm";
    card.append(l2);

    const act = document.createElement("div");
    act.className = "card-actions";
    const b1 = document.createElement("div");
    b1.className = "skeleton skeleton-btn";
    const b2 = document.createElement("div");
    b2.className = "skeleton skeleton-btn";
    act.append(b1, b2);
    card.append(act);

    li.append(card);
    grid.append(li);
  }

  container.append(grid);
}

// Render skeleton loading rows for orders
function renderOrdersSkeleton() {
  const container = document.getElementById("ordersContainer");
  if (!container) return;
  container.innerHTML = "";

  const panel = document.getElementById("panel-orders");
  if (panel) {
    panel.setAttribute("aria-busy", "true");
    panel.setAttribute("aria-label", "Loading orders");
  }

  const box = document.createElement("div");
  box.setAttribute("aria-hidden", "true");

  for (let i = 0; i < 6; i++) {
    const row = document.createElement("div");
    row.className = "skeleton-row-box";

    const thumb = document.createElement("div");
    thumb.className = "skeleton skeleton-thumb";
    row.append(thumb);

    const lines = document.createElement("div");
    lines.className = "skeleton-row-lines";
    const l1 = document.createElement("div");
    l1.className = "skeleton skeleton-line";
    const l2 = document.createElement("div");
    l2.className = "skeleton skeleton-line-sm";
    lines.append(l1, l2);
    row.append(lines);

    box.append(row);
  }

  container.append(box);
}

/* ==========================================================================
   Backend Message Calls
   ========================================================================== */

async function sendMessage(msg) {
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
    return { success: false, error: "Extension runtime not available." };
  }
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, error: "Empty response from background." });
        }
      });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
}

// Products saved before AliSwift kept photos have none. The worker reads each one's share image from its AliExpress page
// (the picture a chat shows when the link is pasted), keeps it, and answers the ones it found; their cards get the photo in
// place, without redrawing the list. 60 products at a time, and a link is asked about once per visit to this page.
// A card whose sheet photo would not load is in `broken`: its share image is asked for too (the sheet's cell is never changed).
const photoAsked = new Set();
const broken = new Set();
let photoToken;

function showPhoto(product) {
  const card = [...document.querySelectorAll("#productsContainer .card")].find((c) => c.dataset.key === (product.sku || `row-${product.row}`));
  const media = card?.querySelector(".card-media");
  if (!media || media.querySelector("img")) return;
  media.querySelector(".card-ph")?.remove();
  media.prepend(createProductImage(product.image, media, product.link));
}

// The Orders list's thumbnails: a product with no photo, or one that won't load, is asked about once, all together after a
// moment, and `done(url)` runs for each that has a share image.
const thumbAsked = new Set();
let thumbQueue = new Map();
let thumbTimer;
function rescueThumb(product, done) {
  const link = product?.link;
  if (!link || thumbAsked.has(link)) return;
  thumbAsked.add(link);
  thumbQueue.set(link, [...(thumbQueue.get(link) ?? []), done]);
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(async () => {
    const batch = thumbQueue;
    thumbQueue = new Map();
    const links = [...batch.keys()].slice(0, 60);
    const res = await sendMessage({ action: "fillPhotos", sheetId: currentSheetId(), links, retry: links });
    for (const link of links) {
      const url = httpsUrl(res.photos?.[link]);
      if (url) for (const fn of batch.get(link)) fn(url);
    }
  }, 400);
}

async function backfillPhotos(sheetId, token) {
  const wants = (p) => p.link && (!httpsUrl(p.image) || broken.has(p.link)) && !photoAsked.has(p.link);
  const links = [...new Set(currentProducts.filter(wants).map((p) => p.link))].slice(0, 60);
  if (!links.length) return;
  for (const link of links) photoAsked.add(link);
  const res = await sendMessage({ action: "fillPhotos", sheetId, links, retry: links.filter((l) => broken.has(l)) });
  if (!res.success || !productsGuard.isCurrent(token)) return;
  const found = Object.fromEntries(Object.entries(res.photos ?? {}).filter(([, url]) => httpsUrl(url)));
  if (Object.keys(found).length) {
    currentProducts = currentProducts.map((p) => ((!httpsUrl(p.image) || broken.has(p.link)) && found[p.link] ? { ...p, image: found[p.link] } : p));
    for (const p of currentProducts) if (found[p.link]) showPhoto(p);
    if (sheetId !== "local" && chrome.storage?.local) chrome.storage.local.set({ [`cache:${sheetId}`]: { at: dataAt, products: currentProducts } });
  }
  backfillPhotos(sheetId, token); // the next 60, if there are more
}

async function callListProducts(sheetId) {
  return sendMessage({ action: "listProducts", sheetId });
}

async function callSetStatus(sheetId, product, status) {
  return sendMessage(buildSetStatusRequest(sheetId, product, status));
}

async function callListOrders(sheetId) {
  return sendMessage({ action: "listOrders", sheetId });
}

async function callAddOrder(sheetId, orderData) {
  return sendMessage({ action: "addOrder", sheetId, order: orderData });
}

// `order` names the line to change: its order number, SKU and row, so one line of a multi-line order is changed alone.
async function callUpdateOrder(sheetId, order, patch) {
  return sendMessage(buildOrderPatchRequest(sheetId, order, patch));
}

async function callMoveLocal(sheetId) {
  return sendMessage({ action: "moveLocal", sheetId });
}

async function callAuthState() {
  return sendMessage({ action: "authState" });
}

// Open settings page
function openSettings() {
  if (typeof chrome !== "undefined" && chrome.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open("../options/options.html", "_blank");
  }
}

/* ==========================================================================
   Dialogs (Order Edit, Add Order & Move to Sheet)
   ========================================================================== */

let originFocusedElement = null;
let editingOrder = null; // the Edit order dialog's line: { sheetId, line: { orderNumber, sku, row }, initial: { status, tracking, notes } }

function openEditOrderDialog(order, originBtn) {
  originFocusedElement = originBtn;
  const dlg = document.getElementById("orderDialog");
  if (!dlg) return;

  const ordTitle = document.getElementById("ordTitle");
  const ordSub = document.getElementById("ordSub");
  const ordStatus = document.getElementById("ordStatus");
  const ordTrack = document.getElementById("ordTrack");
  const ordNotes = document.getElementById("ordNotes");
  const ordSummary = document.getElementById("ordSummary");
  const ordNotice = document.getElementById("ordNotice");

  if (ordNotice) ordNotice.hidden = true;
  if (ordTitle) ordTitle.textContent = `Order #${order.orderNumber}`;
  if (ordSub) ordSub.textContent = `${order.sku || ""} · ${order.product || ""}`;

  const status = order.status || "Pending";
  if (ordStatus) {
    ordStatus.querySelector("option[data-extra]")?.remove();
    if (!ORDER_STATUSES.includes(status)) {
      const extra = new Option(status, status); // a status the sheet has that AliSwift doesn't offer: keep it selectable
      extra.dataset.extra = "";
      ordStatus.append(extra);
    }
    ordStatus.value = status;
  }
  if (ordTrack) ordTrack.value = order.tracking || "";
  if (ordNotes) ordNotes.value = order.notes || "";

  if (ordSummary) {
    const cur = getSheetCurrency();
    const qty = order.qty || 1;
    const sellStr = formatCurrency(order.sell, cur);
    const profStr = formatCurrency(order.profit, cur);
    ordSummary.textContent = `Quantity ${qty} · Sell ${sellStr} · Profit ${profStr}`;
  }

  editingOrder = {
    sheetId: currentSheetId(),
    line: { orderNumber: order.orderNumber, sku: order.sku, row: order.row },
    initial: { status, tracking: order.tracking || "", notes: order.notes || "" },
  };

  dlg.showModal();
}

let addOrderMatchedProduct = null;

function openAddOrderDialog(prefillProduct = null) {
  if (isLibraryMode || !authSignedIn || !activeSheet || !activeSheet.oTab) return;
  const dlg = document.getElementById("addOrderDialog");
  if (!dlg) return;

  const notice = document.getElementById("aoNotice");
  if (notice) notice.hidden = true;

  const skuIn = document.getElementById("aoSku");
  const noIn = document.getElementById("aoNo");
  const dateIn = document.getElementById("aoDate");
  const qtyIn = document.getElementById("aoQty");
  const sellIn = document.getElementById("aoSell");
  const noteIn = document.getElementById("aoNote");
  const caption = document.getElementById("aoCaption");
  const sellLabel = document.getElementById("aoSellLabel");

  if (sellLabel) {
    sellLabel.textContent = `Sell total (${getSheetCurrencySymbol()})`;
  }

  // Populate datalist
  const list = document.getElementById("aoList");
  if (list) {
    list.innerHTML = "";
    for (const p of currentProducts) {
      if (p.sku) {
        const opt = document.createElement("option");
        opt.value = p.sku;
        opt.label = p.title || p.sku;
        list.append(opt);
      }
    }
  }

  // Set today's date
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;

  if (dateIn) dateIn.value = todayStr;
  if (qtyIn) qtyIn.value = "1";
  if (noIn) noIn.value = "";
  if (noteIn) noteIn.value = "";
  if (sellIn) {
    delete sellIn.dataset.touched;
    sellIn.value = "";
  }

  addOrderMatchedProduct = null;

  const updateProductMatch = () => {
    const text = (skuIn?.value || "").trim().toLowerCase();
    if (!text) {
      if (caption) caption.textContent = "";
      addOrderMatchedProduct = null;
      return null;
    }
    // H8: exact SKU match first; if multiple title matches, do not guess
    let match = currentProducts.find((p) => p.sku && p.sku.toLowerCase() === text);
    if (!match) {
      const titleMatches = currentProducts.filter(
        (p) => p.title && p.title.toLowerCase().includes(text)
      );
      if (titleMatches.length === 1) {
        match = titleMatches[0];
      } else if (titleMatches.length > 1) {
        match = null;
      }
    }

    addOrderMatchedProduct = match;

    if (match) {
      if (caption) caption.textContent = `✓ ${match.title}`;
      if (sellIn && !sellIn.dataset.touched) {
        if (match.salePrice != null && match.salePrice !== "") {
          const unitPrice = Number(match.salePrice) || 0;
          const q = Number(qtyIn?.value) || 1;
          sellIn.value = (unitPrice * q).toFixed(2);
        } else {
          sellIn.value = "";
        }
      }
      return match;
    } else {
      if (caption) {
        caption.textContent = "Not in your product list. The order is still added, but cost stays blank.";
      }
      return null;
    }
  };

  if (skuIn) {
    skuIn.oninput = updateProductMatch;
  }
  if (qtyIn) {
    qtyIn.oninput = () => {
      if (addOrderMatchedProduct && sellIn && !sellIn.dataset.touched) {
        if (addOrderMatchedProduct.salePrice != null && addOrderMatchedProduct.salePrice !== "") {
          const unitPrice = Number(addOrderMatchedProduct.salePrice) || 0;
          const q = Number(qtyIn.value) || 1;
          sellIn.value = (unitPrice * q).toFixed(2);
        } else {
          sellIn.value = "";
        }
      }
    };
  }
  if (sellIn) {
    sellIn.oninput = () => {
      sellIn.dataset.touched = "true";
    };
  }

  if (prefillProduct) {
    if (skuIn) skuIn.value = prefillProduct.sku || prefillProduct.title;
    updateProductMatch();
    dlg.showModal();
    if (noIn) noIn.focus();
  } else {
    if (skuIn) skuIn.value = "";
    if (caption) caption.textContent = "";
    dlg.showModal();
    if (skuIn) skuIn.focus();
  }
}

function openMoveDialog() {
  const dlg = document.getElementById("moveDialog");
  if (!dlg) return;

  const moveSheet = document.getElementById("moveSheet");
  const moveNote = document.getElementById("moveNote");
  const moveSubmit = document.getElementById("moveSubmit");
  const moveRates = document.getElementById("moveRates");

  if (!moveSheet || !moveSubmit) return;

  moveSheet.innerHTML = "";
  for (const s of sheets) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name || "Untitled Sheet";
    moveSheet.append(opt);
  }

  const count = movableCount();
  if (moveNote) {
    moveNote.textContent = `Moves ${count} product${count === 1 ? "" : "s"}. Any already in the sheet are skipped.`;
  }
  moveSubmit.textContent = `Move ${count} product${count === 1 ? "" : "s"}`;

  const renderMoveRates = () => {
    if (!moveRates) return;
    moveRates.innerHTML = "";
    const targetSheet = sheets.find((s) => s.id === moveSheet.value);
    const toCur = REGIONS[targetSheet?.region]?.currency || "";
    if (!toCur) return; // a sheet with no marketplace takes prices as they are: no rate to ask for
    const foreignCurrencies = new Set();
    for (const p of currentProducts.filter((x) => x.status !== "Discontinued")) {
      if (p.currency && p.currency !== toCur) {
        foreignCurrencies.add(p.currency);
      }
    }

    for (const fromCur of foreignCurrencies) {
      const row = document.createElement("div");
      row.className = "rate-row";

      const lbl = document.createElement("label");
      lbl.htmlFor = `mvRate_${fromCur}`;
      lbl.textContent = `1 ${toCur} =`;

      const inp = document.createElement("input");
      inp.id = `mvRate_${fromCur}`;
      inp.inputMode = "decimal";
      inp.placeholder = "0.00";
      inp.setAttribute("aria-describedby", `mvUnit_${fromCur}`);
      inp.dataset.from = fromCur;
      inp.dataset.to = toCur;

      const unit = document.createElement("span");
      unit.id = `mvUnit_${fromCur}`;
      unit.className = "muted";
      unit.textContent = fromCur;

      row.append(lbl, inp, unit);

      const note = document.createElement("p");
      note.className = "note";
      note.textContent = `No rate found for ${fromCur}. Enter one, or those products stay in your library.`;

      moveRates.append(row, note);
    }
  };

  moveSheet.onchange = renderMoveRates;
  renderMoveRates();

  dlg.showModal();
}

// Edit order form: saves what changed in the status, tracking and notes of one line.
function setupOrderForm() {
  const orderForm = document.getElementById("orderForm");
  const ordDlg = document.getElementById("orderDialog");
  const submitBtn = document.getElementById("ordSubmit");

  const closeOrd = (restoreFocus = true) => {
    ordDlg.close();
    if (restoreFocus) {
      if (originFocusedElement?.isConnected) originFocusedElement.focus();
      else document.getElementById("tab-orders")?.focus();
    }
    originFocusedElement = null;
  };
  document.getElementById("ordCancel").onclick = () => closeOrd(true);
  document.getElementById("ordCloseX").onclick = () => closeOrd(true);

  orderForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!editingOrder || submitBtn.getAttribute("aria-disabled") === "true") return;
    const { sheetId, line, initial } = editingOrder;
    const patch = orderEditPatch(initial, {
      status: document.getElementById("ordStatus").value,
      tracking: document.getElementById("ordTrack").value,
      notes: document.getElementById("ordNotes").value,
    });
    if (!Object.keys(patch).length) return closeOrd(true); // nothing changed, so nothing to send

    submitBtn.dataset.state = "loading";
    submitBtn.setAttribute("aria-disabled", "true");
    submitBtn.textContent = "Saving...";
    const res = await callUpdateOrder(sheetId, line, patch);
    delete submitBtn.dataset.state;
    submitBtn.removeAttribute("aria-disabled");
    submitBtn.textContent = "Save";

    if (!res.success) {
      document.getElementById("ordNotice").hidden = false;
      document.getElementById("ordNoticeMsg").textContent = `Couldn't save: ${res.error}`;
      return;
    }
    // Only this line changes on screen, found by its row (the order number can be shared or blank).
    const ord = sheetId === currentSheetId() ? currentOrders.find((o) => o.row === line.row) : null;
    if (ord) Object.assign(ord, patch);
    closeOrd(false);
    renderOrders();
    const editBtn = [...document.querySelectorAll("#ordersContainer tr[data-row]")]
      .find((tr) => tr.dataset.row === String(line.row))
      ?.querySelector('button[aria-haspopup="dialog"]');
    (editBtn ?? document.getElementById("tab-orders")).focus();
  };
}

// Add order form: sends one new order line, then reloads the orders.
function setupAddOrderForm() {
  const form = document.getElementById("addOrderForm");
  const dlg = document.getElementById("addOrderDialog");
  const submitBtn = document.getElementById("aoSubmit");
  document.getElementById("aoCancel").onclick = () => dlg.close();

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (submitBtn.getAttribute("aria-disabled") === "true") return;

    const sheetId = currentSheetId();
    const sku = addOrderMatchedProduct?.sku || document.getElementById("aoSku").value.trim();
    const orderNumber = document.getElementById("aoNo").value.trim();
    const sell = parseFloat(document.getElementById("aoSell").value);
    const order = {
      orderNumber,
      sku,
      date: document.getElementById("aoDate").value,
      qty: parseInt(document.getElementById("aoQty").value || "1", 10),
      notes: document.getElementById("aoNote").value.trim(),
      ...(Number.isFinite(sell) && { sell }),
    };

    submitBtn.dataset.state = "loading";
    submitBtn.setAttribute("aria-disabled", "true");
    submitBtn.textContent = "Adding...";
    const res = await callAddOrder(sheetId, order);
    delete submitBtn.dataset.state;
    submitBtn.removeAttribute("aria-disabled");
    submitBtn.textContent = "Add order";

    const notice = document.getElementById("aoNotice");
    if (!res.success) {
      notice.hidden = false;
      document.getElementById("aoNoticeMsg").textContent =
        res.code === "duplicate" ? `Order #${orderNumber} for ${sku} is already in the sheet.` : `Couldn't add the order: ${res.error}`;
      if (res.code === "duplicate") document.getElementById("aoNo").focus();
      return;
    }
    dlg.close();
    await loadOrdersData();
    const viewOrder = () => {
      setView("orders", true);
      requestAnimationFrame(() => {
        const key = buildOrderKey({ orderNumber, sku });
        const row = [...document.querySelectorAll("#ordersContainer tr[data-key]")].find((tr) => tr.dataset.key === key);
        row?.scrollIntoView({ block: "center" });
        row?.focus();
      });
    };
    toast(`Added order #${orderNumber}.`, {
      detail: res.warning ? "SKU not found in your sheet, so cost is blank." : undefined,
      action: activeView === "products" ? { label: "View orders", onClick: viewOrder } : undefined,
    });
  };
}

// Move to a sheet form: the library's products go into the chosen sheet.
function setupMoveForm() {
  const form = document.getElementById("moveForm");
  const dlg = document.getElementById("moveDialog");
  const cancel = document.getElementById("moveCancel");
  const submit = document.getElementById("moveSubmit");

  cancel.onclick = () => {
    if (cancel.getAttribute("aria-disabled") !== "true") dlg.close();
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (submit.getAttribute("aria-disabled") === "true") return;
    const targetSheetId = document.getElementById("moveSheet").value;
    if (!targetSheetId) return;
    const count = movableCount();
    const label = `Move ${count} product${count === 1 ? "" : "s"}`;

    // Lock the controls and keep Escape from closing the dialog while the move runs.
    submit.dataset.state = "loading";
    submit.setAttribute("aria-disabled", "true");
    submit.textContent = "Moving...";
    cancel.setAttribute("aria-disabled", "true");
    const keepOpen = (evt) => evt.key === "Escape" && evt.preventDefault();
    dlg.addEventListener("keydown", keepOpen);

    // A typed rate is saved first; one that isn't a number above zero is left out and those products stay in the library.
    for (const inp of dlg.querySelectorAll(".rate-row input")) {
      const rate = Number(inp.value.trim());
      if (rate > 0) await sendMessage({ action: "setRate", data: { from: inp.dataset.from, to: inp.dataset.to, rate } });
    }
    const res = await callMoveLocal(targetSheetId);

    delete submit.dataset.state;
    submit.removeAttribute("aria-disabled");
    submit.textContent = label;
    cancel.removeAttribute("aria-disabled");
    dlg.removeEventListener("keydown", keepOpen);

    if (!res.success) {
      toast("Couldn't move your products.", { kind: "error", detail: `${res.error || ""} Your library is unchanged.`.trim() });
      return;
    }
    dlg.close();
    const needs = `${res.needRate} need${res.needRate === 1 ? "s" : ""} a rate.`;
    const parts = [
      res.moved > 0 && `Moved ${res.moved}.`,
      res.skipped > 0 && `${res.skipped} already in the sheet.`,
      res.needRate > 0 && needs,
    ].filter(Boolean);
    toast(res.moved === 0 ? `Nothing moved.${res.needRate ? ` ${needs}` : ""}` : parts.join(" "), { duration: parts.length > 1 ? 8000 : 4000 });
    await refreshAll();
  };
}

let pendingDelete = null;

function openDeleteDialog(product, card, triggerBtn) {
  const dlg = document.getElementById("deleteDialog");
  if (!dlg) {
    handleRemoveProduct(product, card);
    return;
  }
  pendingDelete = { product, card, triggerBtn };
  const sub = document.getElementById("delSub");
  if (sub) {
    const label = product.sku
      ? `${product.sku} · ${product.title || ""}`
      : (product.title || "Selected product");
    sub.textContent = label;
  }
  dlg.showModal();
  const cancelBtn = document.getElementById("delCancel");
  if (cancelBtn) cancelBtn.focus();
}

function setupDeleteDialog() {
  const dlg = document.getElementById("deleteDialog");
  if (!dlg) return;
  const form = document.getElementById("deleteForm");
  const cancelBtn = document.getElementById("delCancel");

  const closeDlg = () => {
    dlg.close();
    if (pendingDelete?.triggerBtn?.isConnected) {
      pendingDelete.triggerBtn.focus();
    }
    pendingDelete = null;
  };

  if (cancelBtn) cancelBtn.onclick = closeDlg;
  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeDlg();
  });

  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!pendingDelete) return;
      const { product, card } = pendingDelete;
      closeDlg();
      handleRemoveProduct(product, card);
    };
  }
}

function setupDialogForms() {
  setupOrderForm();
  setupAddOrderForm();
  setupMoveForm();
  setupListingDialog();
  setupDeleteDialog();
}

/* ==========================================================================
   Listing dialog. One listing per product, written by Gemini in the service worker (generateListing) and kept
   in storage.local; the title and description can be edited here (saveListing). Text only ever goes in with
   textContent or .value.
   ========================================================================== */

const COPY_PATH = "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z";
const CHECK_PATH = "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";
const WARN_PATH = "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z";

// What the dialog is showing: the product, the sheet it belongs to, its kept listing, and which opening this is
// (a reply that comes back to an older opening only updates the cards).
const ls = { session: 0, product: null, sheetId: "", key: "", record: null, rendered: null, timer: 0 };
const lsEl = (id) => document.getElementById(id);
const lsLabel = (product) => product?.sku || String(product?.title ?? "").slice(0, 32) || "product";

// The kept listings of `products`: { key: record }. Only the keys asked for are read.
async function loadListings(sheetId, products) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return {};
  const prefix = `listing:${sheetId}:`;
  const slots = Object.fromEntries(products.map(listingKeyOf).filter(Boolean).map((key) => [prefix + key, null]));
  const found = await chrome.storage.local.get(slots).catch(() => ({}));
  return Object.fromEntries(Object.entries(found).filter(([, record]) => record).map(([slot, record]) => [slot.slice(prefix.length), record]));
}

// A card's listing button: "Create listing" while there is none, "Generating..." while one is being written,
// "View listing" once there is one. The calmer look once the action is no longer needed.
function setListingButton(btn) {
  const key = btn.dataset.lkey;
  const state = listingJobs.has(`${currentSheetId()}:${key}`) ? "busy" : listingsCache[key] ? "view" : "create";
  btn.textContent = { busy: "Generating...", view: "View listing", create: "List on eBay" }[state];
  btn.className = state === "create" ? "btn btn-sm" : "btn btn-quiet btn-sm";
}

function syncListingButtons() {
  for (const btn of document.querySelectorAll("button[data-lkey]")) setListingButton(btn);
}

function copyButton(label, getText) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.setAttribute("aria-label", `Copy ${label}`);
  const copy = createSvgPath("18", "18", COPY_PATH);
  const check = createSvgPath("18", "18", CHECK_PATH);
  copy.classList.add("i-copy");
  check.classList.add("i-check");
  btn.append(copy, check);
  btn.addEventListener("click", () => copyText(getText(), btn, label));
  return btn;
}

function copyRow(label, value, copyLabel, text) {
  const row = document.createElement("div");
  row.className = "copy-row";
  const name = document.createElement("span");
  name.className = "copy-label";
  name.textContent = label;
  value.classList.add("copy-value");
  row.append(name, value, copyButton(copyLabel, () => text));
  return row;
}

// Busy: a notice, the footer's Regenerate spinning and, when there is a listing to protect, the fields locked.
function setListingBusy(on) {
  clearTimeout(ls.timer);
  lsEl("lsBusy").hidden = !on;
  lsEl("lsBusyMsg").textContent = ls.record ? "Writing a new version..." : "Writing your listing...";
  if (on) {
    lsEl("lsError").hidden = true;
    ls.timer = setTimeout(() => (lsEl("lsBusyMsg").textContent = "Still working. A listing with photos can take a minute."), 15000);
  }
  lsEl("lsContent").inert = on;
  const regen = lsEl("lsRegen");
  regen.textContent = on && ls.record ? "Regenerating..." : "Regenerate";
  if (on) regen.dataset.state = "loading";
  else delete regen.dataset.state;
  regen.setAttribute("aria-disabled", String(on));
}

// Regenerate and Copy all need a listing to act on.
function syncListingFooter() {
  lsEl("lsRegen").hidden = lsEl("lsCopyAll").hidden = lsEl("lsEbay").hidden = !ls.record;
}

function showListingError({ message, detail, retry, settings }) {
  setListingBusy(false);
  lsEl("lsError").hidden = false;
  lsEl("lsErrorMsg").textContent = message;
  lsEl("lsErrorDetail").textContent = detail;
  lsEl("lsErrorDetail").hidden = !detail;
  lsEl("lsRetry").hidden = !retry;
  lsEl("lsSettings").hidden = !settings;
  lsEl("lsContent").hidden = !ls.record;
  syncListingFooter();
}

function updateTitleCount() {
  const n = [...lsEl("lsTitleIn").value].length;
  lsEl("lsCount").textContent = `${n}/80`;
  lsEl("lsCountSr").textContent = `${n} of 80 characters`;
}

// Fills the dialog from ls.record.
function renderListing() {
  const { listing, limited, warnings } = ls.record;
  setListingBusy(false);
  lsEl("lsError").hidden = true;
  lsEl("lsLimited").hidden = !limited;
  const notes = (warnings ?? []).filter(Boolean);
  lsEl("lsWarn").hidden = !notes.length;
  lsEl("lsWarnText").textContent = notes.join(" ");

  // The model's own review: a score, a summary and what to check before listing.
  const analysis = listing.analysis ?? {};
  const band = scoreBand(analysis.score);
  const flags = analysis.redFlags ?? [];
  const score = lsEl("lsScore");
  score.hidden = !band;
  if (band) {
    score.dataset.tone = band.tone;
    const prefix = document.createElement("span");
    prefix.className = "sr-only";
    prefix.textContent = "Score ";
    score.replaceChildren(prefix, `${analysis.score} · ${band.word}`);
  }
  lsEl("lsSummary").textContent = analysis.summary ?? "";
  lsEl("lsSummary").hidden = !analysis.summary;
  const flagBox = lsEl("lsFlags");
  if (flags.length) {
    const head = document.createElement("h3");
    head.className = "flags-h";
    head.textContent = "Red flags ";
    const count = document.createElement("span");
    count.className = "muted";
    count.textContent = `(${flags.length})`;
    head.append(count);
    const ul = document.createElement("ul");
    ul.className = "flags";
    ul.setAttribute("role", "list");
    for (const flag of flags) {
      const li = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = flag;
      li.append(createSvgPath("16", "16", WARN_PATH), text);
      ul.append(li);
    }
    flagBox.replaceChildren(head, ul);
  } else if (band) {
    const none = document.createElement("p");
    none.className = "muted";
    none.textContent = "No red flags found.";
    flagBox.replaceChildren(none);
  } else {
    flagBox.replaceChildren();
  }
  lsEl("lsScore").closest("section").hidden = !band && !analysis.summary && !flags.length;

  lsEl("lsTitleIn").value = listing.title ?? "";
  updateTitleCount();
  lsEl("lsDesc").value = listing.description ?? "";

  const specs = listing.itemSpecifics ?? [];
  lsEl("lsSpecs").hidden = !specs.length;
  lsEl("lsSpecList").replaceChildren(
    ...specs.map((s) => {
      const value = document.createElement("span");
      value.textContent = s.value;
      return copyRow(s.name, value, s.name, s.value);
    }),
  );

  const variants = listing.variants ?? [];
  lsEl("lsVariants").hidden = !variants.length;
  const tags = document.createElement("span");
  tags.className = "tags";
  tags.replaceChildren(...variants.map((v) => Object.assign(document.createElement("span"), { className: "tag", textContent: v })));
  const variantRow = copyRow("Variants", tags, "variants", variants.join(", "));
  variantRow.querySelector(".copy-label").classList.add("sr-only");
  lsEl("lsVariantList").replaceChildren(...(variants.length ? [variantRow] : []));

  ls.rendered = ls.record; // the record the title and description fields now show
  lsEl("lsContent").hidden = false;
  syncListingFooter();
}

// Keeps the title and description as edited. Returns false when the save failed (an error toast says why). Saves
// run one after another, so leaving a field and closing the dialog right after don't send the same edit twice.
let listingSaves = Promise.resolve(true);
function saveListingEdits() {
  listingSaves = listingSaves.catch(() => {}).then(writeListingEdits);
  return listingSaves;
}

async function writeListingEdits() {
  const { sheetId, key, rendered: record } = ls; // the fields only ever hold the record that was rendered into them
  if (!record) return true;
  const title = lsEl("lsTitleIn").value;
  const description = lsEl("lsDesc").value;
  if (title === record.listing.title && description === record.listing.description) return true;
  const res = await sendMessage({ action: "saveListing", sheetId, key, title, description });
  if (!res.success) {
    toast("Couldn't save your edits.", { kind: "error", detail: res.error });
    return false;
  }
  record.listing = res.listing;
  record.edited = true;
  return true;
}

// Writes (or re-writes, with `force`) the dialog's product's listing. A request already running for it is joined,
// never sent twice. The result fills the dialog when it still shows this product; otherwise the cards update and
// a toast says it is ready.
async function generateListing(force) {
  const { session, sheetId, key, product } = ls;
  const id = `${sheetId}:${key}`;
  if (!listingJobs.has(id)) {
    const job = sendMessage({ action: "generateListing", sheetId, product: listingProductOf(product), force });
    listingJobs.set(id, job);
    job.finally(() => listingJobs.delete(id));
    liveSay(`Writing listing for ${lsLabel(product)}.`);
  }
  setListingBusy(true);
  syncListingButtons();
  const res = await listingJobs.get(id);

  const dlg = lsEl("listingDialog");
  const shown = dlg.open && ls.key === key && ls.sheetId === sheetId;
  const mine = shown && session === ls.session;
  if (res.success) {
    const { success, cached, key: filed, ...record } = res;
    if (sheetId === currentSheetId()) listingsCache[key] = record;
    syncListingButtons();
    if (mine) {
      ls.record = record;
      renderListing();
      liveSay(`Listing for ${lsLabel(product)} is ready.`);
    } else if (!shown) {
      toast(`Listing ready for ${lsLabel(product)}.`, {
        action: { label: "View listing", onClick: () => openListing(product) },
      });
    }
    return;
  }
  syncListingButtons();
  if (mine) showListingError(listingError(res));
  else if (!shown) {
    const { message, detail } = listingError(res);
    toast(message, { kind: "error", detail, action: { label: "Open", onClick: () => openListing(product) } });
  }
}

// A card's "List on eBay": the product becomes a Draft and eBay's listing start page opens. Its listing is written there, by
// the AliSwift panel, when the seller presses Create listing.
async function listOnEbayFromCard(product) {
  const res = await sendMessage({ action: "listOnEbay", sheetId: currentSheetId(), key: listingKeyOf(product), product: listingProductOf(product), status: product.status });
  if (!res.success) return toast("Couldn't open eBay.", { kind: "error", detail: res.error });
  toast("Opened eBay.", { kind: "neutral", detail: "Choose it in the AliSwift panel and press Create listing." });
  loadProductsData();
}

function openListing(product) {
  const dlg = lsEl("listingDialog");
  const key = listingKeyOf(product);
  const sheetId = currentSheetId();
  Object.assign(ls, { session: ls.session + 1, product, sheetId, key, record: listingsCache[key] ?? null, rendered: null });
  lsEl("lsTitle").textContent = `Listing for ${product.sku || "this product"}`;
  lsEl("lsSub").textContent = product.title || "";
  lsEl("lsConfirm").hidden = true;
  lsEl("lsActions").hidden = false;
  lsEl("lsContent").hidden = true;
  lsEl("lsError").hidden = true;
  lsEl("lsLimited").hidden = true;
  lsEl("lsWarn").hidden = true;
  lsEl("lsBusy").hidden = true;
  syncListingFooter();
  dlg.showModal();

  if (!key) {
    showListingError({ message: "This product has no SKU or AliExpress link to keep a listing under.", detail: "", retry: false, settings: false });
  } else if (listingJobs.has(`${sheetId}:${key}`) || !ls.record) {
    generateListing(false); // joins a running request, or writes the first one
  } else {
    renderListing();
    lsEl("lsTitleIn").focus();
  }
}

function setupListingDialog() {
  const dlg = lsEl("listingDialog");
  lsEl("lsCopyTitleSlot").replaceWith(copyButton("title", () => lsEl("lsTitleIn").value));
  lsEl("lsCopyDescSlot").replaceWith(copyButton("description", () => lsEl("lsDesc").value));

  lsEl("lsCloseX").onclick = lsEl("lsDone").onclick = () => dlg.close();
  // Edits are kept as they are made (on leaving a field) and once more when the dialog closes.
  dlg.addEventListener("close", () => {
    saveListingEdits();
    clearTimeout(ls.timer);
  });
  lsEl("lsTitleIn").addEventListener("input", updateTitleCount);
  for (const id of ["lsTitleIn", "lsDesc"]) lsEl(id).addEventListener("change", saveListingEdits);

  lsEl("lsRetry").onclick = () => generateListing(Boolean(ls.record));

  const askReplace = (on) => {
    lsEl("lsConfirm").hidden = !on;
    lsEl("lsActions").hidden = on;
    (on ? lsEl("lsKeep") : lsEl("lsRegen")).focus();
  };
  lsEl("lsRegen").onclick = () => {
    if (lsEl("lsRegen").getAttribute("aria-disabled") === "true") return;
    const record = ls.rendered ?? ls.record;
    const edited = record.edited || lsEl("lsTitleIn").value !== record.listing.title || lsEl("lsDesc").value !== record.listing.description;
    if (edited) askReplace(true); // a new version replaces the seller's edits: ask first
    else generateListing(true);
  };
  lsEl("lsKeep").onclick = () => askReplace(false);
  lsEl("lsRegenGo").onclick = () => {
    askReplace(false);
    generateListing(true);
  };

  // Remembers this product for the panel on eBay's listing form and opens eBay's listing start page.
  lsEl("lsEbay").onclick = async () => {
    if (!(await saveListingEdits())) return;
    const res = await sendMessage({ action: "listOnEbay", sheetId: ls.sheetId, key: ls.key, product: listingProductOf(ls.product) });
    if (res.success) toast("Opened eBay.", { kind: "neutral", detail: "On the listing page, press Fill form." });
    else toast("Couldn't open eBay.", { kind: "error", detail: res.error });
  };

  lsEl("lsCopyAll").onclick = async (e) => {
    const btn = e.currentTarget;
    if (!(await saveListingEdits())) return;
    const text = listingCopyText({ title: lsEl("lsTitleIn").value, itemSpecifics: ls.record.listing.itemSpecifics, description: lsEl("lsDesc").value });
    if (await copyText(text, btn, "listing")) {
      btn.textContent = "Copied";
      btn.dataset.state = "success";
      setTimeout(() => {
        btn.textContent = "Copy all";
        delete btn.dataset.state;
      }, 1500);
    }
  };
}

/* ==========================================================================
   Data Loading & Synchronization
   ========================================================================== */

async function loadProductsData(cacheOnly = false) {
  const token = productsGuard.next();
  const sheetId = currentSheetId();
  if (!sheetId) {
    currentProducts = [];
    renderProducts();
    updateCountAnnouncements();
    return;
  }

  // 1. Try instant first render from local cache (never read/write cache:local)
  if (!cacheOnly && sheetId !== "local" && typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      const cacheKey = `cache:${sheetId}`;
      const cachedObj = await chrome.storage.local.get([cacheKey]);
      const cache = cachedObj?.[cacheKey];
      if (cache?.products) {
        const listings = await loadListings(sheetId, cache.products);
        if (productsGuard.isCurrent(token)) {
          currentProducts = cache.products;
          listingsCache = listings;
          dataAt = cache.at || 0;
          renderProducts();
        }
      }
    } catch {
      // cache read failed or not supported; ignore
    }
  }

  if (cacheOnly) return;

  // 2. Fetch fresh products from background
  isRefreshing = true;
  updateCountAnnouncements();
  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) {
    refreshBtn.setAttribute("aria-busy", "true");
    const icon = refreshBtn.querySelector("svg");
    if (icon) icon.classList.add("spin");
  }

  // If we had no cache, show skeleton
  if (!currentProducts.length) {
    renderProductsSkeleton();
  }

  const res = await callListProducts(sheetId);

  if (refreshBtn) {
    refreshBtn.removeAttribute("aria-busy");
    const icon = refreshBtn.querySelector("svg");
    if (icon) icon.classList.remove("spin");
  }
  isRefreshing = false;

  const panel = document.getElementById("panel-products");
  if (panel) panel.removeAttribute("aria-busy");

  if (!productsGuard.isCurrent(token)) return; // Ignored stale response

  if (res.success && Array.isArray(res.products)) {
    const listings = await loadListings(sheetId, res.products);
    if (!productsGuard.isCurrent(token)) return;
    listingsCache = listings;
    renderOfflineBanner(false);
    dataAt = Date.now();

    // Nothing to redraw when the list is the same, unless the skeleton or an error is what is showing.
    const isIdentical = currentProducts.length > 0 && JSON.stringify(res.products) === JSON.stringify(currentProducts);
    currentProducts = res.products;

    if (!isIdentical) {
      renderProducts();
    } else {
      updateFilterCounts();
      syncListingButtons();
    }
    if (isLibraryMode) renderLibraryBanner(); // its count is the library's

    // Cache updated products in local storage (never for local library)
    if (sheetId !== "local" && typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({
        [`cache:${sheetId}`]: {
          at: dataAt,
          products: currentProducts,
        },
      });
    }
    photoToken = token;
    backfillPhotos(sheetId, token);
  } else {
    // Failure handling
    if (currentProducts.length) {
      // Cache exists: show offline banner with cached products
      renderOfflineBanner(true);
      renderProducts();
    } else {
      // No cache: show error empty state with two buttons (M11)
      const container = document.getElementById("productsContainer");
      if (container) {
        container.innerHTML = "";
        const empty = createEmptyState({
          title: "Couldn't load your products",
          body: res.error || "Check that the sheet and its tab still exist.",
          buttonText: "Try again",
          onButtonClick: () => loadProductsData(),
          icon: "error",
        });
        const settingsBtn = document.createElement("button");
        settingsBtn.type = "button";
        settingsBtn.className = "btn btn-quiet";
        settingsBtn.textContent = "Open settings";
        settingsBtn.onclick = openSettings;
        empty.append(settingsBtn);
        container.append(empty);
      }
    }
  }
  updateCountAnnouncements();
}

async function loadOrdersData() {
  const token = ordersGuard.next();
  if (isLibraryMode || !activeSheet || !activeSheet.oTab) {
    currentOrders = [];
    renderOrders();
    updateCountAnnouncements();
    return;
  }

  // If empty, show skeleton
  if (!currentOrders.length) {
    renderOrdersSkeleton();
  }

  const res = await callListOrders(activeSheet.id);

  const panel = document.getElementById("panel-orders");
  if (panel) panel.removeAttribute("aria-busy");

  if (!ordersGuard.isCurrent(token)) return;

  if (res.success && Array.isArray(res.orders)) {
    currentOrders = res.orders;
    renderOrders();
  } else {
    if (currentOrders.length) {
      renderOfflineBanner(true);
      renderOrders();
    } else {
      const container = document.getElementById("ordersContainer");
      if (container) {
        container.innerHTML = "";
        const empty = createEmptyState({
          title: "Couldn't load your orders",
          body: res.error || "Check that this sheet still has its Orders tab.",
          buttonText: "Try again",
          onButtonClick: () => loadOrdersData(),
          icon: "error",
        });
        const settingsBtn = document.createElement("button");
        settingsBtn.type = "button";
        settingsBtn.className = "btn btn-quiet";
        settingsBtn.textContent = "Open settings";
        settingsBtn.onclick = openSettings;
        empty.append(settingsBtn);
        container.append(empty);
      }
    }
  }
  updateCountAnnouncements();
}

// Refresh both views
async function refreshAll() {
  await Promise.all([loadProductsData(), loadOrdersData()]);
}

// Forgets everything on screen: after the sheet, the library or the sign-in state changed, nothing of the old view
// may stay (a write must never go to a different sheet than the one the card came from), and a reply still on its
// way for the old view is ignored.
function resetData() {
  currentProducts = [];
  currentOrders = [];
  listingsCache = {};
  dataAt = 0;
  productsGuard.invalidate();
  ordersGuard.invalidate();
  renderOfflineBanner(false);
}

// Reads the sheets from settings and decides what the page shows: the library when signed out, when there is no
// sheet, or when the address says src=local; otherwise the active sheet.
async function applySheets() {
  const stored =
    typeof chrome !== "undefined" && chrome.storage?.sync ? await chrome.storage.sync.get({ sheets: [], activeSheetId: "" }) : {};
  sheets = stored.sheets || [];
  isLibraryMode = !authSignedIn || !sheets.length || parseHash(window.location.hash).params.src === "local";
  activeSheet = isLibraryMode ? null : sheets.find((s) => s.id === stored.activeSheetId) || sheets[0];
  renderSheetPicker();
  renderLibraryBanner();
  updateTabStates();
}

// The account button says when the user signs in or out. Its first answer only repeats what initSheets asked.
async function onAuthChange(e) {
  const next = e.detail.signedIn !== false; // null (couldn't tell) counts as signed in
  if (next === authSignedIn) return;
  authSignedIn = next;
  resetData();
  await applySheets();
  await refreshAll();
}

async function initSheets() {
  let auth = await callAuthState();
  if (auth.success === false) auth = await callAuthState(); // the service worker may still be waking up
  authSignedIn = auth.signedIn !== false; // null (offline, couldn't tell) counts as signed in
  await applySheets();

  const profile = document.getElementById("profile");
  profile.addEventListener("authchange", onAuthChange);
  profileButton(profile);

  await refreshAll();
}

// The link to the active sheet in Google Sheets: a real href, so it can be reached with the keyboard.
function updateSheetLink() {
  const link = document.getElementById("sheetLink");
  link.hidden = isLibraryMode;
  if (activeSheet?.id) link.href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(activeSheet.id)}`;
}

// Render header sheet picker select
function renderSheetPicker() {
  const picker = document.getElementById("sheetPicker");
  const refreshBtn = document.getElementById("refreshBtn");
  picker.replaceChildren();

  picker.hidden = refreshBtn.hidden = !sheets.length && !isLibraryMode;
  document.getElementById("sheetLink").hidden = picker.hidden;
  if (picker.hidden) return;
  updateSheetLink();

  for (const s of sheets) {
    picker.append(new Option(s.name || "Untitled Sheet", s.id, false, !isLibraryMode && s.id === activeSheet?.id));
  }
  picker.append(new Option("Library (on device)", "local", false, isLibraryMode));

  picker.onchange = async () => {
    const picked = picker.value;
    if (!authSignedIn && picked !== "local") picker.value = "local"; // signed out: the library is the only place to look
    isLibraryMode = !authSignedIn || picked === "local";
    activeSheet = isLibraryMode ? null : sheets.find((s) => s.id === picked) || sheets[0];
    if (activeSheet && typeof chrome !== "undefined" && chrome.storage?.sync) chrome.storage.sync.set({ activeSheetId: activeSheet.id });
    resetData();
    renderLibraryBanner();
    updateTabStates();
    updateSheetLink();
    syncHashFromControls(); // keeps src=local in the address, so a reload stays on the library
    await refreshAll();
  };
}

/* ==========================================================================
   Setup Event Listeners
   ========================================================================== */

function setupEventListeners() {
  // Tabs click listeners
  const pTab = document.getElementById("tab-products");
  const oTab = document.getElementById("tab-orders");

  if (pTab) {
    pTab.addEventListener("click", () => setView("products", true));
  }
  if (oTab) {
    oTab.addEventListener("click", () => {
      setView("orders", true);
    });
  }

  // Roving tabindex on .tabs (ArrowLeft, ArrowRight, Home, End per H3)
  const tabsEl = document.querySelector(".dash-main .tabs");
  if (tabsEl) {
    tabsEl.addEventListener("keydown", (e) => {
      const tabList = [document.getElementById("tab-products"), document.getElementById("tab-orders")].filter(Boolean);
      const currIndex = tabList.indexOf(document.activeElement);
      if (currIndex === -1) return;
      let nextIndex = currIndex;
      if (e.key === "ArrowRight") {
        nextIndex = (currIndex + 1) % tabList.length;
      } else if (e.key === "ArrowLeft") {
        nextIndex = (currIndex - 1 + tabList.length) % tabList.length;
      } else if (e.key === "Home") {
        nextIndex = 0;
      } else if (e.key === "End") {
        nextIndex = tabList.length - 1;
      } else {
        return;
      }
      e.preventDefault();
      tabList[nextIndex].focus();
      tabList[nextIndex].click();
    });
  }

  // Filter and Toolbar inputs
  const pSearch = document.getElementById("pSearch");
  if (pSearch) {
    let debounce;
    pSearch.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        syncHashFromControls();
        renderProducts();
        liveSay(document.getElementById("pCount")?.textContent || "");
      }, 300);
    });
  }

  const pStatusRadios = document.querySelectorAll('input[name="pStatus"]');
  for (const radio of pStatusRadios) {
    radio.addEventListener("change", () => {
      syncHashFromControls();
      renderProducts();
    });
  }

  const pListing = document.getElementById("pListing");
  if (pListing) {
    pListing.addEventListener("change", () => {
      syncHashFromControls();
      renderProducts();
    });
  }

  const pSort = document.getElementById("pSort");
  if (pSort) {
    pSort.addEventListener("change", () => {
      syncHashFromControls();
      renderProducts();
    });
  }

  const oSearch = document.getElementById("oSearch");
  if (oSearch) {
    let debounce;
    oSearch.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        syncHashFromControls();
        renderOrders();
        liveSay(document.getElementById("oCount")?.textContent || "");
      }, 300);
    });
  }

  document.getElementById("oStatusSelect")?.addEventListener("change", (e) => {
    const radio = [...document.querySelectorAll('input[name="oStatus"]')].find((r) => r.value === e.target.value);
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event("change"));
    }
  });
  const oStatusRadios = document.querySelectorAll('input[name="oStatus"]');
  for (const radio of oStatusRadios) {
    radio.addEventListener("change", () => {
      syncHashFromControls();
      renderOrders();
    });
  }

  const addOrderBtn = document.getElementById("addOrderBtn");
  if (addOrderBtn) {
    addOrderBtn.addEventListener("click", () => openAddOrderDialog());
  }

  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => refreshAll());
  }

  const settingsBtn = document.getElementById("settingsBtn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", openSettings);
  }

  const offlineRetry = document.getElementById("offlineRetry");
  if (offlineRetry) {
    offlineRetry.addEventListener("click", () => refreshAll());
  }

  // Keyboard shortcut '/' to focus search (L10)
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "/" &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
    ) {
      const openDialog = document.querySelector("dialog[open]");
      if (openDialog) return;
      e.preventDefault();
      const targetSearch =
        activeView === "products" ? document.getElementById("pSearch") : document.getElementById("oSearch");
      if (targetSearch) targetSearch.focus();
    }
  });

  // Coming back to the tab: pick up a sheet added or removed in Settings, then re-read the data. Not while a
  // dialog is open or a status menu is in use.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    if (document.querySelector("dialog[open]") || document.activeElement?.matches?.(".status select")) return;
    const before = currentSheetId();
    await applySheets();
    if (currentSheetId() !== before) resetData();
    refreshAll();
  });

  // Online / offline network events
  window.addEventListener("online", () => {
    renderOfflineBanner(false);
    refreshAll();
  });
  window.addEventListener("offline", () => {
    if (dataAt) renderOfflineBanner(true); // only when there is a copy on screen to call saved
  });

  // Hash navigation
  window.addEventListener("hashchange", () => {
    applyHashParams();
    renderProducts();
    renderOrders();
  });
}

// Global bootstrap
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", async () => {
    setupDialogForms();
    setupEventListeners();
    applyHashParams();
    await initSheets();
  });
}

/* ==========================================================================
   CommonJS Exports for Unit Testing (Node.js test runner)
   ========================================================================== */

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    filterProducts,
    sortProducts,
    filterOrders,
    calculateOrderTotals,
    parseHash,
    buildHash,
    getStatusTone,
    getOrderStatusTone,
    sheetHasStatus,
    buildOrderKey,
    buildOrderPatchRequest,
    buildSetStatusRequest,
    orderEditPatch,
    undoOrderStatus,
    listingKeyOf,
    listingProductOf,
    listingError,
    scoreBand,
    listingCopyText,
  };
}
