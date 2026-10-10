# Privacy

AliSwift has no server and no analytics. Nothing is sent to the people who make AliSwift.

## What it reads

The title, price, shipping cost and URL of the AliExpress product page you are on. This happens only when you open the popup or click the green button on a product page.

## Where it goes

Straight from your browser to the Google Sheets API, into the sheet you chose, using your own Google account. Google's privacy policy covers what happens after that.

## What it stores

Your sheet names, sheet IDs, column letters and pricing settings, in Chrome's extension storage (`chrome.storage.sync`). If Chrome sync is on, Chrome syncs these settings through your Google account like any other extension setting.

AliSwift does not store product data. It does not store your Google token either: Chrome manages the token.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Save your settings |
| `identity` | Sign in to Google so AliSwift can write to your sheet |
| `*.aliexpress.com`, `*.aliexpress.us` | Read product pages and show the page button |
| `sheets.googleapis.com` | Write rows to your sheet |

The Google permission is `https://www.googleapis.com/auth/spreadsheets`. It lets AliSwift read and edit your Google Sheets. AliSwift only touches the sheets you add in settings.

## Taking it back

- Revoke Google access any time at <https://myaccount.google.com/permissions>.
- Removing the extension deletes its settings from Chrome.

## Questions

Open an issue at <https://github.com/envyxyz/aliswift/issues>.
