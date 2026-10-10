# Security

## Reporting a problem

Please report security problems privately, not in a public issue. Use GitHub's **Security** tab on this repository and choose **Report a vulnerability**. Include what you found and steps to reproduce it.

Only the latest release gets fixes.

## What is in scope

AliSwift reads product pages and writes to your Google Sheets, so these matter most:

- Page content (titles, prices) ending up as code or spreadsheet formulas
- Anything that reads or writes a sheet the user did not add
- Anything that leaks the Google token or settings to a third party
- Permissions broader than the extension needs
