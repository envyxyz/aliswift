# Roadmap

Planned work, in the order we intend to build it. Nothing here is promised by a date.

## 1. Profit analytics on the dashboard (planned)
Show what your Orders tab already tracks: revenue, profit and margin by week and month, best and worst products, and profit in your home currency.
- Already in place: every auto-created sheet has an Orders tab and a Dashboard tab with these totals; cancelled orders are excluded.
- To build: a third dashboard view that groups the orders it already loads. No new permissions required.

## 2. Profit across regions (planned)
One unified view over all your sheets (eBay UK, eBay US), converted to your home currency with each sheet's exchange rate.
- Already in place: each sheet has a region (currency, eBay site, fee settings) and its own exchange rate cell.
- To build: read every sheet's orders and exchange rate, then combine totals. Add payout currency conversion fee settings once confirmed for your account, and per-category fee rates if a flat rate per sheet proves too coarse.

## 3. Adding eBay orders automatically (planned)
Options for adding orders automatically instead of typing them by hand from the dashboard:
- Today you add an order by hand from the dashboard.
- Option 1 (unverified): Import eBay's own orders report. Seller Hub downloads orders as a CSV file. The dashboard reads the file and adds missing orders. No new permissions, no page scraping, works for months of history at once.
- Option 2 (unverified): A button on Seller Hub order pages. The extension adds an "Add to AliSwift" button to an order page (and "Add all" to the orders list) to read order number, custom label, quantity and price. Falls back to the manual dialog. The Seller Hub report format and page layout have not been checked.
- Option 3: eBay's finance and order APIs. Background sync where the finance API returns exact fees. Requires an eBay developer account and a backend server to hold the app secret securely.
- Plan: the import first, then the button, then the API if exact fees or hands-off import matter enough to run a server. Reading sale emails from Gmail is not planned because Google treats mail access as a restricted permission requiring a costly security audit.
- Already in place: the custom label on listings is the sheet SKU; adding an order refuses an order number and SKU pair that is already there, so imports can be repeated safely.

## 4. Connecting AliExpress to pull orders and exact prices (planned)
Research findings (unverified):
- Official AliExpress Dropshipping APIs require business registration, manual approval, and cryptographic request signing with an app secret. A serverless extension cannot hold the secret securely, and approval for the official API as a private person is likely to be refused.
- Scraping the buyer's order page: AliExpress terms forbid automated collection. A user-clicked button on the owner's own order page is a lower risk that is still unconfirmed.
- Candidate plan: start with a manual user-clicked button on the AliExpress order detail page to capture the exact paid amount, currency and tracking number.

## 5. Confirming eBay fee defaults against real orders (planned)
Check the default fee rates against real order fee breakdowns in eBay Seller Hub.
- Already in place: editable fee cells on the Inventory tab for UK final value fee (12.9%), regulatory fee (0.35%), fixed order fee (0.30 or 0.40), VAT on fees (20%), and international fee (1.55%).
- To confirm: verify whether the 1.55% international fee applies to the account, and confirm the VAT on fees treatment against an actual invoice. Account type (business or private), buyer VAT on top, and US defaults (13.6% final value fee, 1.55% international fee) are also unconfirmed.

## 6. Smaller items (planned)
- Detect eBay "listing published" confirmation page and set product status to Listed automatically.
- Minimum sell price guard per sheet.
- Fill item condition and variations on the eBay form.
- More marketplace regions (Canada, Australia, Germany) once fee rules are verified.
- Chrome Web Store release, bulk save from search pages, and Firefox support.
