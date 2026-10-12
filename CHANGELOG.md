# Changelog

All notable changes to AliSwift. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.7.1] - 2026-10-12

### Added

- **Missing columns prompt**: When a sheet is imported without an SKU column or Image column mapped, AliSwift asks whether to add them before saving the sheet (Yes, add them / No / Go back). Choosing Yes adds the missing columns after the last column with a value on the Inventory tab, formats headers like adjacent ones, assigns SKUs to existing products using the sheet's prefix, and fills known photo links into the Image URL column. The same offer is available via an **Add columns** notice in the sheet's Edit dialog. Columns are only added if they fit within columns A to Z, and AliSwift writes only into new empty columns without changing existing cells.
- **On-device photo fallback**: Product photo links are saved to device storage (`chrome.storage.local`, key `photos`, up to the newest 5000) by AliExpress item number whenever products are saved to a sheet. The dashboard uses these links when a sheet has no Image column or when the cell is empty.
- **Photo links in settings backup**: The settings backup file (`aliswift-settings.json`) now includes photo links (`photos`, links only, no image data). Export settings includes them and Import settings merges them without replacing existing entries.
- **Include images when creating listings**: A new setting in Settings under the General tab (off by default, stored in synced settings as `includeImages` and included in settings backups). When enabled, clicking **Fill form** on eBay retrieves up to 12 full-size gallery photos from AliExpress image hosts via the service worker (JPEG, PNG or WebP, up to 3 MB each) and hands them to eBay's photo uploader as files. The panel displays a Photos row marked Filled once thumbnails appear.
- **Downloads folder photo fallback and optional permission**: When eBay's form does not accept the photos or its uploader changes, the service worker saves the images to `Downloads\<sheet name>\<SKU>\` (or `Downloads\Library\<SKU>\` for local library items) as `img-01.jpg`, `img-02.png` and so on. The Photos row directs the seller to drag them into eBay's photo box. Enabling the setting requests Chrome's optional `downloads` permission; the permission is not needed to install or attach photos, and if refused, the setting still works without the folder fallback.
- **Variant photos**: On AliExpress product pages, options that display a picture of their own (such as a colour or style) are read when saving (Add to Sheet or Create Listing) without clicking anything on the page, keeping up to 40 variants per product; text-only options without pictures are ignored. When Include images is enabled, clicking **Fill form** in the eBay panel saves each variant's full-size photo to its own sub-folder named after the variant (`Downloads\<sheet name>\<SKU>\<variant name>\img-01.jpg` or `.webp`, with distinct folders if variant names collide). Variant photos are always saved to their sub-folders because eBay's single listing form has no place for them, while the panel continues to attach only gallery photos to the form. A "Variant photos" row appears in the eBay panel.
- **Photos for older products**: When the dashboard lists products that have a link but no photo, the service worker fetches each product's public AliExpress page (`https://www.aliexpress.com/item/<item number>.html`, three at a time, up to 60 per round, without cookies or sign-in) to read its share image (`og:image`) address. The photo is kept on the device, shown on the product card without redrawing the list, and written into an empty Image cell if the sheet has an Image column (or into the product's record for the local library). Pages that return no photo are not queried again for 3 days. Only addresses on AliExpress image hosts are accepted. If the sheet is read-only or signed out, the photo is still kept on the device and shown on the card.

### Changed

- **Broken card photos**: When a sheet photo will not load, the card asks for the product's AliExpress share image instead, and shows the image icon only if the product has none. AliExpress's check page or a network error is no longer remembered as "no photo"; it stops the round and is retried on the next visit.
- **Dashboard cards no longer show the margin percentage tag.**
- **Create sheet dialog**: The Add sheet dialog is now called Create sheet (buttons: **Create sheet** in the header, **Create a sheet** in the empty state, dialog title **Create sheet**). It now only creates new Google Sheets, with the Auto/Manual switch removed. Existing spreadsheets are connected through **Import from Google Sheets**, and column letters can be edited later in the sheet's Edit dialog (pencil icon).
- **Visible Image URL column**: The auto-created sheet template now includes a visible 160 px wide Image URL column (column O) on the Inventory tab, with a header note explaining that AliSwift fills it with the product photo link and the dashboard displays the photo from it.
- **Saved image file formats**: Saved photos now use their actual image format (such as `.webp` when AliExpress sends WebP data for an address ending in `.jpg`) rather than assuming the file extension from the URL.

