# Frequently Asked Questions (FAQ)

Answers to common questions about using AliSwift for dropshipping.

## 1. Do I need to sign in with Google to use AliSwift?
No. Sign-in is optional. If you do not sign in, AliSwift operates in Local Library mode. Products are saved directly to your browser on your current device. You can browse them on the dashboard, view supplier links, and remove or restore them. When you are ready to connect a Google Sheet, sign in with Google (which requests access to Sheets and read-only Drive metadata) and transfer your saved products with one click using Move to a sheet. Connecting any Google Sheet, including pasting a spreadsheet link, requires this sign-in with the Drive scope.

## 2. Where does my product and order data live?
AliSwift has no account system and stores no product or order data on any server. The only thing it sends to the developer is error reports (failure codes, timings and crash traces), which you can turn off in Settings, General. [PRIVACY.md](../PRIVACY.md#error-reports) lists what they contain.

Your data lives exclusively in your own Google Sheet and in your local browser storage (`chrome.storage`). The developer never receives or stores your product details, order history, or sales figures.

## 3. How does AliSwift calculate eBay fees and profits?
When you create an auto-configured sheet for an eBay marketplace (UK, US, Global, Germany, Australia or Canada), AliSwift adds fee calculation formulas to each row:
- eBay UK: standard final value fee (12.9%), regulatory operating fee (0.35%), fixed order fee (0.30), VAT on fees (20%), and international fee (1.55%).
- eBay US and Global (USD): standard final value fee (13.6%), fixed order fee (0.30 or 0.40), and international fee (1.55%).
- eBay Germany (12%, order fee 0.35 or 0.45, VAT on fees 19%), Australia (13.4%, order fee 0.30) and Canada (13.6%, order fee 0.30 or 0.40) use published rates for most categories (October 2026).

These defaults haven't been checked against real orders yet. If your fees differ, compare them with an order's fee breakdown and edit the cells. All fee parameters sit in editable cells at the top of your sheet, so you can tailor them to your store subscription or seller status.

## 4. How does currency conversion work?
AliSwift supports multi-currency sourcing:
- If your AliExpress supplier displays prices in a foreign currency (such as USD or PKR) and your sheet is set up in GBP, AliSwift converts supplier costs at the live exchange rate from [ExchangeRate-API](https://www.exchangerate-api.com), refreshed every 12 hours. You do not need to type in a rate. Sheets stay in the marketplace currency: USD for eBay US and Global, GBP for eBay UK.
- When saving to your local library, items store prices in the original currency shown on the page. Conversion happens automatically when you move products to your Google Sheet.

## 5. Why are there no photos on my dashboard?
The sheet has no Image column. Accept the "Add the missing columns?" prompt (AliSwift also offers an Order link column for the Orders tab) or add an Image URL column and map it in the sheet's Edit dialog. Photos saved from now on are also kept on this device as a fallback.

## 6. Why did my older products have no photo, and how do they get one now?
When the dashboard lists products that have a link but no photo, the service worker requests each product's public AliExpress page without cookies or sign-in. It reads the page's share image address, keeps it on this device, and fills it into an empty Image cell in your sheet or library record.

## 7. How do photos get onto my eBay listing?
Turn on **Allow photo downloads** in Settings, General (Chrome asks for the downloads permission once). On eBay's listing form, press **Add from AliExpress** under the photo uploader. A window shows the product's gallery (up to 12 photos) and a photo for each variant; pick the ones you want. AliSwift saves them to `Downloads\<sheet name>\<SKU>\` (or `Downloads\Library\<SKU>\` for library products; you can change the folder and turn sorting off) and adds them to the listing's photos. If eBay doesn't take them, drag them in from that folder. **Fill form** doesn't touch photos, and photos never go anywhere except your Downloads folder and eBay's own form.

## 8. Why is AI used and is it required?
AI is completely optional. You can use all core features of AliSwift (scraping, pricing, saving to sheets, order management) without AI. AI is used for three tasks:
1. Automated Column Mapping: When connecting an existing spreadsheet with unfamiliar header names, Gemini analyzes tab titles and headers to suggest column mappings.
2. Listing Generation: Generating eBay listing titles, descriptions, and item specifics from product cards on the dashboard.
3. eBay Form Fill: Matching and filling item specifics on eBay listing pages.

To use AI features, you provide your own AI key: a free Gemini key from Google AI Studio, or one from Groq or OpenRouter. You can add several; free keys are used first, and a paid key takes over when every free key is busy. In Settings under the AI tab, click **Get API keys** to find where to get each.

## 9. What data is sent to the AI?
When AI features run, requests travel directly from your browser to your key's provider (Gemini, Groq or OpenRouter) using your personal key.
- For AI column mapping, AliSwift sends column headers and a few sample cells to Gemini, with a filter that tries to leave out columns that look personal (names, addresses, phone numbers, and emails). Because the filter is a deny-list and can miss odd or unexpected headers, check the mapping preview before confirming.
- For listing generation, the product title, sell price (never your cost), the page's specifications, the options a buyer can choose, and description are sent, plus up to two small product photos with a Gemini key (on by default; turn it off in the AI tab).
- For the AI fallbacks: the names, labels, and types of the eBay form's boxes (never what is typed in them); the pieces of an AliExpress page that hold a price, with their size and a few words around them; and, from Seller Hub's order list, only each row's order number, custom label (SKU), quantities, money, and dates, with every other piece of text replaced by a placeholder.
- For eBay form filling, field names and available option choices from the eBay page are sent.

Requests are sent one at a time, and a timeout is not retried. Your AI keys stay in local storage on this device, are sent only to their own provider, and are left out of settings export unless you tick **Include my AI keys** when exporting.

## 10. How do I undo an accidental product removal or change?
AliSwift follows a strict non-destructive policy. It writes new product rows, updates status, tracking, and the prices you edit in the inspector (never a cell that holds a formula), and adds missing SKU or Image columns when you confirm. It never deletes rows. The only cells it clears are the ones it wrote in a product's row when you click Remove from Sheet (after a second click) or Delete on the dashboard (after confirmation).

**Delete** on the dashboard (right-click a card) asks first, then clears the product's row in the sheet, so there is no undo for it: add the product again from its AliExpress page. Setting a product's status to **Removed** only changes its status cell to Discontinued, with an Undo button for 8 seconds; those products stay under the Removed tab, where you can restore them.

## 11. How can I back up or transfer my settings to another computer?
In Settings under the General tab, click **Export settings**. AliSwift generates an `aliswift-settings.json` file containing your sheet configurations, pricing formulas, saved local library items, and photo links (photo links only, no image data). On your other computer, click **Import settings** to restore your setup. Google OAuth tokens are never in the file. Your AI keys stay on this device in local storage and are left out unless you tick **Include my AI keys** before exporting. If included, the file holds them in plain text, so keep it private; importing it on the other computer restores them there.

## 12. Which supplier sites and selling platforms are supported?
- Sourcing: AliExpress (`aliexpress.com` and `aliexpress.us`) product detail pages and Buy Now pages.
- Selling: Pre-configured templates and fee structures are set up for eBay UK, US, Global, Germany, Australia and Canada. The resulting Google Sheets can also be used as inventory feeds for WooCommerce or other ecommerce platforms.

## 13. What features are planned for future versions?
Planned features include:
- More marketplaces: Etsy and Temu support after eBay.
- Profit analytics on the dashboard and across regions.
- Automated eBay order importing (CSV import first).
- Connecting AliExpress to pull orders and exact prices.

See [ROADMAP.md](ROADMAP.md) for details.

## 14. What is the Order Link column, and what happens if my sheet has none?
It stores the link to each order's eBay page so the arrow on an order in the dashboard opens that exact order. New sheets created by AliSwift include it. For a sheet you connected yourself, AliSwift asks to add it if missing (nothing is added without confirmation). Without it, everything still works: the arrow opens Seller Hub by order number, and manual order entry uses the link only to read the order number.

## 15. How do I keep AliSwift up to date?
AliSwift is loaded from a folder, so Chrome does not update it automatically. On Windows, run `setup-updates.bat` from the [latest release](https://github.com/envyxyz/aliswift/releases/latest) once: a scheduled task checks GitHub at sign-in and hourly, replaces the files, and the extension reloads within a minute. On other systems, unzip the newest release over the folder and click the reload button on `chrome://extensions`.
