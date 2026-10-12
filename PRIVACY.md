# Privacy Policy

AliSwift has no project-run server, no database, and no analytics. Nothing is ever sent to the creators of AliSwift. Product data is stored only on your own device (in your local library and settings export file) or in your own Google Sheet, never on our servers (we have none).

## What AliSwift reads

- **Product details on AliExpress**: title, item price, shipping cost, image link and URL, and the page's full title, specifications, summary and gallery photo links, kept with the product for its listing. This happens only when you visit an AliExpress product page and open the extension popup or click one of the on-page buttons (Add to Sheet, Create Listing). If the page's price boxes can't be read, the pieces of the page that hold a price can go to Gemini (see below).
- **Public AliExpress pages for products without a photo**: when the dashboard lists products that have a link but no photo, the service worker requests each product's public AliExpress page (`https://www.aliexpress.com/item/<item number>.html`) without cookies or sign-in, the same request your browser makes when you open the link. It reads only the page's share image address (`og:image`). The address is kept on this device, shown on the dashboard, and may be written into an empty cell of the Image column in your own Google Sheet (or saved in the product's record in your local library); it never overwrites a cell that already has a value.
- **Your Google Sheets**: AliSwift reads column headers, existing SKUs, links, titles and exchange rate cells in the spreadsheets you explicitly configure.
- **Your Google Drive metadata**: when you connect to Google, sign-in requests one scope list that includes read-only Drive metadata (`drive.metadata.readonly`). This allows AliSwift to list spreadsheet names and dates in the picker and verify pasted spreadsheet links. It never reads the contents of any file in your Drive except the sheet you choose to open.
- **eBay listing pages**: the content script runs on eBay's listing form (`/lstng`) on the marketplaces you can choose for a sheet (eBay UK, US, Germany, Australia and Canada sites) and reads its field names and options to fill them. Only field names and options go to Gemini, and only when you click fill, with your own key; if a box can't be found by its usual name, the names, labels and types of the form's boxes (never their contents) can go too. The product details it fills come from the product you picked in the panel and stay on your device.
- **eBay Seller Hub order list**: on the order list (`/sh/ord`) of those sites, when you press **Add all orders to sheet**, AliSwift reads each order's number, the custom label (SKU) and quantity of each item, and the sold date, and writes them to the Orders tab of your sheet. Buyer names, usernames and addresses on the page are not read into anything AliSwift keeps or sends. If the page's wording changes and the usual reading finds no item, the row's text goes to Gemini with every piece other than an order number, custom label, quantity, amount or date replaced by a placeholder.

## Where your data goes

1. **Directly to your Google account**:
   When you save a product to a Google Sheet, data travels directly from your browser to Google's Sheets API (`sheets.googleapis.com`) using your own Google OAuth authentication. Google's privacy policy governs the data stored in your Google Drive.
2. **On-device local storage**:
   When you use AliSwift without signing in (or choose the local library destination), your saved products remain strictly on your own device in Chrome local storage (`chrome.storage.local`).
3. **Directly to Google's Gemini API (optional)**:
   If you enter your own Gemini API key in Settings for AI column mapping, listing generation, or eBay form filling, data travels directly from your browser to Google's Gemini API (`generativelanguage.googleapis.com`).
   - Your Gemini API key stays in `chrome.storage.local` on this device, is sent only to Google's Gemini API, and is not included in settings export.
   - Gemini receives the product's text (its title, sell price, specifications and description) and up to four of its photos for listing generation. It never receives your cost price.
   - For sheet column mapping, AliSwift sends column headers and a few sample cells to Gemini, with a filter that tries to leave out columns that look personal (names, addresses, phone, email). Because this filter is a deny-list and can miss odd or unstructured headers, always check the preview before confirming.
   - Gemini requests allow up to 15 s per attempt and retry once, so calls take up to about 30 s total.
4. **Directly to eBay's listing form (optional photo attachment)**:
   When the "Include images when creating listings from AliExpress" setting is turned on, photos are fetched from AliExpress's image hosts by the extension and handed to eBay's uploader on the seller's own listing page. They are never sent to any server run by this project. The setting is in the settings backup. Variant photos are only saved to the user's own Downloads folder (in sub-folders named after the variant) and are never attached to eBay's form or sent to external servers.

AliSwift never sends your data to any server operated by this project. Product and order data live only on the device or in the user's own Sheet, never on our servers (we have none).

## How your spreadsheets are handled

AliSwift follows a strict non-destructive rule:
- It only appends new rows into the next available row of your sheet, updates specific status and tracking cells when you edit them on the dashboard, or adds missing SKU and Image URL columns after the last column with values when you explicitly confirm.
- Column additions write only into new empty columns and never change cells that already have values.
- It never deletes rows, never removes worksheets, and never clears existing cell contents.

## What is stored in Chrome

- **Extension settings (`chrome.storage.sync`)**: your sheet IDs, tab names, column mapping letters, SKU prefixes, marketplace regions, pricing rules, and UI theme preferences. If Chrome sync is enabled in your browser, Chrome syncs these preferences through your personal Google account.
- **On-device storage (`chrome.storage.local`)**: your local library products, on-device photo links (saved under key `photos` by AliExpress item number, up to the newest 5000, used as a dashboard fallback), temporary product caches, and your Gemini API key. These items stay on your physical device, are never synced to other computers, and the Gemini key is excluded from settings export.

## Settings export and backup

When you use the **Export settings** feature, a JSON backup file (`aliswift-settings.json`) is generated entirely inside your browser and downloaded to your computer.
- The file contains your configured sheet settings (including the image inclusion setting), your saved local library products, and stored photo links (photo links only, no image data).
- The file never contains your Google OAuth credentials, tokens, or your Gemini API key.

## Permissions and justifications

Every permission and host in `manifest.json` is listed below with a plain-language reason:

| Permission or Host | Purpose and Justification |
| --- | --- |
| `storage` | Stores extension configuration in Chrome sync storage, and local library items and caches in local storage. |
| `identity` | Signs in to your Google account via OAuth 2.0 so the extension can read and append rows to your Google Sheets. |
| `downloads` (optional) | Saves product photos to a folder in Downloads only when the Include images setting is on and attaching to eBay's form did not work. |
| `https://*.aliexpress.com/*`, `https://*.aliexpress.us/*` | Reads product page titles, prices, shipping rates and images, and displays the on-page save button. |
| `https://sheets.googleapis.com/*` | Appends product rows and reads inventory and order data in the Google Sheets you configure. |
| `https://www.googleapis.com/drive/*` | Lists spreadsheet file names and dates for sheet selection and verifies pasted sheet links via `drive.metadata.readonly`. |
| `https://generativelanguage.googleapis.com/*` | Communicates directly with Google's Gemini API for AI column mapping and listing generation using your own API key. |
| `https://*.alicdn.com/*` | Loads product image assets from AliExpress CDN so the service worker can provide them to Gemini for listing generation. |
| `https://*.aliexpress-media.com/*` | Loads product media assets from AliExpress media CDN for Gemini listing generation. |

## OAuth scopes requested

- `https://www.googleapis.com/auth/spreadsheets`: allows AliSwift to create auto-configured dropshipping spreadsheets and write rows to the sheets you connect.
- `https://www.googleapis.com/auth/drive.metadata.readonly`: requested during sign-in to display existing spreadsheets and verify pasted spreadsheet links without granting access to file contents.

## Revoking access and data removal

- You can revoke AliSwift's access to your Google account at any time by visiting <https://myaccount.google.com/permissions>.
- Uninstalling the extension automatically removes all locally stored data, cached items, and settings from your browser.

## Questions

Open an issue at <https://github.com/envyxyz/aliswift/issues>.
