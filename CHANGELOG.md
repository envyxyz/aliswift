# Changelog

All notable changes to AliSwift. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Auto sheets.** Add sheet now has an Auto / Manual switch. Auto asks for a name, a marketplace (eBay UK or eBay US) and your own currency, then creates a ready-made Google Sheet in your Drive with Dashboard, Inventory and Orders tabs. There are no columns or IDs to type. Manual is the old flow. After it is added, an Auto sheet is edited and used exactly like a Manual one.
- The new sheet has a fee settings strip (hidden), per-product fee, net profit and margin formulas, a live exchange rate with an optional backup rate, status drop-downs, a QTY column on Orders and a Dashboard with totals. Cancelled orders are left out of the totals. Every fee line is rounded to the penny, as eBay invoices it. The international fee and tax on fees are defaults to check against a real order: they are editable cells with a note.
- **SKUs.** A sheet with a SKU column gets the SKU the template would show for the new row ("Added as SKU-31" on the button and in the popup). If that SKU is taken, the highest number plus one is used.
- Edit sheet gains Marketplace, optional SKU, Status, Image, Profit and Margin columns with a SKU prefix, an Orders tab with its column map, and a "Use AliSwift template layout" button that fills all of them for a sheet you made by hand.
- **Settings backup.** Export settings saves your sheets and settings to a file; Import settings replaces them from a file, after a confirmation that shows the counts. Nothing from local storage (no keys, no cached data) is included.
- If the setup of a new sheet fails, the dialog offers "Retry setup" on the same file instead of leaving half a sheet behind.

### Changed

- **Sign-in key rotated.** The extension signing key was replaced and `manifest.json` now holds only the public key, with a new OAuth client. The extension ID changed, so Chrome treats the update as a new extension: export your settings before updating, then import them. Your sheets are not affected. A test now checks that the repo holds no private key.
- Settings are split into tabs: Sheets, Pricing, Title and General. Explanations moved out from under the inputs into "i" icons that show a tooltip on hover and keyboard focus.
- Each sheet has a pencil that opens an Edit sheet dialog (name, tab, first data row, columns). The "x" is gone. Delete sheet lives in that dialog and asks for confirmation there instead of in a browser popup.
- Pricing and Title edit the highlighted sheet, shown in a "Settings for" bar. Failed saves show a message with a Retry button.
- "Tab name" is now called "Sheet tab".
- The page button follows "Show the Add to Sheet button on AliExpress pages" straight away, without reloading the product page.
- Shared styles (`lib/ui.css`) now cover tabs, dialogs, tooltips, toasts and empty states, and `lib/ui.js` adds toasts. The popup and page button pick up the same error red.
- Requires Chrome 119 or newer.
- The page button and the popup show "Added as SKU-31" for three seconds (was two), so the SKU can be read.
- The next row is found from the SKU and keywords columns in one request.
- The service worker answers messages through one table of handlers, and only AliSwift's own pages can ask it to create a sheet.
- Popup and settings page redesigned. They use system fonts (no Google Fonts request), follow your system light or dark theme, and the popup picks sheets with a native dropdown.
- Settings now save as you change them. There is no Save button, and switching sheets no longer drops edits.
- Adding a sheet accepts the full Google Sheets link as well as the ID. New sheets start from default settings.
- The popup and the page button use the same pricing code. The popup used to leave out shipping.
- Removing a sheet asks for confirmation.
- Popup shows what to do when you are not on a product page, when no sheet exists, and when a page cannot be read.
- Dropped the `activeTab` permission and the unused `web_accessible_resources`. The manifest version now matches the release.
- The old profile button never showed an avatar because the Google scope for it was never granted. It is replaced by a Google account button that shows whether you are signed in and offers Sign out. A save never opens a Google window by itself.

### Fixed

- Saving the "Show the Add to Sheet button" setting now reports a failure ("Not saved" and a Retry button) and puts the checkbox back.
- A sheet name made only of spaces is rejected in Add and Edit.
- Delete is disabled in the Edit dialog once the sheet was deleted in another window, and Enter no longer saves while the delete question is showing.
- Keyboard focus no longer falls to the page after choosing a sheet chip or after closing the Edit dialog on a deleted sheet.
- Tooltips inside dialogs stay inside the dialog down to 320px wide, can be scrolled into view in a short window, and have an outline in forced-colors mode.

- "First data row" was saved in one place and read from another, so it was ignored.
- "Show button on AliExpress pages" was saved but never read.
- Parentheses in pricing formulas were silently ignored, so `(costPrice + 2) * 1.5` gave a wrong price. Formulas are now validated when you type them.
- Tab names with spaces or apostrophes failed with a Sheets API error.
- A product title starting with `=` was written with `USER_ENTERED` and could run as a spreadsheet formula. Rows are now written as `RAW`, with prices as real numbers.
- Turning off "Add the sell price" blanked the sell price column. Empty values are now skipped.
- A margin of 0 was reset to 25. Fractional margins were rounded down.
- Prices written with a decimal comma ("4,77") were read as 477.
- Switching sheets in the popup did not recalculate the sell price.
- An expired or revoked Google token now refreshes once instead of failing until you restart Chrome.
- Sheets API failures show Google's message instead of a bare status code.

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
