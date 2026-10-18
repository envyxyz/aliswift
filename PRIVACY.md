# Privacy Policy

AliSwift has no analytics and stores no product data on any server of ours. Product data is stored only on your own device (in your local library and settings export file) or in your own Google Sheet. The one thing sent to the developer is error reports, described under [Error reports](#error-reports), which you can turn off.

## What AliSwift reads

- **Product details on AliExpress**: title, item price, shipping cost, image link and URL, and the page's full title, specifications, summary and gallery photo links, kept with the product for its listing. This happens only when you visit an AliExpress product page and open the extension popup or click one of the on-page buttons (Add to Sheet, Download photos). If the page's price boxes can't be read, the pieces of the page that hold a price can go to Gemini (see below).
- **Public AliExpress pages for products without a photo**: when the dashboard lists products that have a link but no photo, the service worker requests each product's public AliExpress page (`https://www.aliexpress.com/item/<item number>.html`) without cookies or sign-in, the same request your browser makes when you open the link. It reads only the page's share image address (`og:image`). The address is kept on this device, shown on the dashboard, and may be written into an empty cell of the Image column in your own Google Sheet (or saved in the product's record in your local library); it never overwrites a cell that already has a value.
- **Your Google Sheets**: AliSwift reads column headers, existing SKUs, links and titles in the spreadsheets you explicitly configure.
- **Your Google Drive metadata**: when you connect to Google, sign-in requests one scope list that includes read-only Drive metadata (`drive.metadata.readonly`). This allows AliSwift to list spreadsheet names and dates in the picker and verify pasted spreadsheet links. It never reads the contents of any file in your Drive except the sheet you choose to open.
- **Your Google profile photo**: sign-in also requests the basic `userinfo.profile` scope so the account button can show your photo. AliSwift reads only the address of the photo (never your name or email), keeps it on this device for a day, and clears it when you sign out.
- **eBay listing pages**: the content script runs on eBay's listing form (`/lstng`) on the marketplaces you can choose for a sheet (eBay UK, US, Germany, Australia and Canada sites) and reads its field names and options to fill them. Only field names and options go to Gemini, and only when you click fill, with your own key; if a box can't be found by its usual name, the names, labels and types of the form's boxes (never their contents) can go too. The product details it fills come from the product you picked in the panel and stay on your device.
- **eBay Seller Hub order list**: on the order list (`/sh/ord`) of those sites, when you press **Add all orders to sheet**, AliSwift reads each order's number, the custom label (SKU) and quantity of each item, and the sold date, and writes them to the Orders tab of your sheet. Buyer names, usernames and addresses on the page are not read into anything AliSwift keeps or sends. If the page's wording changes and the usual reading finds no item, the row's text goes to Gemini with every piece other than an order number, custom label, quantity, amount or date replaced by a placeholder.

## Where your data goes

1. **Directly to your Google account**:
   When you save a product to a Google Sheet, data travels directly from your browser to Google's Sheets API (`sheets.googleapis.com`) using your own Google OAuth authentication. Google's privacy policy governs the data stored in your Google Drive.
2. **On-device local storage**:
   When you use AliSwift without signing in (or choose the local library destination), your saved products remain strictly on your own device in Chrome local storage (`chrome.storage.local`).
3. **Directly to your AI provider (optional)**:
   If you enter your own AI key in Settings (Gemini, Groq or OpenRouter) for AI column mapping, listing generation, or eBay form filling, data travels directly from your browser to that provider (`generativelanguage.googleapis.com`, `api.groq.com` or `openrouter.ai`). AliSwift asks Chrome for access to Groq or OpenRouter only when you add a key for it.
   - Your AI keys stay in `chrome.storage.local` on this device, are sent only to their own provider, and are left out of settings export unless you tick **Include my AI keys** when exporting (see below).
   - The provider receives the product's text (its title, sell price, specifications and description) for listing generation, and up to two small photos only if you turn on **Send product photos to the AI** (off by default, Gemini keys only). It never receives your cost price.
   - For sheet column mapping, AliSwift sends column headers and a few sample cells to Gemini, with a filter that tries to leave out columns that look personal (names, addresses, phone, email). Because this filter is a deny-list and can miss odd or unstructured headers, always check the preview before confirming.
   - A request waits 15 to 90 s for an answer, and a timeout is not retried. When a key is busy, the next one in your list is tried.
4. **Directly to eBay's listing form (optional photo attachment)**:
   When the "Include images when creating listings from AliExpress" setting is turned on, photos are fetched from AliExpress's image hosts by the extension and handed to eBay's uploader on the seller's own listing page. They are never sent to any server run by this project. The setting is in the settings backup. Variant photos are only saved to the user's own Downloads folder (in sub-folders named after the variant) and are never attached to eBay's form or sent to external servers.
5. **Exchange rates (ExchangeRate-API)**:
   When a product's price is in another currency than its sheet, the service worker asks `open.er-api.com` (the free [ExchangeRate-API](https://www.exchangerate-api.com) endpoint) for that day's rates of the sheet's currency. The request names only the currency (for example `/v6/latest/USD`), carries no product data, cookies or sign-in, and the rate is cached on this device for 12 hours.

Apart from error reports (below), AliSwift sends nothing to any server operated by this project. Product and order data live only on the device or in the user's own Sheet.

## Error reports

To find and fix bugs, AliSwift sends error reports to the developer's database (hosted on Supabase). They are on by default and can be turned off in Settings, General tab, **Send error reports**.

- **What is sent**: for every AI request, the time, AliSwift's version, a random install id made on first use (it identifies the install, not you), the task (listing, form filling and so on), the provider and model, the key's slot number in your list and whether it is Free or Paid (never the key), how long it took, the HTTP status, the error code, the wait the provider asked for and the token counts. For every failed action, its name and error code. For crashes in AliSwift's own scripts, the error message and stack trace.
- **Only if you opt in** (Settings, General tab, **Include prompts and answers**, off by default), or when you press **Send logs** on a failed run: the text sent to the AI and its answer for listing writing and form filling, cut to 8 KB each. With the opt-in, failures always include them and 1 in 10 successful requests do. Send logs sends that run's report once and shows a reference (like `R-4F2K`) you can quote.
- **Never sent**: your AI keys, Google sign-in tokens, sheet names or ids, buyer names, addresses or any order data, and cost prices. Sheet mapping and order reading never send their content. A last check removes anything shaped like a key before sending.
- **How**: reports wait on your device (at most 500, at most 7 days) and are sent every 5 minutes. The database keeps them for 30 days, and is not readable with the public key.


## How your spreadsheets are handled

AliSwift follows a strict non-destructive rule:
- It only writes new products into the next available row of your sheet (or a row it cleared itself, see below), updates specific status, tracking and price cells when you edit them on the dashboard (never a cell that holds a formula), or adds missing SKU and Image URL columns after the last column with values when you explicitly confirm.
- Column additions write only into new empty columns and never change cells that already have values.
- **Remove from Sheet** (on an AliExpress product page, after a second click) and **Delete** (on the dashboard, after its confirmation) clear only the cells AliSwift itself writes in that product's row: name, prices, link, photo link, status, and the SKU unless your sheet's formula makes it. Formulas in the row and your Orders tab are left alone. AliSwift remembers that row and fills it with the next product you add.
- It never deletes rows, never removes worksheets, and never clears any other cell than the ones it wrote in a product's row when you press Remove from Sheet or Delete.

## What is stored in Chrome

- **Extension settings (`chrome.storage.sync`)**: your sheet IDs, tab names, column mapping letters, SKU prefixes, marketplace regions, pricing rules, and UI theme preferences. If Chrome sync is enabled in your browser, Chrome syncs these preferences through your personal Google account.
- **On-device storage (`chrome.storage.local`)**: your local library products, on-device photo links (saved under key `photos` by AliExpress item number, up to the newest 5000, used as a dashboard fallback), temporary product caches, the list of products waiting for a listing, the error reports waiting to be sent, and your AI keys. These items stay on your physical device, are never synced to other computers, and the keys are left out of settings export unless you choose to include them.

## Settings export and backup

When you use the **Export settings** feature, a JSON backup file (`aliswift-settings.json`) is generated entirely inside your browser and downloaded to your computer.
- The file contains your configured sheet settings (including the image inclusion setting), your saved local library products, and stored photo links (photo links only, no image data).
- The file never contains your Google OAuth credentials or tokens. It contains your AI keys only if you tick **Include my AI keys** before exporting (off every time); they are then written in plain text, so keep that file private and delete it once imported. Importing such a file replaces the keys saved on that device and asks Chrome's permission for Groq or OpenRouter if a key needs it.

## Permissions and justifications

Every permission and host in `manifest.json` is listed below with a plain-language reason:

| Permission or Host | Purpose and Justification |
| --- | --- |
| `storage` | Stores extension configuration in Chrome sync storage, and local library items and caches in local storage. |
| `identity` | Signs in to your Google account via OAuth 2.0 so the extension can read and append rows to your Google Sheets. |
| `activeTab` | Lets the toolbar popup read the address of the current tab when you click the icon, to tell an AliExpress product page from any other page. It shows no install warning and gives no access to a page you have not just clicked the icon on. |
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
