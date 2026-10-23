# Roadmap

Planned work, roughly in order. Nothing here has a date. Ideas and help are welcome: [open an issue](https://github.com/envyxyz/aliswift/issues/new/choose).

## Next: Etsy and Temu
eBay comes first. Etsy and Temu are the next marketplaces. If you sell on either and want to help shape it, open an issue with what your flow looks like.

## 1. Profit analytics on the dashboard
- **What it is**: Show revenue, profit, and margin by week and month, top products, and profit in your home currency.
- **Done**: Auto-created sheets track these totals in the Orders and Dashboard tabs, excluding cancelled orders.
- **Left**: A dashboard view that groups and displays totals from loaded orders. No new permissions required.

## 2. Profit across regions
- **What it is**: A unified view across all your sheets (such as eBay UK and eBay US), converted to your home currency.
- **Done**: Each sheet tracks its own currency, eBay site, fee settings, and exchange rate.
- **Left**: Read and combine orders and exchange rates across all sheets into one view. Add per-category fee rates if needed.

## 3. Adding eBay orders automatically
- **What it is**: Import orders from eBay Seller Hub instead of entering them by hand.
- **Done**: "Add all orders to sheet" on the Seller Hub order list reads visible orders and adds new ones to your sheet. The AI fallback handles wording changes.
- **Left**:
  - CSV report import: read downloaded Seller Hub order reports from the dashboard to import months of history at once.
  - Order page button: add an import button to individual Seller Hub order pages to read price and quantity.
  - eBay API: background sync with exact fees if needed.

## 4. Connecting AliExpress to pull orders and exact prices
- **What it is**: Capture exact paid amounts, currency, and tracking numbers from AliExpress orders.
- **Done**: Research into manual capture and supplier APIs.
- **Left**: An import button on AliExpress order detail pages to record exact order costs and tracking numbers.

## 5. Confirming eBay fee defaults against real orders
- **What it is**: Verify default marketplace fee rates against actual eBay order breakdowns.
- **Done**: Editable fee cells on the Inventory tab for UK (12.9% final value fee, 0.35% regulatory fee, 0.30 fixed fee, 20% VAT on fees, 1.55% international fee), US and Global (13.6% final value fee, 0.30 or 0.40 fixed fee, 1.55% international fee), and other regions.
- **Left**: Check published defaults against real fee statements. Users can adjust fee cells at the top of their sheet at any time.

## 6. Smaller items
- Automatically set product status to Listed when the eBay confirmation page appears.
- Minimum sell price guard per sheet.
- Fill item condition and variations on the eBay form.
- More eBay marketplaces (France, Italy, Spain, Ireland). Germany, Australia, Canada, and Global are available with published default rates.
- Bulk save from AliExpress search pages.
- Chrome Web Store release and Firefox support.
