const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Just enough DOM for profileButton: elements that record attributes, listeners and dispatched events.
function fakeEl() {
  return {
    dataset: {},
    attrs: {},
    listeners: {},
    events: [],
    children: [],
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    },
    removeAttribute(k) {
      delete this.attrs[k];
    },
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
    dispatchEvent(e) {
      this.events.push(e);
    },
    matches: () => false,
    showPopover() {},
    hidePopover() {},
    set innerHTML(_) {
      this.children = [fakeEl(), fakeEl(), fakeEl()]; // button, menu, status
    },
  };
}

// `replies` maps an action to the answers it gets in turn (the last repeats); an Error answer is a service worker that does not answer.
function setup(replies) {
  const document = Object.assign(fakeEl(), { visibilityState: "visible", querySelectorAll: () => [] });
  const chrome = {
    runtime: {
      sendMessage: async ({ action }) => {
        const queue = replies[action];
        const reply = queue.length > 1 ? queue.shift() : queue[0];
        if (reply instanceof Error) throw reply;
        return reply;
      },
    },
    storage: { onChanged: { addListener() {} } },
  };
  class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  }
  const ctx = vm.createContext({ document, chrome, CustomEvent });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "lib", "ui.js"), "utf8"), ctx);
  const el = fakeEl();
  const set = ctx.profileButton(el);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const signedIn = () => el.events.map((e) => e.detail.signedIn);
  return { el, document, set, flush, signedIn, btn: el.children[0] };
}

test("account button: a probe that can't tell is unknown, not signed out, and never replaces a known state", async () => {
  const t = setup({ authState: [new Error("worker asleep"), { success: true, signedIn: true }, { success: true, signedIn: null }, { success: false }] });
  await t.flush();
  assert.deepEqual(t.signedIn(), [null]); // reported once, so a page can carry on
  assert.equal(t.btn.attrs["aria-label"], "Google account"); // not "Sign in with Google"

  const visible = async () => (t.document.listeners.visibilitychange[0](), t.flush());
  await visible();
  assert.deepEqual(t.signedIn(), [null, true]);
  await visible(); // offline probe
  await visible(); // failed probe
  assert.deepEqual(t.signedIn(), [null, true]);
  assert.equal(t.btn.attrs["aria-label"], "Google account, signed in");
});

test("account button: a save that says 'signin' flips it, and signing in again fires authchange so the popup recovers", async () => {
  const t = setup({ authState: [{ success: true, signedIn: true }], signIn: [{ success: true, signedIn: true }] });
  await t.flush();
  assert.deepEqual(t.signedIn(), [true]);

  t.set(false); // what the popup does when a save is answered with code "signin"
  assert.deepEqual(t.signedIn(), [true, false]);
  assert.equal(t.btn.attrs["aria-label"], "Sign in with Google");

  t.document.listeners.click[0]({ target: { closest: () => ({}) } }); // the popup's "Sign in" button
  await t.flush();
  assert.deepEqual(t.signedIn(), [true, false, true]); // without this, the popup stayed on "Sign in"
});
