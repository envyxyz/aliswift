# Frequently Asked Questions (FAQ)

Answers to common questions about using AliSwift for dropshipping.

## 1. Do I need to sign in with Google to use AliSwift?
No. Sign-in is completely optional. If you do not sign in, AliSwift operates in Local Library mode. Products are saved directly to your browser on your current device. You can browse them on the dashboard, view supplier links, and remove or restore them. When you are ready to connect a Google Sheet, you sign in with Google (which requests access to Sheets and read-only Drive metadata) and transfer your saved products with one click using the Move to a sheet tool. Note that connecting any Google Sheet, including pasting a spreadsheet link, requires this sign-in with the Drive scope.

## 2. Where does my product and order data live?
Product data is stored only on your own device (in your local library and exported settings file) or in your own Google Sheet, never on our servers (we have none). Your data lives exclusively in your own Google Sheets spreadsheet and in your local browser storage (`chrome.storage`). AliSwift has no central server, no project database, and no cloud account. The creators of AliSwift never receive or store your product details, order history, or sales figures.

## 3. How does AliSwift calculate eBay fees and profits?
When you create an auto-configured sheet for an eBay marketplace (UK, US, Global, Germany, Australia or Canada), AliSwift adds transparent fee calculation formulas to each row:
- eBay UK: calculates the standard final value fee (12.9%), regulatory operating fee (0.35%), fixed order fee (0.30), VAT on fees (20%), and international fee (1.55%).
- eBay US and Global (USD): calculates the standard final value fee (13.6%), fixed order fee (0.30 or 0.40), and international fee (1.55%).
- eBay Germany (12%, order fee 0.35 or 0.45, VAT on fees 19%), Australia (13.4%, order fee 0.30) and Canada (13.6%, order fee 0.30 or 0.40) use the published rates for most categories (October 2026).
These defaults are not checked against real orders, and eBay changes them often: compare them with an order's fee breakdown and edit the cells.
All fee parameters sit in editable cells at the top of your sheet, allowing you to tailor them to your specific eBay store subscription or seller status.

