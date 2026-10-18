# Changelog

All notable changes to AliSwift. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.1] - 2026-10-19

### Fixed

- **Import sheet hung on its loader.** Choosing a sheet to import never got past "Reading..." because the step that matches columns read an AI-key variable that no longer exists, so it failed before it started. It now checks the saved AI keys, so import works with or without a key. Nothing in your sheets or settings was changed by the failure.

## [1.0.0] - 2026-10-19

The first stable release. AliSwift now covers the whole loop for an eBay dropshipper who sources from AliExpress: save a product, price it, write its listing, put it on eBay, and track the order that comes back, with every step working from Chrome and your own Google Sheet.

### Added

- **A launcher in the toolbar popup**: on any page that is not an AliExpress product page, the popup shows a search box for AliExpress and one-click **Seller Hub** and **Create listing** buttons, opening on the eBay site of your active sheet's marketplace (eBay US with no sheet). On other AliExpress pages it adds a line saying to open a product to save it. The popup reads the address of the current tab only when you click the icon (the `activeTab` permission, which shows no install warning).
- **Your Google profile picture** on the account button, replacing the generic icon and the green dot. A Google default avatar is shown in greyscale. It needs the basic `userinfo.profile` scope, so you sign in once more after updating; your settings and AI keys are not touched. Only the photo address is read, and it is kept on the device for a day.
- **Right-click menu on a product card**: **View Product** (opens the AliExpress page), **Add order** (opens the Add order form for that product) and **Delete**. It grows out of the pointer, flips to stay on screen and works from the keyboard.
- **Click a product card to open it**: the card opens the product's details and listing. The status control and the old delete, add-order, View product and eye buttons are replaced by the card click and the menu; the status appears when you hover the card or focus it.
- **Order links**: each order can keep the link to its eBay order page. New sheets get an **Order Link** column in the Orders tab. Importing from Seller Hub reads each order's link along with the order, and fills it into orders already in the sheet that have none. **Add order** needs the order link and reads the order number from it; **Edit order** can add one to an older order. The arrow on an order in the table opens it (Seller Hub by order number when there is no saved link), and the product name opens the AliExpress page.
- **A prompt for missing columns when a sheet is connected**: Importing a sheet, or opening the Edit dialog of one, now tells you which of **SKU**, **Image** and **Order link** the sheet lacks, what each is for, where AliSwift would add it (after the last column of the Inventory or Orders tab, with a title in the header row) and what happens if you say no. Nothing is added without a Yes.
- **A calendar for the order date**: the Add order form has its own date picker (month arrows, Today, full keyboard support) instead of the browser's.
- **Click outside Create sheet to close it.**

### Changed

- **The product inspector is calmer and shows the same things with more room**: the SKU sits above the title with the status as a coloured dot and word (Draft yellow, Listed green, Not listed grey); the title stays on one line, fades at the end, scrolls like a conveyor belt when it is too long (paused under the pointer, still with reduced motion), turns accent on hover and opens the AliExpress page when clicked. Sections, labels, fees and flags have clearer hierarchy and spacing. A product with no listing shows a quiet "No listing yet." and a **Create listing** button in the footer; with a listing, **List on eBay** is the primary button. The Done button is gone.
- **Import from Google Sheets is now Import sheet**, with the Google Sheets logo. The Create sheet explanation is an info icon next to its title. Info icons are smaller and centred with their labels.
- **Signed out, Settings shows only a lock** and the sign-in message, centred; the tabs and panels come back when you sign in.
- **The currency note under the prices reads "18.09 GBP ≈ 24.09 USD"**; the rate and date show on hover.
- **Product cards are a little taller**, and their hover and context-menu transitions are short fades.
- **The Delete product dialog** has even spacing, the product in its own box and the two buttons together on the right.

### Fixed

- **"+ Add tracking" was saved as a tracking number**: Seller Hub's empty tracking button was copied into the sheet. It is now ignored on import and shown as empty (the grey placeholder) everywhere, including for rows already saved that way.
- **The Create sheet window showed a scrollbar** because a hidden tooltip counted as scrollable content.
- **The popup had more empty space below its content than above.**

### Security and privacy

- New permission `activeTab` and new OAuth scope `userinfo.profile`, both explained in [PRIVACY.md](PRIVACY.md) and [docs/store-listing.md](docs/store-listing.md). Order links are only kept when they are `https` addresses on an eBay domain, and AliSwift still never fetches them.

## [0.10.0] - 2026-10-18

### Added

- **SKU prefix in Create sheet**: choose the prefix (default `SKU-`) when the sheet is made; it is built into the sheet's SKU formula (`OR-` gives OR-01, OR-02…).
- **Add from AliExpress puts the photos on the listing too**: after saving them to Downloads it hands them to eBay's photo box, and says "Downloaded 3 images" under the button. A product saved with one photo gets the rest of its gallery from its AliExpress page.

