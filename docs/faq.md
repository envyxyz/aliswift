# Frequently Asked Questions (FAQ)

Answers to common questions about using AliSwift for dropshipping.

## 1. Do I need to sign in with Google to use AliSwift?
No. Sign-in is completely optional. If you do not sign in, AliSwift operates in Local Library mode. Products are saved directly to your browser on your current device. You can browse them on the dashboard, view supplier links, and remove or restore them. When you are ready to connect a Google Sheet, you sign in with Google (which requests access to Sheets and read-only Drive metadata) and transfer your saved products with one click using the Move to a sheet tool. Note that connecting any Google Sheet, including pasting a spreadsheet link, requires this sign-in with the Drive scope.

## 2. Where does my product and order data live?
Product data is stored only on your own device (in your local library and exported settings file) or in your own Google Sheet, never on our servers (we have none). Your data lives exclusively in your own Google Sheets spreadsheet and in your local browser storage (`chrome.storage`). AliSwift has no central server, no project database, and no cloud account. The creators of AliSwift never receive or store your product details, order history, or sales figures.

## 3. How does AliSwift calculate eBay fees and profits?
When you create an auto-configured sheet for eBay UK or eBay US, AliSwift adds transparent fee calculation formulas to each row:
- eBay UK: calculates the standard final value fee (12.9%), regulatory operating fee (0.35%), fixed order fee (0.30), VAT on fees (20%), and international fee (1.55%).
- eBay US: calculates the standard final value fee (13.6%), fixed order fee (0.40), and international fee (1.55%).
All fee parameters sit in editable cells at the top of your sheet, allowing you to tailor them to your specific eBay store subscription or seller status.

## 4. How does currency conversion work?
AliSwift supports multi-currency sourcing:
- If your AliExpress supplier displays prices in a foreign currency (such as USD or PKR) and your sheet is set up in GBP, AliSwift uses the live exchange rate formula embedded in your sheet (or your custom manual rate) to convert supplier costs.
- When saving to your local library, items store prices in the original currency shown on the page. Conversion occurs seamlessly when you move products to your Google Sheet.

## 5. Why is AI used and is it required?
AI is completely optional. You can use all core features of AliSwift (scraping, pricing, saving to sheets, order management) without AI. AI is utilized for three high-value tasks:
1. Automated Column Mapping: When connecting an existing spreadsheet with unfamiliar header names, Gemini analyzes tab titles and headers to suggest accurate column mappings automatically.
2. Listing Generation: Generating search-optimized eBay listing titles, descriptions, and item specifics from product cards on the dashboard.
3. eBay Form Fill: Automatically matching and filling item specifics on eBay listing pages.
To use AI features, you provide your own free Gemini API key from Google AI Studio.

## 6. What data is sent to Gemini?
When AI features are invoked, requests travel directly from your browser to Google's Gemini API using your personal key.
- For AI column mapping, AliSwift sends column headers and a few sample cells to Gemini, with a filter that tries to leave out columns that look personal (names, addresses, phone numbers, and emails). Because the filter is a deny-list and can miss odd or unexpected headers, always check the mapping preview before confirming.
- For listing generation, the product title, price, details and its first photo are sent.
- For eBay form filling, field names and available option choices from the eBay page are sent.
Each Gemini call has a 15 s timeout and retries once, so requests take up to about 30 s total. Your Gemini API key stays in storage.local on this device, is sent only to Google's Gemini API, and is not included in settings export.

## 7. How do I undo an accidental product removal or change?
AliSwift enforces a strict non-destructive policy. It never deletes rows from your spreadsheet.
When you remove a product on the dashboard, AliSwift simply updates its status cell to Discontinued. A confirmation toast appears with an Undo button for 8 seconds. Clicking Undo immediately restores the item to its previous status. You can also view all discontinued products at any time under the Removed filter tab on the dashboard and restore them whenever you wish.

## 8. How can I back up or transfer my settings to another computer?
In the Settings page under the General tab, click **Export settings**. AliSwift generates an `aliswift-settings.json` file containing all your sheet configurations, pricing formulas, and saved local library items. On your other computer, click **Import settings** to restore your setup. Your secret Gemini key (which stays on this device in `storage.local`) and Google OAuth tokens are excluded from the backup file for your security.

## 9. Which supplier sites and selling platforms are supported?
- Sourcing: AliExpress (`aliexpress.com` and `aliexpress.us`) product detail pages and Buy Now pages.
- Selling: Pre-configured templates and fee structures are optimized for eBay UK and eBay US. The resulting Google Sheets can also be used as inventory feeds for Shopify, WooCommerce, or other ecommerce platforms.

## 10. What features are planned for future versions?
Upcoming planned features detailed on our roadmap include:
- Profit analytics on the dashboard and across regions.
- Adding eBay orders automatically (CSV import first).
- Connecting AliExpress to pull orders and exact prices (research only).
See [ROADMAP.md](../ROADMAP.md) for the complete development plan.