## 4. How does currency conversion work?
AliSwift supports multi-currency sourcing:
- If your AliExpress supplier displays prices in a foreign currency (such as USD or PKR) and your sheet is set up in GBP, AliSwift converts supplier costs at the live exchange rate from [ExchangeRate-API](https://www.exchangerate-api.com), refreshed every 12 hours. There is no rate to type in. Sheets stay in the marketplace currency: USD for eBay US and Global, GBP for eBay UK.
- When saving to your local library, items store prices in the original currency shown on the page. Conversion occurs seamlessly when you move products to your Google Sheet.

## 5. Why are there no photos on my dashboard?
The sheet has no Image column. Accept the "Add the missing columns?" offer (AliSwift also offers an Order link column for the Orders tab) or add an Image URL column and map it in the sheet's Edit dialog. Photos saved from now on are also kept on this device as a fallback.

## 6. Why did my older products have no photo, and how do they get one now?
Older versions of AliSwift did not save photo links. When the dashboard lists products that have a link but no photo, the service worker requests each product's public AliExpress page without cookies or sign-in, reads the page's share image address, keeps it on this device, and fills it into an empty Image cell in your sheet or library record.

## 7. How do photos get onto my eBay listing?
When the "Include images when creating listings from AliExpress" setting is turned on in the General tab, clicking **Fill form** in the eBay panel gets up to 12 gallery photos from AliExpress image hosts and gives them directly to eBay's photo uploader as files. If eBay's form does not take the photos, the service worker saves them to `Downloads\<sheet name>\<SKU>\` (or `Downloads\Library\<SKU>\` for local library items) so you can drag them into the photo box yourself. Variant photos are always saved into their own sub-folders under the SKU folder because eBay's single listing form has no place for them. The optional downloads permission is only used for this folder fallback, and the extension never uploads photos to any project server.

## 8. Why is AI used and is it required?
AI is completely optional. You can use all core features of AliSwift (scraping, pricing, saving to sheets, order management) without AI. AI is utilized for three high-value tasks:
1. Automated Column Mapping: When connecting an existing spreadsheet with unfamiliar header names, Gemini analyzes tab titles and headers to suggest accurate column mappings automatically.
2. Listing Generation: Generating search-optimized eBay listing titles, descriptions, and item specifics from product cards on the dashboard.
3. eBay Form Fill: Automatically matching and filling item specifics on eBay listing pages.
To use AI features, you provide your own AI key: a free Gemini key from Google AI Studio, or one from Groq or OpenRouter. You can add several; free keys are used first and a paid key takes over when every free one is busy. Settings, AI tab, **Get API keys** says where to get each.

## 9. What data is sent to the AI?
When AI features are invoked, requests travel directly from your browser to your key's provider (Gemini, Groq or OpenRouter) using your personal key.
- For AI column mapping, AliSwift sends column headers and a few sample cells to Gemini, with a filter that tries to leave out columns that look personal (names, addresses, phone numbers, and emails). Because the filter is a deny-list and can miss odd or unexpected headers, always check the mapping preview before confirming.
- For listing generation, the product title, sell price (never your cost), the page's specifications and description are sent, and up to two small photos if you turn that setting on.
- For the AI fallbacks: the names, labels and types of the eBay form's boxes (never what is typed in them); the pieces of an AliExpress page that hold a price, with their size and a few words around them; and, from Seller Hub's order list, only each row's order number, custom label (SKU), quantities, money and dates, with every other piece of text replaced by a placeholder.
- For eBay form filling, field names and available option choices from the eBay page are sent.
Requests are sent one at a time, and a timeout is not retried. Your AI keys stay in storage.local on this device, are sent only to their own provider, and are not included in settings export.

## 10. How do I undo an accidental product removal or change?
AliSwift enforces a strict non-destructive policy. It writes new product rows, updates status, tracking and the prices you edit in the inspector (never a cell that holds a formula), and adds missing SKU or Image columns when you answer yes. It never deletes rows. The only cells it clears are the ones it wrote in a product's row when you press Remove from Sheet (after a second click) or Delete on the dashboard (after its confirmation).
**Delete** on the dashboard (right-click a card) asks first, then clears the product's row in the sheet like Remove from Sheet does, so there is no undo for it: add the product again from its AliExpress page. Setting a product's status to **Removed** only changes its status cell to Discontinued, with an Undo button for 8 seconds; those products stay under the Removed tab, where you can restore them.

## 11. How can I back up or transfer my settings to another computer?
In the Settings page under the General tab, click **Export settings**. AliSwift generates an `aliswift-settings.json` file containing all your sheet configurations, pricing formulas, saved local library items, and photo links (photo links only, no image data). On your other computer, click **Import settings** to restore your setup. Your AI keys (which stay on this device in `storage.local`) and Google OAuth tokens are excluded from the backup file for your security.

## 12. Which supplier sites and selling platforms are supported?
- Sourcing: AliExpress (`aliexpress.com` and `aliexpress.us`) product detail pages and Buy Now pages.
- Selling: Pre-configured templates and fee structures are optimized for eBay UK and eBay US. The resulting Google Sheets can also be used as inventory feeds for Shopify, WooCommerce, or other ecommerce platforms.

## 13. What features are planned for future versions?
Upcoming planned features detailed on our roadmap include:
- Profit analytics on the dashboard and across regions.
- Adding eBay orders automatically (CSV import first).
- Connecting AliExpress to pull orders and exact prices (research only).
See [ROADMAP.md](../ROADMAP.md) for the complete development plan.

## 14. What is the Order Link column, and what happens if my sheet has none?
It keeps the link to each order's eBay page, so the arrow on an order in the dashboard opens that exact order. New sheets made by AliSwift have it. For a sheet you connected yourself, AliSwift tells you it is missing and offers to add it (a Yes is needed; nothing is added otherwise). Without it everything still works: the arrow opens Seller Hub by order number, and adding an order by hand uses the link only to read the order number.

## 15. How do I keep AliSwift up to date?
AliSwift is loaded from a folder, so Chrome does not update it. On Windows, run `setup-updates.bat` from the [latest release](https://github.com/envyxyz/aliswift/releases/latest) once (see the README's Install section): a scheduled task then checks GitHub at every sign-in and every hour, replaces the files, and the extension reloads itself within a minute. It never deletes files in the folder, and it refuses to write into a folder whose manifest key is not AliSwift's. On another system, unzip the newest release over the folder and press the reload arrow on `chrome://extensions`.
