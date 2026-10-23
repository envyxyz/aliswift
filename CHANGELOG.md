# Changelog

Notable changes to AliSwift, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **License**: AliSwift is now free for personal use, including running your own store. Selling it or publishing it anywhere needs written permission (see LICENSE). Releases up to 1.0.5 keep the MIT License.
- **Docs**: a shorter README that walks through install and use, new screenshots and recordings, and a tidier changelog.
- **Listing writer** follows eBay search practice for titles, item specifics and descriptions. Press **Reset to default** in the AI tab to get the new instructions.
- **Buyer options** (sizes, colours, finishes) are read from the product page and used in item specifics and a new Available Options section.
- **Product photos** go to the AI by default (Gemini keys only), so colours and finishes come out right. Turn it off in the AI tab.
- **Placeholder specifications** like "None" or "Others" are filtered out before sending product details to the AI.

## [1.0.5] - 2026-10-19

### Added

- **Error reports** now include counts and step outcomes for listing and form fill, never product text or values.

### Changed

- **Focus styling** replaces the thick orange outline with a subtle border on text inputs across all extension pages.
- **AI key management** adds inline validation and a dialog to configure plan tiers, recommended models, and key visibility.
- **Item specifics** the product type implies (an age range for a toy, a department for clothes) are now filled. Press **Reset to default** in the AI tab to update the listing instructions.

### Fixed

- **Dashboard status menu** no longer flickers or opens the listing panel when selecting a product status.
- **Required item specifics** left blank by the AI are automatically retried once using the next available key.

## [1.0.4] - 2026-10-19

### Fixed

- **Sheet editing** opens properly for sheets that have all columns configured, allowing renaming, SKU updates, or deletion.
- **Modal dialogs** display thin, styled scrollbars instead of the browser's default wide gray scrollbar.

## [1.0.3] - 2026-10-19

### Added

- **Automatic updates** on Windows keep unpacked installations updated via background scheduled checks without overwriting user data.
- **Settings backup** can include AI keys (off by default) to simplify transferring configurations to new machines.

### Changed

- **Release notes** on GitHub now come from this changelog.

## [1.0.2] - 2026-10-19

### Changed

- **AliExpress button** labels display the destination sheet name or local library upon adding or removing products.
- **eBay panel cards** display "Queued" instead of "Writing listing..." until generation actively begins.

### Fixed

- **eBay description filling** uses multiple fallback methods to paste formatted content reliably into eBay's listing editor.
- **Description formatting and copying** preserve bold headings and bullet lists across eBay forms and clipboard.
- **Listing queue status** accurately reflects states (Queued, Writing, Waiting, Retry) instead of stalling indefinitely.
- **Dashboard delete action** clears the product row from the connected sheet or local library without touching orders.
- **AliExpress page button** detects saved products reliably across sessions and supports short `/i/` product URLs.
- **Settings loading spinners** rotate slowly instead of freezing when system reduced-motion preferences are active.

## [1.0.1] - 2026-10-19

### Fixed

- **Sheet import** no longer hangs indefinitely on "Reading..." when importing a spreadsheet without an AI key configured.

## [1.0.0] - 2026-10-19

### Added

- **Toolbar popup launcher** adds quick links to Seller Hub, Create listing, and AliExpress product search.
- **Google account avatar** displays the signed-in user's profile photo on the account button.
- **Product cards** open product details on click and provide a right-click context menu for quick actions.
- **eBay order links** are captured during Seller Hub imports and stored in an Order Link column.
- **Missing columns prompt** alerts when connecting sheets lacking SKU, Image, or Order link headers.
- **Add order dialog** includes a dedicated calendar date picker and allows clicking outside dialogs to dismiss.

### Changed

- **Product inspector** features a cleaner layout with marquee title scrolling, status badges, and simplified listing actions.
- **Dashboard and settings UI** polish dialogs, rename "Import sheet", and display converted currency notes with live hover rates.
- **Settings page** displays a lock and sign-in prompt when signed out instead of empty configuration tabs.

