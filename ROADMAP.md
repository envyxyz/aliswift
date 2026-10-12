# Roadmap

Planned work, in the order we intend to build it. Nothing here is promised by a date.

## Next up: create the listing on eBay's form, not on the dashboard (agreed, not started)
Today the dashboard's **Create listing** asks Gemini for a title, description and item specifics, saves them, and the eBay panel then fills the form from that saved listing. The change: the dashboard only holds the products, and the listing is made at the moment it is needed, on eBay's own form.
- Dashboard: products are added and shown as now, but there is no listing step. The card's action is **List on eBay**, which opens eBay's listing start page with that product picked.
- eBay panel (the AliSwift tab on the right of the listing form): it shows every product on the sheet (not only ones with a saved listing). The seller picks one and presses **Create listing**.
- **Create listing** reads the form that is open (category, which item specifics and options it has) and writes the listing to fit it: title, description, and as many item specifics, condition, price and photos as can be filled properly and easily. Anything it can't fill reliably is left as a copy or "needs you" row, as now.
- Reuse: the existing form reading and filling (`lib/ebayform.js`, `lib/fillplan.js`, the panel in `content-ebay.js`), listing generation (`generateListing` in `background.js`), photos (`ebayPhoto`, `savePhotos`) and the product list (`ebayProductList`).
- To decide when building: whether the generated listing is still saved per product (so Fill form can be repeated without another Gemini call), and the one-call vs two-call split (listing text first, then item specifics against the form's real options).
- Known problem to fix first: the item-specifics AI step failed on a real ring listing with a generic "AI couldn't match this form" (the panel now shows the real reason; the cause was not found yet, a timeout is the first suspect, the call waits 45 s).

## 1. Profit analytics on the dashboard (planned)
Show what your Orders tab already tracks: revenue, profit and margin by week and month, best and worst products, and profit in your home currency.
- Already in place: every auto-created sheet has an Orders tab and a Dashboard tab with these totals; cancelled orders are excluded.
- To build: a third dashboard view that groups the orders it already loads. No new permissions required.

## 2. Profit across regions (planned)
One unified view over all your sheets (eBay UK, eBay US), converted to your home currency with each sheet's exchange rate.
- Already in place: each sheet has a region (currency, eBay site, fee settings) and its own exchange rate cell.
- To build: read every sheet's orders and exchange rate, then combine totals. Add payout currency conversion fee settings once confirmed for your account, and per-category fee rates if a flat rate per sheet proves too coarse.

## 3. Adding eBay orders automatically (list import done, the rest planned)
Options for adding orders automatically instead of typing them by hand from the dashboard:
- Done: **Add all orders to sheet** on Seller Hub's order list reads the page's text (no eBay API, no Gmail) and adds the orders the sheet does not have yet. It was written from a screenshot of Seller Hub's list (the list's markup was not saved), so the first real run may need a fix; the AI fallback covers a change in the page's wording.
- Still by hand: the order's actual sell price and tracking. The list shows neither per item.
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
- More marketplaces (France, Italy, Spain, Ireland): one line each in `lib/shared.js` and `lib/template.js` once their fee rules are checked. Germany, Australia, Canada and Global are in with published default rates that still need checking against real orders.
- Chrome Web Store release, bulk save from search pages, and Firefox support.