### Removed

- **Manual sheet creation in dialog**: Removed the manual mode from the sheet creation dialog (entering a sheet ID and column letters). Existing spreadsheets are now connected using **Import from Google Sheets**.

## [0.7.0] - 2026-10-12

### Added

- **Create Listing** button beside Add to Sheet on AliExpress product pages: saves the product, writes the AI listing and opens eBay in one press. Reuses the SKU and the kept listing of a product already saved from the same link.
- The page and the popup now keep the product's full title, specifications and gallery photos with each save, so the listing is written from far more than the sheet's short name.
- **Marketplaces**: eBay Global (USD), Germany, Australia and Canada, next to UK and US. Each has its currency, fee defaults, eBay site and listing language (German for eBay Germany). The eBay panel runs on all of their listing forms.
- **eBay panel product cards**: the products that have a listing, newest first, with search. Clicking one makes it the product to list; the price always comes from AliSwift's own list.
- **Add all orders to sheet** on Seller Hub's order list. Goes to All orders first, reads the page from its text, skips orders already in the Orders tab (order number and SKU) and says when more pages of results remain.
- **AI fallbacks** (Gemini, your key) for when a page changes: the eBay form's boxes, Seller Hub's order rows and AliExpress's price. The AI only points at things the page listed, and order rows reach it with every name and address hidden.
- **Copy report** in the eBay panel: the form's box names and what the pass did, never what was typed.

### Changed

- The eBay panel now sets the format to Buy It Now before it types the price (in an auction the same box is an optional price that must beat the starting bid), waits for boxes eBay draws late, checks each value again a moment after it was set, and types it the way a person does when setting it was not taken. The custom label switch and the description's HTML box are found by what a seller reads beside them when eBay renames them.
- A listing keeps the product it was written for, so the panel needs no sheet read.
- Chrome's worker is kept awake while Gemini is still answering (a listing with photos can take over 30 seconds).

### Fixed

