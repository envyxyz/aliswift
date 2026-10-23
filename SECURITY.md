# Security

## Reporting a problem

Please report security problems privately, not in a public issue. Use GitHub's **Security** tab on this repository and choose **Report a vulnerability**. Include what you found and steps to reproduce it.

Only the latest release gets fixes.

## Sign-in key rotation

The manifest `"key"` and OAuth client ID in the repository are public by design, giving every build the extension ID `oeomcphpdaicmkpdpdnfmnkjidnbghaa`. Only current releases using this ID are supported for Google sign-in. To configure your own OAuth client, follow the instructions in [CONTRIBUTING.md](CONTRIBUTING.md#google-sign-in-for-your-own-build).

## How the extension limits what a web page can make it do

- **Buttons on AliExpress's pages** sit in the page's own DOM, so the page's scripts can reach them. Each ignores a click that did not come from the seller (`event.isTrusted`), so a page cannot click Add to Sheet or Remove from Sheet to write to your sheet, spend your AI keys, or open tabs. The eBay panel lives in a closed shadow root out of the page's reach.
- **The service worker checks who is asking.** Saving or removing a product and requesting exchange rates answer only AliExpress product pages and AliSwift's own pages; adding orders answers only Seller Hub order pages; the eBay panel answers only eBay's listing form; each AI task answers only the page it belongs to. Everything else answers only AliSwift's own pages. There is no `externally_connectable`, so web pages cannot message the extension.
- **The AI points, it does not write.** For an altered page, Gemini receives a numbered list of elements and answers with numbers from that list. A number is used only when that element matches the required role; nothing the AI returns is used as a selector, address, or typed value. Page text reaches the AI marked as data, never instructions.
- **Orders reach Gemini masked.** Only required structure (order number, custom label, quantities, amounts, dates) is kept; all other text, including buyer names or addresses, is replaced with placeholders.
- **The popup reads the tab address only on click** (`activeTab`), using it to choose between the save form and the launcher. It sends the address nowhere.
- **The page never sets a price.** When you select a card in the eBay panel, the price filled into the form comes from AliSwift's stored list, not from the page.
- **Spreadsheet writes use plain text** (`RAW`), so titles like `=IMPORTDATA(...)` cannot execute as formulas, and no routine deletes or clears unmanaged cells.
- **Adding missing columns (SKU, Image, Order link) requires confirmation.** It requires an explicit Yes in a dialog, runs through a service-worker handler restricted to AliSwift's own pages, and writes RAW values only into empty cells. It never modifies cells with existing values and never deletes rows.
- **Photo handling and downloads are restricted.** The downloads permission is optional and requested only when enabled in settings. Only the service worker uses it, only URLs on AliExpress image hosts are fetched or downloaded, and folder and file names are sanitized to prevent directory traversal. The photo handlers answer only listing forms on eBay marketplaces.
- **Photo backfill and variant folders are restricted.** Backfill requests only `https://www.aliexpress.com/item/<digits>.html` without credentials, accepts only addresses on AliExpress image hosts, writes only into empty Image cells, and answers only AliSwift's own pages. Variant folder names are sanitized like sheet and SKU names.
- **Extension pages use a strict Content Security Policy:** `script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`. No extension page loads remote code.

## What is in scope

AliSwift reads product pages and writes to your Google Sheets, so these matter most:

- Page content (titles, prices) executing as code or spreadsheet formulas
- Actions reading or writing a sheet you did not connect
- Leaks of Google OAuth tokens or settings to third parties
- Permissions broader than the extension requires
