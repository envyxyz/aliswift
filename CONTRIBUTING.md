# Contributing to AliSwift

AliSwift is small on purpose: plain JavaScript, Manifest V3, no build step, no dependencies. Please keep it that way. A change that removes code is as welcome as one that adds a feature.

## Run it

1. Clone the repo.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the repo folder.
3. After editing, click the reload icon on the AliSwift card. Reload the AliExpress tab too if you changed `content.js`.

Run the tests with `npm test`. They use Node's built-in test runner (Node 20 or newer), so there is nothing to install.

## Where things live

| Path | What it does |
| --- | --- |
| `manifest.json` | Permissions, content script matches, OAuth client |
| `lib/shared.js` | Settings defaults, price parsing, formula evaluator, pricing. Loaded by every part |
| `lib/ui.css`, `lib/ui.js` | Colors, controls, tabs, dialogs, tooltips and toasts shared by every page |
| `content.js`, `content.css` | Reads the product page, injects the green button |
| `background.js` | Google sign-in and all Sheets API calls |
| `popup/` | Toolbar popup |
| `options/` | Settings page |
| `test/` | Tests for the pure logic and the Sheets writer |

## Common changes

**AliExpress changed its layout.** The selectors are constants at the top of `content.js` (`PRICE_SELECTORS`, `SHIPPING_SELECTORS`) plus the title selector in `getTitle`. Open a product page, check what the element is called now, and update them.

**Changing pricing math.** Do it in `lib/shared.js` and add a case to `test/shared.test.js`. The popup and the page button both call the same function, so they cannot drift apart.

**Changing how rows are written.** Edit `background.js` and keep `test/background.test.js` passing. Values are written as `RAW` on purpose, so text from a product page can never be read as a spreadsheet formula.

## Google sign-in for your own build

The manifest ships with the maintainer's OAuth client and a fixed extension key. Every unpacked copy of the repo therefore gets the same extension ID, and sign-in works without setup. If you publish your own build, or Google blocks sign-in for your copy, use your own client:

1. Make a key pair. Keep `key.pem` private (`.gitignore` already blocks `*.pem`).

   ```
   openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out key.pem
   ```

2. Get the public key for the manifest and the extension ID it produces:

   ```
   openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A
   openssl rsa -in key.pem -pubout -outform DER | sha256sum | head -c32 | tr '0-9a-f' 'a-p'
   ```

   The first command prints the value for `"key"` in `manifest.json`. It is the public key and starts with `MIIBIj`. Never put the private key (`key.pem`) in the manifest or the repo. The second command prints your extension ID.

3. In [Google Cloud Console](https://console.cloud.google.com/), create a project, enable the **Google Sheets API**, and set up the OAuth consent screen.
4. Create an OAuth client ID of type **Chrome extension** and enter your extension ID as the item ID.
5. Put the public key in `"key"` and the client ID in `oauth2.client_id` in `manifest.json`.

## Pull requests

- Keep them small and say why, not just what.
- Run `npm test`.
- If you touched the popup, settings or page button, try it in Chrome and mention what you checked.
- Add a line under **Unreleased** in `CHANGELOG.md` when users would notice the change.

## Releasing (maintainers)

1. Set the new version in `manifest.json` and move the **Unreleased** notes in `CHANGELOG.md` under it.
2. Commit, then tag and push: `git tag v0.6.0 && git push origin main v0.6.0`.
3. CI checks that the tag matches the manifest version, runs the tests, builds `aliswift-v0.6.0.zip` and publishes the GitHub release.

The zip contains only what the extension needs. Dev files are excluded through `.gitattributes`.