- Dashboard cards: a square photo no longer makes its card taller than the others in its row (the photo box now keeps its 4:3 shape whatever the photo's own).
- eBay panel: the description was reported as not filled when eBay's editor reformatted the spaces; it is now compared by its words.
- Options dialog: fixed modal container layout to prevent outer scrolling and empty space below the action buttons.

### Security

- The two AliExpress page buttons and the orders button ignore clicks made by the page's own scripts (`isTrusted`), so a page can no longer press them to write to your sheet, call Gemini or open tabs.
- The service worker answers saves, rates and Create Listing only to AliExpress product pages and AliSwift's own pages, order imports only to Seller Hub, and each AI task only to the page it is about. The eBay panel can no longer save a product.
- The extension pages have an explicit content security policy (`script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`).

## [0.6.0] - 2026-10-12

### Added

- **Full-page dashboard**: A dedicated workspace (`dashboard/dashboard.html`) opened from the popup and Settings:
  - Products view: card-based gallery showing product photos, titles, prices, supplier links, profit margins with color-coded chips, and inline status editing.
  - Orders view: table tracking customer orders with quantities, sell totals, costs, profits, fulfillment statuses, tracking numbers, and customer notes.
  - Live filtering: instant search, status tabs (Active, Draft, Listed, Not listed, Removed), and sorting.
  - Order management dialogs: Add order dialog with product auto-matching and pre-fill, and Edit order dialog with double-submit guards and focus restoration.
  - Safe removal and undo: removing a product sets status to Discontinued; an 8-second toast allows instant undo.
- **AI listing generation**: From a product card on the dashboard, "Create listing" uses your own Gemini key to write an eBay title (up to 80 characters), description, and item specifics. Fully editable with one-click copy buttons for every field.
- **eBay panel and form fill**: An injected side panel on eBay listing pages (`ebay.com` and `ebay.co.uk`), for the product picked with **List on eBay** on the dashboard, that fills deterministic fields (title, SKU, description, price) and uses Gemini to fill item specifics. Unknown control kinds and unfillable fields become copy buttons. It never presses "List it" and never fills Condition.
- **Local library on device**: Sign-in is optional. Dropshippers can save products directly to their device (`chrome.storage.local`) without a Google account. The page button and popup switch to "Save to library" and assign local SKUs (such as L-01). Product data is stored only on the device or in your own Sheet, never on project servers.
- **Move to sheet flow**: Move saved local library products into any connected Google Sheet with one click. Applies sheet exchange rates, prompts for missing rates, and safely skips items already in the sheet without deleting any data.
- **Import from Google Sheets**: Connect an existing spreadsheet from your Drive or by pasting its link. Sign-in requests one combined scope list that includes `drive.metadata.readonly` to list spreadsheets and verify pasted links. Automatically identifies Inventory and Orders tabs, maps column headers, and supports optional AI column mapping with Gemini. Column mapping sends headers and sample cells with a deny-list filter that tries to leave out personal columns, and users check the mapping preview before confirming.
- **AI tab and Gemini integration**: Store your own Gemini API key in `chrome.storage.local` on this device. The key is sent only to Google's Gemini API, is not included in settings export, and is never synced. Gemini requests allow up to 15 s per attempt and retry once (up to about 30 s total).
- **Auto sheet creation**: One-click creation of a pre-configured Google Sheet in Google Drive with Dashboard, Inventory, and Orders tabs, fee calculations, and currency formulas for eBay UK or eBay US.
- **Settings export and import**: Backup sheets and local library products to a JSON file. Import safely merges items and validates structure.

### Changed

- **Sign-in key rotated**: The extension signing key was updated to a dedicated production key, and `manifest.json` holds only the public key. Settings must be exported and re-imported when updating from older builds. Your sheets are not affected.
- **Currency handling overhaul**: Added explicit region currency tracking, support for multi-currency saves, and currency code formatting for non-marketplace items.
- **Themed select controls**: Replaced standard dropdowns with accessible, themed select elements following system light and dark themes.
- **Strict non-destructive writes**: Ensured no handler or dashboard action can delete rows or clear cells in a user spreadsheet. Stored product and order data remains on-device or in the user's Sheet only.
- **Settings redesign**: Restructured settings into Sheets, Pricing, Title, AI, and General tabs with live auto-saving.
- **Shared UI framework**: `lib/ui.css` and `lib/ui.js` now provide unified tokens, tabs, dialogs, tooltips, toasts, and empty states across popup, options, and dashboard pages.
- Requires Chrome 119 or newer.

### Fixed

- Fixed stale response races during rapid tab switching and search by introducing independent stale guards for products and orders.
- Fixed keyboard accessibility: added roving tabindex for dashboard tabs (ArrowLeft, ArrowRight, Home, End) and focus trap in modal dialogs.
- Fixed order editing multi-line ambiguity by sending specific row and SKU keys in patch requests.
- Fixed currency formatting edge cases to return clean numbers when currency codes are missing.
- Fixed URL sanitization to reject javascript:, data:, and file: protocols.
- Fixed tooltip overflow inside dialogs down to 320px viewport widths and added high-contrast outlines in forced-colors mode.

## [0.5.0]

Per-sheet behavior settings, title controls, .99 rounding, extra cost, shipping scraper.

## [0.4.0]

Title length, keyword filter, sale price toggle, extra cost field.

## [0.3.0]

Per-sheet column mapping, batchUpdate writes, smart row detection.

## [0.2.0]

Multi-sheet presets, formula pricing, on-page button, spinner feedback.

## [0.1.0]

Initial release.

[Unreleased]: https://github.com/envyxyz/aliswift/compare/v0.7.1...HEAD
[0.7.1]: https://github.com/envyxyz/aliswift/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/envyxyz/aliswift/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/envyxyz/aliswift/releases/tag/v0.6.0
[0.5.0]: https://github.com/envyxyz/aliswift/releases/tag/v0.5.0