### Changed

- **Exchange rates are automatic**: supplier prices in another currency are converted at the live rate from ExchangeRate-API (`open.er-api.com`, cached 12 hours; an older cached rate is used when it can't be reached). Nothing is typed any more: the popup's rate box, the dashboard's Move to a sheet rate boxes, and Create sheet's **Your currency** and **Backup rate** are gone.
- **New sheets stay in the marketplace's currency** (USD for eBay US and Global, GBP for eBay UK): no Google Finance lookup and no second-currency columns. Existing sheets are not changed.
- **New sheets are marked as having a formula SKU column**, so AliSwift reads their SKUs back and never writes over the formula.

### Fixed

- **The eBay panel shows the sheet's SKU**: a card no longer shows the SKU a listing was saved with (like SKU-46) when the sheet shows another (OR-46).
- **The eBay panel offers every Draft**: a Draft product with no listing written or queued yet is in the list too, and can be written with Write now.
- **Add from AliExpress stays under Upload from computer** when eBay redraws its photo box.

## [0.9.0] - 2026-10-18

### Added

- **Add from AliExpress** on eBay's photo box: a button under "Upload from computer" opens a window with the picked product's photos, its gallery and each variant's photo. Pick the ones you want and they are saved under your Downloads folder, to drag into the photo box. The window lets you change the folder (your sheet's name by default) and turn **Auto-sort downloads** on (each product's photos in a folder named after its SKU, each variant's in its own folder inside it) or off (all in one folder, files named after the SKU). Both choices are remembered and also apply to the download button on AliExpress pages.
- **The eBay panel updates by itself**: a listing that finishes writing, or a product sent from the dashboard, shows in an open listing tab within a second, without a reload.

### Changed

