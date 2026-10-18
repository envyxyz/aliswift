<div align="center">

![banner.png](./screenshots/banner.png)

[![Release](https://img.shields.io/github/v/release/envyxyz/aliswift?style=flat-square&color=ff4f00)](https://github.com/envyxyz/aliswift/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/envyxyz/aliswift/ci.yml?style=flat-square&label=tests)](https://github.com/envyxyz/aliswift/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/envyxyz/aliswift?style=flat-square&color=1d1b20)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-MV3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](https://github.com/envyxyz/aliswift/releases)
[![Sheets](https://img.shields.io/badge/Google%20Sheets-API%20v4-34A853?style=flat-square&logo=googlesheets&logoColor=white)](https://developers.google.com/sheets)
[![Stars](https://img.shields.io/github/stars/envyxyz/aliswift?style=flat-square&color=ff4f00)](https://github.com/envyxyz/aliswift/stargazers)

**Save AliExpress products to Google Sheets in one click**

![Demo](./screenshots/popup.gif)

</div>

---

## Overview

AliSwift is a Chrome extension for eBay and Shopify dropshippers who source from AliExpress. Instead of copying a product's title, price and link by hand, you click one button and the row lands in your Google Sheet, already priced.

Sign-in is optional: you can save products directly to an on-device local library without a Google account, and move them to a Google Sheet later.

You can keep several sheets, each with its own column layout, pricing rules and marketplace region. It is plain JavaScript on Chrome Manifest V3, with no build step, no dependencies, no project-run servers and no account registration.

## Features

- **One click saving** from the button on the product page, or from the toolbar popup
- **Add and Remove on the product page**: **Add to Sheet** becomes **Remove from Sheet** once the product is in your sheet (the sheet itself decides, so it stays right if you delete a row by hand). Remove asks for a second click, clears only the cells AliSwift wrote in that row, and the next Add reuses the row. Adding the same product twice does nothing. About 3 minutes after an Add, AliSwift writes the product's eBay listing in the background, one product a minute, so you never wait on the AI
- **Marketplaces**: eBay UK, US, **Global (USD)** for accounts registered outside the supported countries, Germany (listings are written in German), Australia and Canada. Each sets the sheet's currency, fee defaults and the eBay site that opens
- **Optional sign-in and local library**: start immediately without signing in; items save to your device's local storage and can be moved to a Google Sheet whenever you are ready
- **Move to sheet**: transfer products from your local library into any connected sheet with automated currency conversion and duplicate skipping
- **Dashboard**: a full-page view featuring a Products view (cards, search, filters, remove and restore) and an Orders view (table, status, totals, add and edit order), opened from the popup and Settings
- **AI listing generation**: with your own AI keys, AliSwift writes an eBay title (up to 80 characters), description and item specifics for each product you add. Open it from the card's **View listing** or its eye button. Editable, with a copy button for each field, and **Rewrite listing** if you want another version
- **AI keys from three providers**: Gemini (default model Gemini 3.5 Flash-Lite, the only one that reads photos), Groq (default `openai/gpt-oss-120b`) and OpenRouter (default the free `nvidia/nemotron-3-super-120b-a12b:free`). Add several keys, each marked Free or Paid: free keys go first, a busy, slow or broken key hands over to the next, and **Check** lists the models each key can use. Settings, AI tab, **Get API keys** says where to get them.
- **Inspector**: the eye button on a dashboard card opens a side sheet (a bottom sheet on a phone) with the product's cost, sell price, eBay fees, profit and margin, and its listing. Cost and sell price are editable and save to your sheet; a price that your sheet calculates with a formula is shown read-only and never overwritten. The fee percentage and fixed fee are set per sheet in Settings, Pricing
- **eBay panel and form fill**: on eBay's listing form (every marketplace above), an injected side panel lists the products that have a listing as cards (SKU, name, price); click one to choose what to list. **Fill form** then sets the format to Buy It Now and fills title, custom label (SKU), description and price, and fills item specifics (the ones the listing already names first, the AI only for the rest). Anything it cannot fill reliably becomes a copy button. When a step fails the panel offers **Try again** for just that step, and **Send logs** sends a report (the form's box names, never what was typed) and shows a reference to quote. It never presses "List it" and never fills Condition
- **Photos on eBay listings**: optional setting to pass AliExpress gallery photos directly to eBay's photo uploader when you click **Fill form**, with a fallback that saves them to your Downloads folder if the uploader does not take them
- **Photos for older products**: when the dashboard lists products that have a link but no photo, the service worker fetches each product's public AliExpress page to find its share image, displays it on the card, and writes it into an empty Image cell in your sheet or local library record
- **Orders from eBay**: on Seller Hub's order list, **Add all orders to sheet** takes you to All orders and adds every order the Orders tab does not have yet (matched by order number and SKU, so pressing it again, or on the next page of results, never adds one twice). Cost and sell price come from the Inventory row of the SKU
- **AI when a page changes**: if AliExpress's price selectors, eBay's form boxes or Seller Hub's wording change, the AI is shown what the page lists and points at the right piece, instead of the feature failing. It only picks from what the page listed, names and addresses in orders are hidden from it, and it needs an AI key
- **Auto sheets**: AliSwift creates a ready-made Google Sheet in your Drive, set up for the marketplace you choose with fee, profit and margin formulas, status dropdowns, and an Orders tab
- **Import from Google Sheets**: select an existing spreadsheet from your Drive or paste its link; AliSwift reads its tabs and headers and maps columns automatically (with AI column mapping if you add an AI key)
- **SKUs**: automatic SKU generation matching your sheet template numbering (for example, "Added as SKU-31" or "Saved to library as L-03")
- **Settings backup**: export and import your sheets, settings, local library, and photo links as a file
- **Formula or margin pricing**: customize rules such as `costPrice * 1.7` or `(costPrice + 2) * 1.5`
- **Landed cost**: combines item price, visible shipping cost, and optional extra buffer cost
- **Currency handling**: converts supplier currencies using sheet exchange rates or manual entries
- **.99 rounding**: rounds sell prices up to clean retail endings (4.77 becomes 4.99)
- **Title cleanup**: caps word count and removes unwanted noise words
- **Safe writes**: writes plain values into the next free row of your sheet, and only adds missing columns when you explicitly confirm; never deletes rows, and clears only the cells it wrote itself when you press Remove from Sheet
- **Light and dark theme**: respects your system preferences
- **Private**: no project-run backend, no tracking, and no analytics ([details](PRIVACY.md))

## Screenshots

**Popup**
![popup.png](./screenshots/popup.png)

**Settings**
![settings.png](./screenshots/settings.png)

**Result in Google Sheets**
![sheet.png](./screenshots/sheet.png)

## Install

AliSwift is not on the Chrome Web Store yet. Installing takes about a minute.

**From a release (recommended)**

1. Download the latest zip from [Releases](https://github.com/envyxyz/aliswift/releases) and unzip it to a folder named `aliswift`.
2. Open `chrome://extensions` and enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `aliswift` folder.
4. Pin AliSwift from the extensions menu so the icon stays accessible.

**From source**

```
git clone https://github.com/envyxyz/aliswift.git
```

Then follow steps 2 to 4 above and select the cloned folder. There is no build step.

## Set up

### 1. Local library mode (no sign-in required)
If you do not sign in, AliSwift runs in local library mode. The button reads **Save to library**. Products are stored safely on your device in local storage (`chrome.storage.local`). You can browse them on the dashboard, view their supplier links, and remove or restore them.

### 2. Create sheet
Open settings (gear icon in popup), click **Create sheet** (or **Create a sheet** in the empty state), choose your marketplace (eBay UK, US, Global, Germany, Australia or Canada) and enter your currency (for example GBP, USD, or PKR). Click **Create sheet**. AliSwift creates a spreadsheet in your Google Drive with Dashboard, Inventory and Orders tabs, and configures fee calculations automatically. The Inventory tab includes an Image URL column.

### 3. Import from Google Sheets
Choose **Import from Google Sheets** to pick a sheet from your Drive or paste its link. Sign-in requests a single permission list that includes read-only Drive metadata (`drive.metadata.readonly`), which is required whether picking a sheet or pasting a link. AliSwift reads sheet headers and sample rows to identify columns. If you save your Gemini API key in the AI tab, Gemini proposes the column mapping automatically. Import sends column headers and a few sample cells to Gemini, with a filter that tries to leave out columns with personal data (such as names, addresses, phone numbers, or emails); always check the preview before confirming. A mapping request waits up to 15 s and is not retried. If the sheet has no SKU column or no Image column mapped, AliSwift asks whether to add the missing columns before adding the sheet. Choosing yes adds them after the last used column of the Inventory tab, numbers existing products with SKUs, and fills known photo links without touching any existing cells. You can also decline, or add them later using the Edit dialog.

### 4. Moving local products to a sheet
Once a Google Sheet is connected, click **Move to a sheet** on the dashboard library banner. AliSwift transfers products into your sheet, applies currency conversion rates, and safely skips duplicates.

### 5. Updating from an older build
The extension signing key was rotated in 0.6.0, so the extension ID changed. Export your settings on your previous build via **Export settings**, install the new build, and click **Import settings** to restore your sheets, library items, and photo links.

### 6. Photos on your eBay listing
In Settings under the General tab, you can turn on **Include images when creating listings from AliExpress** (off by default). The preference is saved in synced settings (`includeImages`) and included in the settings backup. Turning it on asks Chrome for the optional `downloads` permission. The extension does not need this permission to install or to attach photos; if refused, the setting still works, but the folder fallback is unavailable. When enabled, clicking **Fill form** in the eBay panel gets each photo from the service worker (up to 12 full-size gallery photos from AliExpress image hosts, at most 3 MB each, JPEG, PNG or WebP) and hands them to eBay's own photo uploader as files. Attaching relies on eBay's uploader, which is not an official API and was checked against a saved copy of the form. If the form does not take the photos (or its uploader changed), the worker saves them to your Downloads folder as `Downloads\<sheet name>\<SKU>\img-01.jpg`, `img-02.png` and so on (or `Downloads\Library\<SKU>\` for local library items) so you can drag them into the photo box.

Options on AliExpress that have a picture of their own (such as a colour or style) are read when you save the product (Add to Sheet) without clicking anything on the page. Text-only options like sizes or phone models have no picture and are not read. Up to 40 variants are kept per product. When the Include images setting is on, each variant's photo (full size) is saved to its own sub-folder named after the variant (`Downloads\<sheet name>\<SKU>\<variant name>\img-01.jpg`, for example `Downloads\ObsidianRow\SKU-85\Clear Purple\img-01.webp`). Variant photos are always saved to these sub-folders when Fill form runs, even when gallery photos are attached to the eBay form, because the form of a single listing has no place for them. If gallery photos cannot be attached, they are saved in the SKU folder itself and variants in their sub-folders. Two variants with the same name get distinct folders (prefixed by the property name, or a number). The eBay panel shows a "Variant photos" row. The panel attaches only gallery photos to the form, not variants. Saved photo files use their actual image format (AliExpress sends WebP for some addresses ending in .jpg), so a file may end in `.webp`.

## Usage

1. Open an AliExpress product page.
2. Click **Add to Sheet** (or **Save to library**), or open the toolbar popup. The listing is written in the background a few minutes later.
3. The item is saved with its calculated sell price, image, and assigned SKU.
4. On eBay, choose your category, then press **Fill form** in the AliSwift panel. If image inclusion is enabled, the panel hands the gallery photos to eBay's photo uploader, or saves them to Downloads if the form does not take them. You press List it yourself.
5. When an order comes in, open Seller Hub's order list and press **Add all orders to sheet**.
6. Open the **Dashboard** via the icon in the popup header to manage your products, generate eBay listings, and track customer orders. When the dashboard lists products that have no photo, it gets one from their public AliExpress page.

AliSwift writes new products into the next free row of your sheet, or into a row it cleared itself earlier. Its other writes are a product's status, tracking and the two prices you edit in the inspector (never a cell that holds a formula), and adding missing SKU or Image columns when you answer yes, which writes only into new empty columns. It never deletes rows. The only cells it clears are the ones it wrote in a product's row when you press Remove from Sheet.

## Pricing calculation

```
cost price = item price + shipping (if shown on page) + extra cost
sell price = formula(cost price)   or   cost price * (1 + margin / 100)
```

When supplier currency differs from your sheet currency, conversion uses the exchange rate defined in your sheet or configured manually.

## Privacy

AliSwift collects no analytics. Product data is stored only on your own device (in your local library and exported settings file) or in your own Google Sheet. The one thing sent to the developer is error reports (codes, timings and crash traces, never keys, sheet names or order data), which you can turn off in Settings. Your AI keys stay in storage.local on this device, are sent only to their own provider, and are not included in settings export ([read full Privacy Policy](PRIVACY.md)).

## Roadmap

Planned features and future enhancements are tracked in [ROADMAP.md](ROADMAP.md):
- Profit analytics on the dashboard and across regions
- Reading each order's price and tracking from eBay (the order list import is done)
- Connecting AliExpress to pull orders and exact prices (research only)
- Confirming the eBay fee defaults against real orders

## Development

For developers configuring or testing the extension:
- The Google Cloud project that owns the OAuth client ID must have both the **Google Sheets API** and the **Google Drive API** enabled for spreadsheet creation, metadata listing, and link verification to work.
- Plain JavaScript with Chrome Manifest V3; no build step. Run automated tests with `npm test`.

## Contributing

Bug reports, selector fixes, and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for testing guidelines and development setup.

## License

MIT License. See [LICENSE](LICENSE) for details.
