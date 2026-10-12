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
- **Create Listing button**: next to **Add to Sheet** on every AliExpress product page. One press saves the product, has Gemini write the eBay listing from the page's full title, specifications and photos, and opens eBay's listing page for that product's marketplace. A product you already saved keeps its SKU and is not added twice
- **Marketplaces**: eBay UK, US, **Global (USD)** for accounts registered outside the supported countries, Germany (listings are written in German), Australia and Canada. Each sets the sheet's currency, fee defaults and the eBay site that opens
- **Optional sign-in and local library**: start immediately without signing in; items save to your device's local storage and can be moved to a Google Sheet whenever you are ready
- **Move to sheet**: transfer products from your local library into any connected sheet with automated currency conversion and duplicate skipping
- **Dashboard**: a full-page view featuring a Products view (cards, search, filters, remove and restore) and an Orders view (table, status, totals, add and edit order), opened from the popup and Settings
- **AI listing generation**: from a product card on the dashboard, "Create listing" uses your own Gemini key to write an eBay title (up to 80 characters), description and item specifics. Editable, with a copy button for each field
- **eBay panel and form fill**: on eBay's listing form (every marketplace above), an injected side panel lists the products that have a listing as cards (SKU, name, price); click one to choose what to list. **Fill form** then sets the format to Buy It Now and fills title, custom label (SKU), description and price, and fills item specifics with Gemini. Anything it cannot fill reliably becomes a copy button, and **Copy report** gives a bug report that holds the form's box names and never what was typed. It never presses "List it" and never fills Condition
- **Orders from eBay**: on Seller Hub's order list, **Add all orders to sheet** takes you to All orders and adds every order the Orders tab does not have yet (matched by order number and SKU, so pressing it again, or on the next page of results, never adds one twice). Cost and sell price come from the Inventory row of the SKU
- **AI when a page changes**: if AliExpress's price selectors, eBay's form boxes or Seller Hub's wording change, Gemini is shown what the page lists and points at the right piece, instead of the feature failing. It only picks from what the page listed, names and addresses in orders are hidden from it, and it needs your Gemini key
- **Auto sheets**: AliSwift creates a ready-made Google Sheet in your Drive, set up for the marketplace you choose with fee, profit and margin formulas, status dropdowns, and an Orders tab
- **Import from Google Sheets**: select an existing spreadsheet from your Drive or paste its link; AliSwift reads its tabs and headers and maps columns automatically (with AI column mapping if you provide your Gemini key)
- **SKUs**: automatic SKU generation matching your sheet template numbering (for example, "Added as SKU-31" or "Saved to library as L-03")
- **Settings backup**: export and import your sheets, settings and local library as a file
- **Formula or margin pricing**: customize rules such as `costPrice * 1.7` or `(costPrice + 2) * 1.5`
- **Landed cost**: combines item price, visible shipping cost, and optional extra buffer cost
- **Currency handling**: converts supplier currencies using sheet exchange rates or manual entries
- **.99 rounding**: rounds sell prices up to clean retail endings (4.77 becomes 4.99)
- **Title cleanup**: caps word count and removes unwanted noise words
- **Safe writes**: writes plain values to spreadsheets; never deletes rows or clears existing cells
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

### 2. Auto sheet creation
Open settings (gear icon in popup), click **Add sheet**, keep **Auto** selected, choose your marketplace (eBay UK, US, Global, Germany, Australia or Canada) and enter your currency (for example GBP, USD, or PKR). Click **Create sheet**. AliSwift creates a spreadsheet in your Google Drive with Dashboard, Inventory and Orders tabs, and configures fee calculations automatically.

### 3. Manual sheet setup
If you have an existing spreadsheet:
1. Open AliSwift settings, click **Add sheet**, and choose **Manual**.
2. Paste the sheet URL and specify the tab name (for example `Inventory`).
3. Set your column letters to match your sheet structure, or click **Use AliSwift template layout**.
4. Adjust pricing rules on the **Pricing** tab.

### 4. Import from Google Sheets
Choose **Import from Google Sheets** to pick a sheet from your Drive or paste its link. Sign-in requests a single permission list that includes read-only Drive metadata (`drive.metadata.readonly`), which is required whether picking a sheet or pasting a link. AliSwift reads sheet headers and sample rows to identify columns. If you save your Gemini API key in the AI tab, Gemini proposes the column mapping automatically. Import sends column headers and a few sample cells to Gemini, with a filter that tries to leave out columns with personal data (such as names, addresses, phone numbers, or emails); always check the preview before confirming. Gemini requests allow up to 15 s per attempt and retry once, taking up to about 30 s.

### 5. Moving local products to a sheet
Once a Google Sheet is connected, click **Move to a sheet** on the dashboard library banner. AliSwift transfers products into your sheet, applies currency conversion rates, and safely skips duplicates.

### 6. Updating from an older build
The extension signing key was rotated in 0.6.0, so the extension ID changed. Export your settings on your previous build via **Export settings**, install the new build, and click **Import settings** to restore your sheets and library items.

## Usage

1. Open an AliExpress product page.
2. Click **Add to Sheet** (or **Save to library**), or open the toolbar popup. To go further in one step, click **Create Listing**: it saves the product, writes the listing and opens eBay.
3. The item is saved with its calculated sell price, image, and assigned SKU.
4. On eBay, choose your category, then press **Fill form** in the AliSwift panel. You press List it yourself.
5. When an order comes in, open Seller Hub's order list and press **Add all orders to sheet**.
6. Open the **Dashboard** via the icon in the popup header to manage your products, generate eBay listings, and track customer orders.

AliSwift only writes into the next free row of your sheet. It never deletes rows or clears existing cells.

## Pricing calculation

```
cost price = item price + shipping (if shown on page) + extra cost
sell price = formula(cost price)   or   cost price * (1 + margin / 100)
```

When supplier currency differs from your sheet currency, conversion uses the exchange rate defined in your sheet or configured manually.

## Privacy

AliSwift has no servers and collects no analytics. Product data is stored only on your own device (in your local library and exported settings file) or in your own Google Sheet, never on our servers (we have none). Your Gemini key stays in storage.local on this device, is sent only to Google's Gemini API, and is not included in settings export ([read full Privacy Policy](PRIVACY.md)).

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