- **Fill form and Try again no longer add photos** to eBay's form, and the Photos row is gone from the panel: photos come from Add from AliExpress. The setting is now **Allow photo downloads**.
- **The panel's price is the sheet's current sell price**: a price changed in the sheet shows on the cards and is what Fill form types in (one read of each sheet when the list opens; the saved price stands when the sheet can't be read).
- **Descriptions are formatted like eBay's own editor**: headings in capitals with a colon (Material & Features:, Size Details:, Perfect For:, Shipping:), and each run of "- " lines a real bullet list.
- **The eBay panel moves smoothly**: the ball grows into the panel and its content then fades in, part after part; closing runs it backwards. The product list grows open and its cards fade in one by one, and the panel's height follows its content. The panel no longer pushes eBay's page sideways when it opens (on a narrow window it still adds room below the form).
- **Panel details**: the product list starts closed and opens with its button (or with **Choose a product**); no search box or scrollbars; card titles are one line that fades out; a field's status is an icon (its word shows on hover); the "Pick your category" line is gone; the ball keeps its bolt centred and glows faintly on hover.
- **The item specifics are filled after eBay redraws them**: eBay draws them again from scratch about 3 seconds after a box changes, and opening Show more does too; the panel opens Show more first, waits for the redraw, and finds a field again by its name when its box was replaced. A picked card is pressed at once.
- **Settings**: checkboxes are switches on the right; the AI key list shows a status dot before the provider, the model on its own line, and arrow and cross buttons (greyed with a not-allowed cursor at the ends); the version and links sit at the bottom of the page.
- **Dashboard**: a changed status shows at once and is kept in the saved copy, so the next open doesn't show the old one first.

### Fixed

- **Check asks for the provider's permission properly**: when Chrome refuses, the AI tab now says why instead of only "Allow AliSwift to reach…".

## [0.8.0] - 2026-10-18

### Added

- **Remove from Sheet**: on an AliExpress product page, **Add to Sheet** becomes **Remove from Sheet** once the product is in your sheet (AliSwift keeps a small index of the sheet's items, refreshed every 5 minutes and after every add or remove). Remove asks for a second click, then clears only the cells AliSwift wrote in that row (formulas stay), drops the queued or kept listing, and the next Add reuses the row. Adding a product that is already in the sheet no longer adds a second row. If the SKU column is a formula, AliSwift reads the SKU back after the add.
- **Listings are written in the background**: about 3 minutes after an Add (your window to change your mind), one product a minute, by a saved queue that survives the browser closing. A rate limit makes a job wait exactly as long as the provider says; after 5 tries it is marked failed. The dashboard card shows Writing listing..., View listing or Retry listing.
- **Inspector on the dashboard**: an eye button on each card opens a side sheet (a bottom sheet on a phone) with the product's cost, sell price, eBay fees, profit and margin, and its listing (score, red flags, title, item specifics, description). Cost and sell price are editable and save only the cell that changed; a price your sheet calculates with a formula is shown read-only and never overwritten. **View listing** opens the same sheet, which replaces the old listing dialog. A product with no listing yet shows its queue state and **Write now**.
- **eBay fees per sheet**: Settings, Pricing has a fee percentage and a fixed fee (starting at 13.6% and 0.40, eBay US's usual figures; set your own marketplace's). Used only for the inspector's profit.
- **Error reports**: errors and timings from AI requests, failed actions and crashes are queued on your device and sent every 5 minutes to the developer's database; turn them off in Settings, General. Prompts and answers are included only if you opt in, or when you press **Send logs** on a failed run, which also shows a reference to quote. Keys, sheet names and order data are never sent. See PRIVACY.md. If a report can't be sent, Send logs copies it instead.
- **One list of error messages**: every page says the same true sentence for the same failure, names the step that failed, and offers the button that fixes it (Open settings, Sign in, Reload page, Try again with a countdown).
- **AI key pool**: the AI tab holds several keys from Gemini, Groq and OpenRouter, each marked Free or Paid, with a status (Ready, Busy until, Daily limit, Rejected). Free keys are used first; a Paid key takes over when every free key is busy. **Check** asks the provider which models the key can use. A **Get API keys** guide says where to get each. Your old Gemini key moves into the pool as a Free key.
- **Send product photos to the AI**: a setting, off by default (Gemini keys only); at most 2 small photos.
- **Sheet selector for order imports**: A sheet dropdown on the Seller Hub order import panel allows choosing which connected sheet receives imported orders when multiple sheets are configured.
- **Automated test suite**: Node test coverage for background service worker handlers, dashboard components, order extraction, and panel operations.

### Changed

- **Create Listing is gone** from AliExpress pages (and the dashboard card's List on eBay opens eBay without calling the AI): the listing is already written by the queue.
- **The eBay panel is instant and clearer**: its product list comes from saved listings only, with no Google Sheets reads when it opens or when you pick a product. A product still in the queue shows Writing listing... and **Write now**. After **Fill form**, the footer shows Done when every step worked, **Try again** (only the steps that failed) when some did not, and **Send logs** with Try again when all failed. A later step can no longer hide an earlier step's error. **Copy report** and **Mark listed** are gone (eBay's published page is still detected automatically; change a status on the dashboard).
- **Listings are kept under the AliExpress item number**, not the sheet and SKU, so a product has one listing wherever it is. Existing listings move on update.
- **Photos download into the product's real SKU folder**, including a SKU your sheet's formula makes.
- **Item specifics the listing already names are filled without asking the AI**; the AI is asked only about the rest, and leaves out fields it can't fill.
- **AI requests wait their turn**: one at a time, at least 4 seconds apart on one key. A busy key rests for exactly as long as the provider says, and Gemini's daily limit is told apart from a busy minute. A timeout is no longer retried on the same key: the next key is tried.
- **Default model is Gemini 3.5 Flash-Lite** (Google no longer offers 2.5 Flash-Lite to new keys); a listing answer that fails the checks is asked once more on Gemini 3.8 Flash. The Model box is gone: each key has its own model. Following Google's Gemini 3 guidance, no temperature is sent to 3.x models and Flash-Lite keeps its default (minimal) thinking.
- **Groq and OpenRouter defaults**: Groq now preselects `openai/gpt-oss-120b` with low reasoning (Llama 3.3 70B is no longer offered), OpenRouter preselects the free `nvidia/nemotron-3-super-120b-a12b:free` with reasoning off, which brings an answer from about 80 seconds to about 10. **Check** on OpenRouter lists only models that can answer in JSON. All three providers pass the live listing and item-specifics test.
- **A key that times out, can't be reached or lacks its model no longer stops the request**: the next key is tried (a missing model rests that key for 10 minutes), and the message shown is a busy key's countdown if there is one, else the first failure. A failed retry on the fallback model reports the first answer's problem and never rests the key.
- **A queued listing stops for a key problem instead of using up its tries**: no key, a rejected key or a missing model marks it Retry listing, and it runs again by itself as soon as you change your keys.

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

[Unreleased]: https://github.com/envyxyz/aliswift/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/envyxyz/aliswift/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/envyxyz/aliswift/compare/v0.10.0...v1.0.0
[0.10.0]: https://github.com/envyxyz/aliswift/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/envyxyz/aliswift/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/envyxyz/aliswift/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/envyxyz/aliswift/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/envyxyz/aliswift/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/envyxyz/aliswift/releases/tag/v0.6.0
[0.5.0]: https://github.com/envyxyz/aliswift/releases/tag/v0.5.0
