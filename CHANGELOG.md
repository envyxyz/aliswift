# Changelog

All notable changes to AliSwift. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Settings are split into tabs: Sheets, Pricing, Title and General. Explanations moved out from under the inputs into "i" icons that show a tooltip on hover and keyboard focus.
- Each sheet has a pencil that opens an Edit sheet dialog (name, tab, first data row, columns). The "x" is gone. Delete sheet lives in that dialog and asks for confirmation there instead of in a browser popup.
- Pricing and Title edit the highlighted sheet, shown in a "Settings for" bar. Failed saves show a message with a Retry button.
- "Tab name" is now called "Sheet tab".
- The page button follows "Show the Add to Sheet button on AliExpress pages" straight away, without reloading the product page.
- Shared styles (`lib/ui.css`) now cover tabs, dialogs, tooltips, toasts and empty states, and `lib/ui.js` adds toasts. The popup and page button pick up the same error red.
- Requires Chrome 117 or newer.
- Popup and settings page redesigned. They use system fonts (no Google Fonts request), follow your system light or dark theme, and the popup picks sheets with a native dropdown.
- Settings now save as you change them. There is no Save button, and switching sheets no longer drops edits.
- Adding a sheet accepts the full Google Sheets link as well as the ID. New sheets start from default settings.
- The popup and the page button use the same pricing code. The popup used to leave out shipping.
- Removing a sheet asks for confirmation.
- Popup shows what to do when you are not on a product page, when no sheet exists, and when a page cannot be read.
- Dropped the `activeTab` permission and the unused `web_accessible_resources`. The manifest version now matches the release.
- Removed the profile button. It never showed an avatar because the Google scope for it was never granted.

### Fixed

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
