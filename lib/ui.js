// Shared UI behaviour for pages that load lib/ui.css: toasts, tooltip dismissal and the Google account button.
// Plain script, no build step. Toasts need a <div class="toasts" aria-live="polite"></div> in the page.

const ICONS = {
  success: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  error:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z",
  close:
    "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  pencil:
    "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  external:
    "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
  warning: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  info: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z",
  sparkle:
    "M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z",
  table: "M10 10.02h5V21h-5zM17 21h3c1.1 0 2-.9 2-2v-9h-5v11zm3-18H5c-1.1 0-2 .9-2 2v3h19V5c0-1.1-.9-2-2-2zM3 19c0 1.1.9 2 2 2h3V10H3v9z",
};

const svgIcon = (d, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;

// toast(message, { kind: "success" | "error", detail, action: { label, onClick } })
// Success toasts close after 4s (paused while hovered or focused). Error toasts stay until dismissed.
function toast(message, { kind = "success", detail, action } = {}) {
  const box = document.querySelector(".toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.dataset.kind = kind;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.innerHTML = svgIcon(ICONS[kind]);

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
  x.innerHTML = svgIcon(ICONS.close);
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
// In a short dialog the tip can sit below the visible part of the scrolling body: bring it into view.
document.addEventListener("focusin", (e) => {
  if (e.target.matches?.(".info")) e.target.nextElementSibling?.scrollIntoView({ block: "nearest" });
});

/* Google account button */

const USER_ICON =
  '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.2c0-3.4 3.2-5.6 7.2-5.6s7.2 2.2 7.2 5.6z"/></svg>';
const PROFILE_NAME = { checking: "Google account", out: "Sign in with Google", busy: "Signing in...", in: "Google account, signed in" };
// A sign-in window the user closed is not a failure worth a menu.
const SIGNIN_CANCELLED = /did not approve|cancel|closed/i;

// Renders the button and its menu into el (an empty <div class="profile">). Reads the state from the
// service worker on load, when the tab becomes visible and when authOff changes. Fires "authchange"
// ({ detail: { signedIn } }, bubbles) on el when the state first resolves and whenever it changes.
// signedIn is true, false, or null when it could not be told (offline): treat null as signed in, never as signed out.
// A later failed probe never replaces a known state. Any [data-signin] element starts the same sign-in and is
// aria-disabled while it runs. Interactive sign-in only ever starts from a click here: the service worker never
// opens a window by itself. Returns set(signedIn), for a page that learns the state another way (a save answered
// code "signin"): the button then agrees with the page, and the sign-in that follows fires "authchange" again.
function profileButton(el) {
  el.innerHTML =
    `<button type="button" class="icon-btn profile-btn" aria-disabled="true">${USER_ICON}</button>` +
    '<div class="menu" popover aria-label="Google account"></div><span class="sr-only" role="status"></span>';
  const [btn, menu, say] = el.children;
  let signedIn; // undefined until the first answer, then true, false or null (couldn't tell)
  let busy = false;

  const render = () => {
    const state = busy ? "busy" : signedIn == null ? "checking" : signedIn ? "in" : "out";
    btn.dataset.state = state === "checking" ? "out" : state;
    btn.setAttribute("aria-label", PROFILE_NAME[state]);
    btn.title = PROFILE_NAME[state];
    btn.setAttribute("aria-disabled", String(state === "checking" || busy));
    if (busy) btn.setAttribute("aria-busy", "true");
    else btn.removeAttribute("aria-busy");
    btn.popoverTargetElement = state === "in" ? menu : null;
    if (!menu.matches(":popover-open")) btn.removeAttribute("aria-expanded");
    for (const b of document.querySelectorAll("[data-signin]")) {
      if (busy) b.setAttribute("aria-disabled", "true");
      else b.removeAttribute("aria-disabled");
    }
  };

  const set = (next) => {
    const changed = next !== signedIn;
    const announce = changed && signedIn != null;
    signedIn = next;
    render();
    if (announce) say.textContent = next ? "Signed in." : "Signed out.";
    if (changed) el.dispatchEvent(new CustomEvent("authchange", { bubbles: true, detail: { signedIn } }));
  };

  const ask = (action) => chrome.runtime.sendMessage({ action }).catch((e) => ({ success: false, error: e.message }));

  async function refresh() {
    const next = (await ask("authState"))?.signedIn ?? null; // no answer is not "signed out"
    if (!busy && (next !== null || signedIn === undefined)) set(next);
  }

  const showMenu = (error) => {
    const out = error !== undefined;
    menu.innerHTML = out
      ? `<p class="menu-label" data-tone="error">${svgIcon(ICONS.error, 16)}Sign-in didn't finish.</p>` +
        (error ? '<p class="menu-detail"></p>' : "") +
        '<button type="button" class="menu-item" data-act="in">Try again</button>'
      : '<p class="menu-label">Signed in with Google</p><button type="button" class="menu-item" data-act="out">Sign out</button>' +
        `<a class="menu-item" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">Manage Google access${svgIcon(ICONS.external, 14)}</a>`;
    if (error) menu.querySelector(".menu-detail").textContent = error;
  };

  async function signIn() {
    if (busy) return;
    busy = true;
    render();
    const res = await ask("signIn");
    busy = false;
    if (res?.success) return set(true);
    set(false);
    const error = String(res?.error ?? "");
    if (SIGNIN_CANCELLED.test(error)) return;
    say.textContent = "Sign-in didn't finish.";
    showMenu(error);
    menu.showPopover();
  }

  async function signOut() {
    menu.hidePopover();
    if (!(await ask("signOut"))?.success) return;
    set(false);
    if (document.querySelector(".toasts")) toast("Signed out.", { detail: "Google access isn't removed." });
  }

  btn.addEventListener("click", () => {
    if (signedIn === false) signIn(); // signed in: the popover button opens the menu. Unknown: nothing yet.
  });
  menu.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "out") signOut();
    if (act === "in") {
      menu.hidePopover();
      signIn();
    }
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-signin]")) signIn();
  });
  menu.addEventListener("beforetoggle", (e) => {
    if (e.newState !== "open") return;
    if (signedIn) showMenu();
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.right = `${document.documentElement.clientWidth - r.right}px`;
  });
  menu.addEventListener("toggle", (e) => btn.setAttribute("aria-expanded", String(e.newState === "open")));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refresh());
  chrome.storage.onChanged.addListener((changes, area) => area === "local" && changes.authOff && refresh());

  render();
  refresh();
  return set;
}
