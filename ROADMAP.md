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
- **Done**: "Add all orders to sheet" on the Seller Hub order list reads visible orders, with the subtotal the buyer paid, and adds new ones to your sheet. The AI fallback handles wording changes. "Add eBay's exact fees to sheet" on the Payments page records what eBay paid for each order after fees and ad charges, so profit is exact.
- **Left**:
  - CSV report import: read downloaded Seller Hub order and transaction reports from the dashboard to import months of history at once.
  - Order page button: add an import button to individual Seller Hub order pages to read price and quantity.
  - eBay's own APIs need a secret key kept on a server, which a free extension with no server cannot hold. They stay out unless that changes.

## 4. Connecting AliExpress to pull orders and exact prices
- **What it is**: Capture exact paid amounts, currency, and tracking numbers from AliExpress orders.
- **Done**: Research into manual capture and supplier APIs.
- **Left**: An import button on AliExpress order detail pages to record exact order costs and tracking numbers.

## 5. Confirming eBay fee defaults against real orders
- **What it is**: Verify default marketplace fee rates against actual eBay order breakdowns.
- **Done**: Editable fee cells on the Inventory tab for UK (12.9% final value fee, 0.35% regulatory fee, 0.30 fixed fee, 20% VAT on fees, 1.55% international fee), US and Global (13.6% final value fee, 0.30 or 0.40 fixed fee, 1.55% international fee), and other regions.
- **Left**: Per-category rates (Jewelry & Watches is 15% on eBay US, most categories 13.6%). Users can adjust fee cells at the top of their sheet at any time, and orders with eBay's exact figure from the Payments page no longer depend on these defaults.

## 6. Discover: competition on eBay
- **What it is**: Rank Discover's products by how crowded eBay already is, not only by how well they sell on AliExpress.
- **Done**: Discover ranks by demand, momentum, margin, rating and price, and links each product to eBay's sold listings.
- **Left**: A competition score. eBay's listing counts are only available through its API, which needs a server-held key (see above).

## 7. Smaller items
- Automatically set product status to Listed when the eBay confirmation page appears.
- Minimum sell price guard per sheet.
- Fill item condition and variations on the eBay form.
- More eBay marketplaces (France, Italy, Spain, Ireland). Germany, Australia, Canada, and Global are available with published default rates.
- Bulk save from AliExpress search pages.
- Chrome Web Store release and Firefox support.
