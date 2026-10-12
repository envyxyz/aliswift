# Security

## Reporting a problem

Please report security problems privately, not in a public issue. Use GitHub's **Security** tab on this repository and choose **Report a vulnerability**. Include what you found and steps to reproduce it.

Only the latest release gets fixes.

## Sign-in key rotation

Before this change, `manifest.json` held a private key in its `"key"` field (extension ID `cfnlniilbhkbbpjinbhkiepadnbikbkj`). It was replaced with a new public key, so the extension ID is now `oeomcphpdaicmkpdpdnfmnkjidnbghaa`, with a new OAuth client. The old key stays in git history and must be treated as compromised for good.

Builds from before the rotation have a different extension ID and are not supported. They may stop signing in, so update to a current build. Export your settings first and import them afterwards (see the README).

The manifest `"key"` and OAuth client ID are public by design. Anyone can load a copy of this repo and get the same extension ID and client. Rotation fixes the leaked key; it does not make the client private. To run your own, see [CONTRIBUTING](CONTRIBUTING.md#google-sign-in-for-your-own-build).

## How the extension limits what a web page can make it do

- **Buttons on AliExpress's pages** sit in the page's own DOM, so the page's scripts can reach them. Each ignores a click that did not come from the seller (`event.isTrusted`), so a page cannot press Add to Sheet or Create Listing to write to your sheet, spend your Gemini key or open tabs. The eBay panel lives in a closed shadow root and is out of the page's reach.
- **The service worker checks who is asking.** Saving a product, asking an exchange rate and Create Listing answer only AliExpress product pages and AliSwift's own pages; adding orders answers only Seller Hub's order pages; the eBay panel's calls answer only eBay's listing form; each AI task answers only the page it is about. Everything else answers only AliSwift's own pages. There is no `externally_connectable`, so no web page can message the extension at all.
- **The AI points, it does not write.** For a page that changed, Gemini is shown a numbered list of what the page holds and answers with numbers from it. A number is kept only when that item can do the job; nothing it says is used as a selector, an address or a value to type. The text of the page reaches it marked as data, never instructions.
- **Orders reach Gemini masked.** Only the shapes AliSwift reads (order number, custom label, quantities, amounts, dates) are kept; every other piece of text, which is where a buyer's name or address would be, is replaced by a placeholder.
- **The page never names a price.** When a card is chosen in the eBay panel, the price filled into the form comes from AliSwift's stored list, not from the page.
- **Everything typed into a sheet is plain text** (`RAW`), so a title like `=IMPORTDATA(...)` cannot run as a formula, and nothing deletes or clears a cell.
- **Adding missing columns is the one layout change.** It needs an explicit Yes in a dialog, goes through a service-worker handler only AliSwift's own pages may call, and writes with RAW values into empty cells. It never changes a cell that has a value and never deletes or clears anything.
- **Photo handling and downloads are restricted.** The downloads permission is optional and requested only when the setting is switched on, only the service worker uses it, only URLs on AliExpress's image hosts are fetched or downloaded, folder and file names are sanitised so they cannot leave Downloads, and the two photo handlers answer only the listing form on eBay's own marketplaces.
- **Photo backfill and variant folders are restricted.** The backfill fetches only `https://www.aliexpress.com/item/<digits>.html` with credentials omitted, accepts only addresses on AliExpress's image hosts, writes only into empty cells of the Image column, and answers only AliSwift's own pages. Variant folder names are sanitised like the sheet and SKU names.
- **Extension pages have a content security policy:** `script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`. No page loads remote code.

## What is in scope

AliSwift reads product pages and writes to your Google Sheets, so these matter most:

- Page content (titles, prices) ending up as code or spreadsheet formulas
- Anything that reads or writes a sheet the user did not add
- Anything that leaks the Google token or settings to a third party
- Permissions broader than the extension needs
