# Changelog

All notable changes to AliSwift. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

[Unreleased]: https://github.com/envyxyz/aliswift/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/envyxyz/aliswift/releases/tag/v0.5.0
