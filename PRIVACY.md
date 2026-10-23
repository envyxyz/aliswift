# Privacy Policy

AliSwift has no account system and stores no product or order data on any server. The only thing it sends to the developer is error reports, described under [Error reports](#error-reports), which you can turn off.

Product data is stored only on your own device (in your local library and settings export file) or in your own Google Sheet.

## What AliSwift reads

- **Product details on AliExpress**: title, item price, shipping cost, image link and URL, specifications, summary, and gallery photo links. This occurs only when you visit an AliExpress product page and open the extension popup or click on-page buttons (Add to Sheet, Download photos). If price elements cannot be read, the page text holding a price can be sent to Gemini for price detection.
- **Public AliExpress pages for products without a photo**: when the dashboard lists products that have a link but no photo, the service worker requests each product's public AliExpress page (`https://www.aliexpress.com/item/<item number>.html`) without cookies or sign-in. It reads only the page's share image address (`og:image`). The address is stored on this device, shown on the dashboard, and can be written into an empty cell of the Image column in your Google Sheet (or saved in your local library record). It never overwrites a cell that already has a value.
- **Your Google Sheets**: AliSwift reads column headers, existing SKUs, links, and titles in the spreadsheets you explicitly configure.
- **Your Google Drive metadata**: when you connect to Google, sign-in requests the read-only Drive metadata scope (`drive.metadata.readonly`). This allows AliSwift to list spreadsheet names and dates in the picker and verify pasted spreadsheet links. It never reads the contents of any other file in your Drive.
- **Your Google profile photo**: sign-in requests the `userinfo.profile` scope so the account button can display your photo. AliSwift reads only the photo address (never your name or email), stores it on this device for a day, and clears it when you sign out.
- **eBay listing pages**: content scripts run on eBay's listing form (`/lstng`) on supported marketplaces (eBay UK, US, Germany, Australia, and Canada) to read field names and options. When you click fill with your own key, field names and options go to Gemini; if an input cannot be found by its standard name, the names, labels, and types of the form's boxes (never their contents) can be sent. The product details filled into the form come from your selected product and remain on your device.
- **eBay Seller Hub order list**: on the order list (`/sh/ord`) of supported sites, clicking **Add all orders to sheet** reads each order's number, custom label (SKU), item quantity, and sold date, and writes them to the Orders tab of your sheet. Buyer names, usernames, and addresses are never kept or sent. If page layout changes prevent standard reading, row text is sent to Gemini with all text replaced by placeholders except order numbers, custom labels, quantities, amounts, and dates.

## Where your data goes

1. **Directly to your Google account**:
   When you save a product to a Google Sheet, data travels directly from your browser to Google's Sheets API (`sheets.googleapis.com`) using your Google OAuth authentication. Google's privacy policy governs data stored in your Google Drive.
2. **On-device local storage**:
   When you use AliSwift without signing in (or choose the local library destination), saved products remain strictly on your own device in Chrome local storage (`chrome.storage.local`).
3. **Directly to your AI provider (optional)**:
   If you enter an AI key in Settings (Gemini, Groq or OpenRouter) for AI column mapping, listing generation, or eBay form filling, data travels directly from your browser to that provider (`generativelanguage.googleapis.com`, `api.groq.com` or `openrouter.ai`). AliSwift requests Chrome permission for Groq or OpenRouter only when you add a key for them.
   - AI keys stay in `chrome.storage.local` on this device, are sent only to their respective provider, and are excluded from settings export unless you tick **Include my AI keys** when exporting.
   - The provider receives product text (title, sell price, specifications, buyer-selectable options, and description) for listing generation, and up to two small product photos with a Gemini key unless you turn off **Send product photos to the AI** (on by default; product photos only). The provider never receives your cost price.
   - For sheet column mapping, AliSwift sends column headers and sample cells to Gemini with a filter designed to exclude personal data (names, addresses, phone numbers, emails). Because this filter uses a deny-list, check the preview before confirming.
   - AI requests wait 15 to 90 seconds for an answer; timeouts are not retried. When a key is rate-limited, the next key in your pool is tried.
4. **Directly to eBay's listing form (optional photo attachment)**:
   When **Allow photo downloads** is on (Settings, General) and you press **Add from AliExpress** on eBay's listing form, the photos you pick are fetched from AliExpress image hosts, saved to your Downloads folder, and handed to eBay's photo uploader on your listing page. They are never sent anywhere else.
5. **Exchange rates (ExchangeRate-API)**:
   When a product's supplier price is in a different currency than its sheet, the service worker requests current rates from `open.er-api.com` (the free [ExchangeRate-API](https://www.exchangerate-api.com) endpoint). The request includes only the currency code (for example `/v6/latest/USD`), carries no product data, cookies, or sign-in tokens, and the rate is cached locally for 12 hours.

AliSwift has no account system and stores no product or order data on any server. The only thing it sends to the developer is error reports, described under [Error reports](#error-reports), which you can turn off.

## Error reports

To find and fix bugs, AliSwift sends error reports to the developer's diagnostics service (a Supabase function). They are on by default and can be turned off in Settings under the General tab (**Send error reports**).

- **What is sent**: for every AI request, the timestamp, AliSwift version, a random install ID generated on first use (identifying the install, not you), the task (listing, form filling, etc.), the provider and model, the key's slot number and tier (Free or Paid, never the key itself), latency, HTTP status, error code, provider retry delay, and token counts. For listing and form-filling steps, counts only: volume of product details provided to the AI (count of specifications and photos, never their text), generated listing lengths, unfillable eBay form field names (such as "Age Level"), eBay category name, and the count of fields filled. For every failed action, its name and error code. For crashes in AliSwift scripts, the error message and stack trace.
- **Only if you opt in** (Settings, General tab, **Include prompts and answers**, off by default), or when you click **Send logs** on a failed run: the text sent to the AI and its answer for listing writing and form filling, trimmed to 8 KB each. With the opt-in enabled, failures always include them and 1 in 10 successful requests do. Send logs transmits the report once and displays a reference code (such as `R-4F2K`) to quote in bug reports.
- **Never sent**: your AI keys, Google OAuth tokens, sheet names or IDs, buyer names, addresses, order data, and cost prices. Sheet mapping and order reading never send their content. A final sanitization filter strips key patterns before sending.
- **How**: reports queue on your device (at most 500 reports, up to 7 days) and are sent every 5 minutes. The database retains them for 30 days and cannot be queried with the public key.

## How your spreadsheets are handled

AliSwift follows a strict non-destructive rule:
- It writes new products into the next available row of your sheet (or a row cleared previously), updates status, tracking, and price cells when edited on the dashboard (never cells containing formulas), and adds missing SKU and Image URL columns after the last populated column only when you explicitly confirm.
- Column additions write only into empty columns and never modify cells with existing values.
- **Remove from Sheet** (on an AliExpress product page, after a second click) and **Delete** (on the dashboard, after confirmation) clear only the cells AliSwift wrote in that product's row: name, prices, link, photo link, status, and SKU (unless generated by a sheet formula). Formulas in the row and your Orders tab are preserved. AliSwift reuses cleared rows when you add new products.
- AliSwift never deletes rows, never removes worksheets, and never clears any cells other than the ones it wrote for that product.

## What is stored in Chrome

- **Extension settings (`chrome.storage.sync`)**: sheet IDs, tab names, column mapping letters, SKU prefixes, marketplace regions, pricing rules, and UI theme preferences. If Chrome sync is enabled in your browser, Chrome syncs these preferences through your personal Google account.
- **On-device storage (`chrome.storage.local`)**: local library products, cached photo links (stored by AliExpress item number under key `photos`, up to 5,000 items, used for dashboard fallback), temporary product caches, products queued for listing generation, queued error reports, and your AI keys. These stay on your physical device, are never synced across computers, and AI keys are excluded from settings export unless you choose to include them.

## Settings export and backup

When you use **Export settings**, a JSON backup file (`aliswift-settings.json`) is generated inside your browser and downloaded to your computer.
- The file contains your configured sheet settings (including image inclusion preferences), saved local library products, and stored photo links (links only, no image data).
- The file never contains Google OAuth tokens. It contains your AI keys only if you tick **Include my AI keys** before exporting (disabled by default). If included, keys are stored in plain text; keep the file secure and delete it once imported. Importing a settings file restores keys locally and prompts for Groq or OpenRouter permissions if required.

## Permissions and justifications

Every permission and host in `manifest.json` is listed below with a plain-language reason:

| Permission or Host | Purpose and Justification |
| --- | --- |
| `storage` | Stores extension configuration in Chrome sync storage, and local library items and caches in local storage. |
| `identity` | Signs in to your Google account via OAuth 2.0 so the extension can read and append rows to your Google Sheets. |
| `activeTab` | Lets the toolbar popup read the address of the current tab when you click the icon, to tell an AliExpress product page from any other page. It shows no install warning and gives no access to a page unless you click the icon. |
| `alarms` | Sends queued error reports every 5 minutes and writes queued listings one at a time, even after the browser restarts. |
| `downloads` (optional) | Saves product photos to a folder in Downloads only when the Include images setting is on and attaching to eBay's form did not work. |
| `https://*.aliexpress.com/*`, `https://*.aliexpress.us/*` | Reads product page titles, prices, shipping rates and images, and displays the on-page save button. |
| `https://sheets.googleapis.com/*` | Appends product rows and reads inventory and order data in the Google Sheets you configure. |
| `https://www.googleapis.com/drive/*` | Lists spreadsheet file names and dates for sheet selection and verifies pasted sheet links via `drive.metadata.readonly`. |
| `https://generativelanguage.googleapis.com/*` | Communicates directly with Google's Gemini API for AI column mapping, listing generation and form filling using your own API key. |
| `https://api.groq.com/*`, `https://openrouter.ai/*` (optional) | Asked for only when you add a Groq or OpenRouter key. The same AI requests as Gemini's, sent to that provider with your own key. |
| `https://*.alicdn.com/*` | Loads product image assets from AliExpress CDN so the service worker can provide them to Gemini for listing generation. |
| `https://*.aliexpress-media.com/*` | Loads product media assets from AliExpress media CDN for Gemini listing generation. |

## OAuth scopes requested

- `https://www.googleapis.com/auth/spreadsheets`: allows AliSwift to create auto-configured dropshipping spreadsheets and write rows to the sheets you connect.
- `https://www.googleapis.com/auth/drive.metadata.readonly`: requested during sign-in to display existing spreadsheets and verify pasted spreadsheet links without granting access to file contents.
- `https://www.googleapis.com/auth/userinfo.profile`: requested during sign-in to show your Google account photo on the account button. Only the photo address is read; it is kept on this device for a day, and your name and email are not stored.

## Revoking access and data removal

- You can revoke AliSwift's access to your Google account at any time by visiting <https://myaccount.google.com/permissions>.
- Uninstalling the extension automatically removes all locally stored data, cached items, and settings from your browser.

## Questions

Open an issue at <https://github.com/envyxyz/aliswift/issues>.
