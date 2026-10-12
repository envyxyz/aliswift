// What the panels AliSwift puts on eBay's pages share: building elements without markup strings, the icons, and a
// closed shadow root that carries the panel's own stylesheets so eBay's CSS can't reach it and it can't reach eBay's.
// Plain script, no build step, loaded first by the manifest for content-ebay.js and content-orders.js.

const SVG_NS = "http://www.w3.org/2000/svg";
const PATH = {
  bolt: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  more: "M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z",
  ring: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z",
  check: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  warn: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  error: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z",
  copy: "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z",
  go: "M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z",
  spin: "M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
};

// Elements are built here, never from markup strings: every text goes in as text.
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...kids.filter(Boolean));
  return e;
};

const icon = (d, cls, size = 18) => {
  const svg = document.createElementNS(SVG_NS, "svg");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": "true", width: size, height: size, ...(cls && { class: cls }) })) svg.setAttribute(k, v);
  svg.append(path);
  return svg;
};

// Puts `panel` on the page inside a closed shadow root with AliSwift's two stylesheets. Returns the host element.
function mountPanel(id, panel) {
  const host = h("div", { id });
  const root = host.attachShadow({ mode: "closed" });
  root.append(h("link", { rel: "stylesheet", href: chrome.runtime.getURL("lib/ui.css") }), h("link", { rel: "stylesheet", href: chrome.runtime.getURL("ebay.css") }), panel);
  document.body.prepend(host);
  return host;
}

// Copies `value`: the page's clipboard if it allows one, else through a text box. True when it worked.
async function copyToClipboard(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // eBay's permissions policy may refuse the clipboard: copy through a text box instead.
    const box = h("textarea", { style: "position:fixed;opacity:0" });
    box.value = value;
    document.body.append(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    return ok;
  }
}
