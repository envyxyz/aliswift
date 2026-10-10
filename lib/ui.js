// Shared UI behaviour for pages that load lib/ui.css: toasts and tooltip dismissal.
// Plain script, no build step. Needs a <div class="toasts" aria-live="polite"></div> in the page.

const TOAST_ICONS = {
  success: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  error:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z",
  close:
    "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
};

const svgIcon = (d) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;

// toast(message, { kind: "success" | "error", detail, action: { label, onClick } })
// Success toasts close after 4s (paused while hovered or focused). Error toasts stay until dismissed.
function toast(message, { kind = "success", detail, action } = {}) {
  const box = document.querySelector(".toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.dataset.kind = kind;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.innerHTML = svgIcon(TOAST_ICONS[kind]);

  const body = document.createElement("div");
  body.className = "toast-body";
  const msg = document.createElement("p");
  msg.textContent = message;
  body.append(msg);
  if (detail) {
    const d = document.createElement("p");
    d.className = "toast-detail muted";
    d.textContent = detail;
    body.append(d);
  }
  el.append(body);

  let timer;
  const close = () => {
    if (el.classList.contains("leaving")) return;
    clearTimeout(timer);
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 150);
  };
  const arm = () => {
    clearTimeout(timer);
    if (kind === "success") timer = setTimeout(close, 4000);
  };

  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-quiet btn-sm";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      close();
      action.onClick();
    });
    el.append(btn);
  }
  const x = document.createElement("button");
  x.type = "button";
  x.className = "icon-btn";
  x.setAttribute("aria-label", "Dismiss");
  x.innerHTML = svgIcon(TOAST_ICONS.close);
  x.addEventListener("click", close);
  el.append(x);

  for (const t of ["pointerenter", "focusin"]) el.addEventListener(t, () => clearTimeout(timer));
  for (const t of ["pointerleave", "focusout"]) el.addEventListener(t, arm);

  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  arm();
}

// Hides the tooltip that is showing. Returns false when none is.
function dismissTip() {
  const tip = [...document.querySelectorAll(".tip")].find(
    (t) => getComputedStyle(t).visibility === "visible",
  );
  if (!tip) return false;
  tip.previousElementSibling.dataset.dismissed = "";
  return true;
}

// Escape closes the tooltip first, not the dialog around it. A default-prevented keydown stops
// the dialog's close request in Chrome; the cancel listener covers a close request that skips keydown.
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Escape" || !dismissTip()) return;
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);
document.addEventListener(
  "cancel",
  (e) => {
    if (!dismissTip()) return;
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);
for (const type of ["pointerover", "focusin"]) {
  document.addEventListener(type, (e) => e.target.closest?.(".info")?.removeAttribute("data-dismissed"));
}
