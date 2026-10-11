# Privacy

AliSwift has no server and no analytics. Nothing is sent to the people who make AliSwift.

## What it reads

The title, price, shipping cost and URL of the AliExpress product page you are on. This happens only when you open the popup or click the green button on a product page.

## Where it goes

Straight from your browser to the Google Sheets API, into the sheet you chose, using your own Google account. Google's privacy policy covers what happens after that.

If you choose **Auto** when adding a sheet, AliSwift also creates a new spreadsheet in your Google Drive and fills it with tabs, formulas and fee settings. That is the only time AliSwift creates a file. It does not delete or empty rows or cells.

### Import from Google Sheets

When you import a sheet, AliSwift lists the names and last-edited dates of your spreadsheets (never their content) so you can pick one, then reads the tab names and the first four rows of each tab. It does not write to the sheet.

If you saved a Gemini key in Settings, AliSwift also sends Google's Gemini API the tab names, the column titles and up to three sample rows per tab. Columns whose title looks personal (buyer, name, address, email, phone, tracking, notes) and cells that look like an email, phone number or postcode are left out. The spreadsheet's own name is not sent. It uses your own key, so Google's terms for your key apply. Without a key, matching happens in your browser and nothing is sent.

The Gemini key is stored on this device only (`chrome.storage.local`). It is never synced, never exported and never shown back.

## What it stores

Your sheet names, sheet IDs, column letters, SKU prefix, marketplace, Orders tab name, pricing settings and the currency you last used, in Chrome's extension storage (`chrome.storage.sync`). If Chrome sync is on, Chrome syncs these settings through your Google account like any other extension setting.

You can export these settings to a file on your computer and import them again. The file is made in your browser and goes nowhere else. It holds no Google token and no product data.

AliSwift does not store product data. It does not store your Google token either: Chrome manages the token.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Save your settings |
| `identity` | Sign in to Google so AliSwift can write to your sheet |
| `*.aliexpress.com`, `*.aliexpress.us` | Read product pages and show the page button |
| `sheets.googleapis.com` | Write rows to your sheet, and create a new sheet when you choose Auto |
| `www.googleapis.com/drive` | List the names of your spreadsheets for the import picker |
| `generativelanguage.googleapis.com` | Ask Gemini to match columns, only when you saved your own key |

The Google permissions are `https://www.googleapis.com/auth/spreadsheets`, which lets AliSwift read and edit your Google Sheets, and `https://www.googleapis.com/auth/drive.metadata.readonly`, which lets it read file names and dates (not file content) for the import picker. AliSwift only touches the sheets you add in settings.

## Taking it back

- Revoke Google access any time at <https://myaccount.google.com/permissions>.
- Removing the extension deletes its settings from Chrome.

## Questions

Open an issue at <https://github.com/envyxyz/aliswift/issues>.
