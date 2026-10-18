# Contributing to AliSwift

AliSwift is small on purpose: plain JavaScript, Manifest V3, no build step, no dependencies. Please keep it that way. A change that removes code is as welcome as one that adds a feature.

## Core Rules

- **Zero dependencies and no build step**: everything is plain JavaScript, CSS, and HTML. Do not add bundlers, compilers, or npm dependencies.
- **Never delete user data**: no code path may delete rows or clear cells in a user's Google Sheet (enforced by tests). Removing a product is strictly a status change to `Discontinued`.
- **Run tests**: run automated tests with `npm test`. Tests use Node's built-in test runner (Node 20 or newer), so there is nothing to install. All tests must pass before submitting changes.

## Run it

1. Clone the repo.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the repo folder.
3. After editing, click the reload icon on the AliSwift card. Reload active tabs if you changed content scripts.

Run the tests with:

```bash
npm test
```

## Where things live

| Path | What it does |
| --- | --- |
| `manifest.json` | Permissions, content script matches, OAuth client |
| `lib/shared.js` | Settings defaults, price parsing, formula evaluator, pricing, and library reducers. Loaded by every part |
| `lib/ui.css`, `lib/ui.js` | Colors, controls, tabs, dialogs, tooltips, and toasts shared by every page |
| `lib/template.js` | Google Sheets template workbook generator for Auto sheets |
| `lib/ai.js` | AI calls: one queue, a key pool across Gemini, Groq and OpenRouter, per-key cooldowns |
| `lib/errors.js` | One table of error messages and buttons for every page |
| `lib/importmap.js` | Column matching and AI mapping logic for importing existing sheets |
| `lib/listing.js` | AI listing generation and validation logic |
| `content.js`, `content.css` | Reads AliExpress product pages, injects the on-page save button |
| `background.js` | Service worker handling Google OAuth sign-in, Sheets API calls, and Gemini requests |
| `popup/` | Toolbar popup |
| `options/` | Settings page |
| `dashboard/` | Full-page dashboard for products and orders |
| `test/` | Automated tests for pure logic, Sheets writer, and handlers |

## Common changes

**AliExpress changed its layout.** The selectors are constants at the top of `content.js` (`PRICE_SELECTORS`, `SHIPPING_SELECTORS`) plus the title selector in `getTitle`. Open a product page, check what the element is called now, and update them.

**Changing pricing math.** Do it in `lib/shared.js` and add a test case to `test/shared.test.js`. The popup and the page button both call the same function, so they cannot drift apart.

**Changing how rows are written.** Edit `background.js` and keep `test/background.test.js` passing. Values are written as `RAW` on purpose, so text from a product page can never be read as a spreadsheet formula. Never write blank values to clear cells.

## Google sign-in for your own build

The manifest ships with the maintainer's OAuth client and a fixed extension key. Every unpacked copy of the repo therefore gets the same extension ID, and sign-in works without setup. If you publish your own build, or Google blocks sign-in for your copy, use your own client:

1. Make a key pair. Keep `key.pem` private (`.gitignore` already blocks `*.pem`).

   ```bash
   openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out key.pem
   ```

2. Get the public key for the manifest and the extension ID it produces:

   ```bash
   openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A
   openssl rsa -in key.pem -pubout -outform DER | sha256sum | head -c32 | tr '0-9a-f' 'a-p'
   ```

   The first command prints the value for `"key"` in `manifest.json`. It is the public key and starts with `MIIBIj`. Never put the private key (`key.pem`) in the manifest or the repo. The second command prints your extension ID.

   No `openssl`? Node prints both (public key first, then the ID) from the same `key.pem`:

   ```bash
   node -e "const c=require('node:crypto');const d=c.createPublicKey(require('node:fs').readFileSync('key.pem')).export({type:'spki',format:'der'});console.log(d.toString('base64'));console.log(c.createHash('sha256').update(d).digest('hex').slice(0,32).replace(/[0-9a-f]/g,x=>'abcdefghijklmnop'[parseInt(x,16)]))"
   ```

3. In [Google Cloud Console](https://console.cloud.google.com/), create a project, enable the **Google Sheets API** and the **Google Drive API** (the import picker lists your spreadsheets with it), and set up the OAuth consent screen with the `spreadsheets` and `drive.metadata.readonly` scopes. Without the Drive API, the picker says it isn't enabled and pasting a link still works; without the scope on the consent screen, sign-in can fail.
4. Create an OAuth client ID of type **Chrome extension** and enter your extension ID as the item ID.
5. Put the public key in `"key"` and the client ID in `oauth2.client_id` in `manifest.json`.

Changing `"key"` changes the extension ID. Chrome then treats the build as a new extension with empty settings, so export your settings first (**Settings, General, Export settings**) and import them after reloading. Your sheets are not affected. `npm test` checks that `"key"` is a public key and that the repo holds no private key.

## Pull requests

- Keep them small and explain why, not just what.
- Run `npm test` before opening a pull request.
- Ensure no code path deletes rows or clears cells in sheets.
- If you touched the popup, settings, dashboard, or page button, try it in Chrome and mention what you checked.
- Add a line under **Unreleased** in `CHANGELOG.md` when users would notice the change.

## Releasing (maintainers)

1. Set the new version in `manifest.json` and move the **Unreleased** notes in `CHANGELOG.md` under it.
2. Commit, then tag and push: `git tag v0.6.0 && git push origin main v0.6.0`.
3. CI checks that the tag matches the manifest version, runs the tests, builds `aliswift-v0.6.0.zip` and publishes the GitHub release.

The zip contains only what the extension needs. Dev files are excluded through `.gitattributes`.
