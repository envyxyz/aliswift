# Chrome Web Store Listing

## Short Description (130 characters / max 132)
Save AliExpress products to Google Sheets in one click. Calculate dropshipping margins, track orders, and manage inventory easily.

## Detailed Description

AliSwift is a lightweight dropshipping tool for eBay sellers sourcing products from AliExpress. Instead of copying titles, supplier links, prices, and images by hand, AliSwift captures them in a single click and works out your sell price instantly.

Save products directly into a custom or auto-configured Google Sheet, or store them on your device in your offline library without creating an account. AliSwift has no account system and stores no product or order data on any server.

### Key Features

- One-Click Saving: Click the on-page save button on any AliExpress item page, or save from the extension popup.
- Toolbar Launcher: On any other page, the popup searches AliExpress and opens Seller Hub or a new eBay listing in one click.
- Automated Pricing: Calculate your retail sell price instantly using custom formula rules (e.g., `costPrice * 1.7`) or target profit margins. Includes visible shipping and optional cost buffers.
- Pre-Configured Spreadsheets: Auto-generate ready-to-use Google Sheets equipped with eBay fee breakdowns for UK, US, Global, Germany, Australia or Canada, profit calculations, currency exchange formulas, and customer order tracking.
- Offline Local Library: No Google account required. Start dropshipping immediately by saving products directly to your browser storage, then transfer them to Google Sheets whenever you are ready.
- Full Dashboard: Review saved products in a visual gallery, inspect supplier links, adjust listing statuses, and track fulfillment orders in a filterable table.
- Order Links: Each order can keep the link to its eBay order page, read from Seller Hub when you import orders, and opened from the Orders table.
- AI Listing Generation: Listings (eBay title up to 80 characters, description, and item specifics) are written in the background after you add a product, using your own Gemini, Groq, or OpenRouter keys. Editable with one-click copy buttons for every field.
- Inspector: Click a dashboard card to inspect the product's cost, sell price, eBay fees, profit and margin, and its listing. Cost and sell price can be edited and are saved to your sheet; prices set by a sheet formula are never overwritten.
- eBay Listing Panel: A side panel on eBay listing pages (`ebay.com` and `ebay.co.uk`) that fills standard fields (title, SKU, description, price) and uses Gemini to fill item specifics. Unfillable fields become copy buttons; never presses "List it" and never fills Condition.
- eBay Listing Photos: Optionally pass up to 12 AliExpress gallery photos to eBay's uploader when filling forms, or save them to your Downloads folder as a fallback.
- Photos for Saved Products: Automatically retrieves share photos from public AliExpress pages for saved items without a photo, updating dashboard cards and filling empty sheet cells.
- Non-Destructive and Safe: AliSwift writes new rows, updates selected cells, and adds SKU, Image or Order link columns only when you confirm. It never deletes rows; Remove from Sheet (after a second click) clears only the cells AliSwift wrote in that product's row.
- Privacy First: No account registration. Product data is stored only on your device or in your own Sheet. Error reports (failure codes, timings, crash traces, counts; never keys, sheet names or order data) can be turned off in Settings. Your AI keys stay in local storage on this device, are sent only to their own provider, and are left out of settings export unless you tick Include my AI keys.

## Single-Purpose Statement

AliSwift is built solely to capture product details from AliExpress, apply user-defined retail pricing rules, and record the resulting product inventory and customer orders in the user's Google Sheets spreadsheet or local browser storage.

## Permission Justifications

Each requested permission and host permission in manifest.json is strictly required for core functionality:

1. `storage`:
   Required to store user preferences, sheet column configurations, pricing formulas, UI theme preferences, and offline library products locally on the device.

2. `identity`:
   Required to authenticate the user with their personal Google account via OAuth 2.0 so the extension can securely read and write to their chosen Google Sheets spreadsheets.

3. `https://*.aliexpress.com/*` and `https://*.aliexpress.us/*`:
   Required for content scripts to extract product titles, item prices, shipping charges, and image URLs on AliExpress item pages, and to inject the on-page save button.

4. `https://sheets.googleapis.com/*`:
   Required to communicate with the Google Sheets API v4 to append new product rows, create pre-configured dropshipping spreadsheets, and update order statuses in the user's spreadsheets.