### Fixed

- **Order import** ignores eBay's "+ Add tracking" button text instead of importing it as a tracking number.
- **Dialog and popup layouts** eliminate unexpected scrollbars and unbalanced vertical spacing.

### Security

- **Permissions and links** restrict order URLs to HTTPS eBay domains and add minimal activeTab and profile scopes.

## [0.10.0] - 2026-10-18

### Added

- **Custom SKU prefixes** can be configured during sheet creation and are embedded directly into sheet formulas.
- **Photo uploader** downloads full gallery images from AliExpress and attaches them directly to eBay listings.

### Changed

- **Exchange rate conversion** operates automatically via cached live rates, removing manual currency rate inputs.
- **New sheet templates** use native marketplace currencies and protect formula-generated SKU columns from being overwritten.

### Fixed

- **eBay panel product cards** display current sheet SKUs and include draft products awaiting listing generation.
- **AliExpress photo button** maintains its position under eBay's upload button when eBay redraws the photo uploader.

## [0.9.0] - 2026-10-18

### Added

- **Photo download dialog** allows selecting gallery and variant photos with configurable destination folders and auto-sorting by SKU.
- **eBay panel live updates** reflect newly generated listings and dashboard selections immediately without reloading the page.

### Changed

- **Photo handling in panel** delegates image uploads to photo downloads, replacing direct form injection.
- **Listing pricing** pulls current sell prices directly from the active sheet when populating the eBay form.
- **Description styling** formats section headings with colons and converts bulleted text into structured lists.
- **eBay panel interactions** animate smoothly, prevent page shifts, and wait for form redraws before filling item specifics.
- **Settings and dashboard UI** update to toggle switches, structured AI key lists, and instant status updates.

### Fixed

- **AI permission prompts** explain the exact reason when Chrome denies permission to reach an AI provider endpoint.

## [0.8.0] - 2026-10-18

### Added

- **Remove from Sheet** button on AliExpress clears product row data and reuses empty rows for future additions.
- **Background listing queue** writes AI listings automatically after saving and persists across browser restarts.
- **Dashboard inspector side panel** displays pricing, fees, margins, and editable listing content.
- **Customizable fee rates** in settings calculate expected marketplace costs and net profits per sheet.
- **AI key pool** supports multiple Gemini, Groq, and OpenRouter keys with tier prioritization and model validation.
- **Send product photos** setting allows sending thumbnail images to Gemini during listing generation.
- **Order import sheet selector** allows choosing the target sheet when importing orders from Seller Hub.
- **Error reports** (optional) send failure codes and timings so problems can be fixed; see PRIVACY.md.

### Changed

- **eBay panel workflow** loads saved listings instantly without spreadsheet reads and simplifies form retries.
- **Listing storage** indexes by AliExpress item number so products retain listings across sheets.
- **AI request manager** routes across pooled keys with provider-specific defaults and rate-limit backoff.
- **Item specifics form filling** populates known fields directly, querying AI only for missing attributes.

## [0.7.1] - 2026-10-12

### Added

- **Missing columns prompt** offers to append SKU and Image columns automatically when connecting spreadsheets.
- **Photo caching and backup** stores product image links locally and includes them in settings backup files.
- **eBay image uploader** attaches full-size gallery photos to listing forms, falling back to the Downloads folder.
- **Variant photos** are captured on AliExpress and saved into dedicated sub-folders when listing items.
- **Photo backfill** fetches public product share images for existing dashboard items missing photos.

### Changed

- **Create sheet dialog** simplifies new sheet creation, adding a dedicated Image URL column to the template.
- **Image handling** detects true image file extensions and recovers from broken URLs using AliExpress share images.

### Removed

- **Manual sheet entry mode** removed in favor of connecting existing spreadsheets through Import sheet.

## [0.7.0] - 2026-10-12

### Added

- **Create Listing button** on AliExpress saves products, captures full details and photos, and generates listings immediately.
- **International marketplaces** add support for eBay Germany, Australia, Canada, and Global alongside US and UK.
- **eBay panel product list** displays saved listings with search, pricing, and form-fill diagnostic reports.
- **Order import** reads customer orders directly from Seller Hub into the Orders sheet tab.
- **AI element fallback** detects changed selectors on AliExpress, eBay forms, and Seller Hub order lists.

### Changed

- **eBay form filling** sets Buy It Now pricing, detects late-rendered fields, and keeps background workers active during AI requests.

### Fixed

- **Dashboard cards and dialogs** preserve uniform 4:3 image aspect ratios, resolve modal scrolling defects, and fix description whitespace verification.

### Security

- **Page buttons** ignore clicks made by a page's own scripts, and the extension answers each request only from the page it belongs to.

## [0.6.0] - 2026-10-12

### Added

- **Full-page dashboard** manages products and customer orders with live filtering, profit margins, and status editing.
- **AI listing generation** writes eBay titles, descriptions, and item specifics using your own Gemini API key.
- **eBay side panel** automatically populates listing details and item specifics on eBay listing pages.
- **Local library** enables saving products on-device without signing into a Google account.
- **Google Sheets integration** creates pre-configured dropshipping spreadsheets and imports existing sheets with column mapping.
- **Settings backup** exports and imports configuration and saved library items via JSON files.

### Changed

- **Extension signing key** updated; export and re-import settings when updating from older pre-release builds.
- **Settings page and UI components** introduce tabbed configuration, system light and dark themes, and accessible dropdowns.
- **Currency and data handling** improves multi-currency conversions and ensures non-destructive spreadsheet writes.
- **Browser requirement** raised to Chrome 119 or newer.

### Fixed

- **Dashboard accessibility and search** resolve race conditions during rapid filtering and add roving keyboard navigation.
- **Data parsing and sanitization** fix currency edge cases, multi-line order updates, dialog overflows, and unsafe URL protocols.

## [0.5.0]

### Added

- **Per-sheet settings** configure custom automation behavior for individual connected spreadsheets.
- **Title controls** allow configuring product title formatting and constraints.
- **Pricing options** introduce .99 price rounding and extra cost adjustments.
- **Shipping scraper** captures supplier shipping fees directly from AliExpress pages.

## 0.4.0

### Added

- **Title management** adds title length limits and keyword filtering for product titles.
- **Sale price toggle** allows choosing whether to capture promotional AliExpress prices.
- **Extra cost field** adds fixed cost padding to product price calculations.

## [0.3.0]

### Added

- **Column mapping** supports configuring custom spreadsheet column layouts for each sheet.
- **Spreadsheet updates** use batch writes and smart row detection to insert products reliably.

## [0.2.0]

### Added

- **Multi-sheet presets** allow dropshippers to switch between different pre-configured spreadsheets.
- **Formula pricing** calculates eBay listing prices automatically using spreadsheet formulas.
- **On-page button** adds an AliExpress save button with visual spinner feedback.

## [0.1.0]

### Added

- **Initial release** saves AliExpress products directly to Google Sheets with calculated pricing.

[Unreleased]: https://github.com/envyxyz/aliswift/compare/v1.0.5...HEAD
[1.0.5]: https://github.com/envyxyz/aliswift/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/envyxyz/aliswift/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/envyxyz/aliswift/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/envyxyz/aliswift/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/envyxyz/aliswift/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/envyxyz/aliswift/compare/v0.10.0...v1.0.0
[0.10.0]: https://github.com/envyxyz/aliswift/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/envyxyz/aliswift/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/envyxyz/aliswift/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/envyxyz/aliswift/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/envyxyz/aliswift/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/envyxyz/aliswift/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/envyxyz/aliswift/compare/v0.3.1...v0.5.0
[0.3.0]: https://github.com/envyxyz/aliswift/releases/tag/v0.3.0
[0.2.0]: https://github.com/envyxyz/aliswift/releases/tag/v0.2.0
[0.1.0]: https://github.com/envyxyz/aliswift/releases/tag/v0.1.0