5. `https://www.googleapis.com/drive/*`:
   Required to list spreadsheet names and verify sheets via the Google Drive API v3 (using read-only metadata scope drive.metadata.readonly). Google sign-in requests one scope list that includes this permission, which is required whether selecting a sheet from Drive or pasting a spreadsheet link.

6. `https://generativelanguage.googleapis.com/*`:
   Required to communicate directly with Google's Gemini API when you provide your own API key to perform automated column mapping on imported spreadsheets, generate product listings, and fill eBay form item specifics. The key stays in local storage on the device, is sent only to Google's Gemini API, and is left out of settings export unless you tick Include my AI keys. Groq and OpenRouter keys work the same way; their hosts are optional permissions requested only when a key for them is added. Column mapping sends headers and sample cells with a deny-list filter to exclude personal columns, and you can check the preview before saving.

7. `https://*.alicdn.com/*`:
   Required to load product image assets from AliExpress CDN so the service worker can provide them to Gemini for listing generation.

8. `https://*.aliexpress-media.com/*`:
   Required to load product media assets from AliExpress media CDN for Gemini listing generation.

9. `activeTab`:
   Lets the toolbar popup see the address of the current tab only when you click the icon, to show the save form on an AliExpress product page and the launcher elsewhere. No page is read and nothing is sent.

10. `downloads` (optional):
   Requested only when you turn on image inclusion in settings; used to save product photos to your Downloads folder if eBay's uploader does not take them.

## Data Usage Disclosure Answers

- Collection of Personal Information:
  No. AliSwift does not collect personal information. AliSwift has no account system and stores no product or order data on any server. The only thing sent to the developer is the optional error reports described in PRIVACY.md.
- Authentication Information:
  Yes. OAuth 2.0 tokens are managed by Chrome Identity solely to authenticate directly with Google APIs. Tokens are never transmitted to external servers.
- Financial and Payment Information:
  No. AliSwift does not handle payments, credit cards, or bank credentials.
- Location Data:
  No. AliSwift does not collect location or GPS data.
- Web History:
  No. Content scripts execute exclusively on matched AliExpress product pages and eBay listing pages to scrape details or fill form fields.
- User Data Sharing:
  User data is never sold, transferred, or shared with third parties or data brokers. All communication occurs directly between your browser and Google APIs.

## Screenshot Shot List

1. Screenshot 1: One-Click Saving on AliExpress
   - Page: AliExpress product detail page (`https://www.aliexpress.com/item/...`)
   - State: Product page showing the injected AliSwift button in success state ("Added as SKU-31") with the popup open displaying item details, calculated sell price, and target sheet.
   - Caption: Save products directly from AliExpress to your Google Sheet with calculated sell prices and automated SKUs.

2. Screenshot 2: Visual Products Dashboard
   - Page: AliSwift Dashboard (`dashboard/dashboard.html#products`)
   - State: Products gallery view showing product cards with photos, supplier links, profit margins highlighted with color-coded chips, and status dropdowns.
   - Caption: Manage your dropshipping inventory, monitor profit margins, and track listing statuses in one clean view.

3. Screenshot 3: Orders Management Table
   - Page: AliSwift Dashboard (`dashboard/dashboard.html#orders`)
   - State: Orders view showing customer orders with order numbers, SKUs, dates, quantities, sell totals, profit margins, and tracking numbers.
   - Caption: Keep track of customer orders, supplier costs, and net profits directly linked to your spreadsheet.

4. Screenshot 4: Auto-Configured Google Sheet
   - Page: Google Sheets workbook in browser
   - State: Inventory tab showing structured columns for SKU, title, supplier link, cost price, sell price, marketplace fees, net profit, margin, and status.
   - Caption: Pre-built templates for eBay UK, US, Global, Germany, Australia and Canada with automatic fee breakdowns and live currency rates.

5. Screenshot 5: Flexible Settings and Pricing Rules
   - Page: Settings page (`options/options.html#pricing`)
   - State: Pricing settings tab showing formula pricing builder (`costPrice * 1.7`), landed cost shipping toggles, buffer costs, and retail .99 rounding.
   - Caption: Customize your retail pricing rules, margin thresholds, landed shipping costs, and currency conversions.
