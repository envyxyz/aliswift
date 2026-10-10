# Security

## Reporting a problem

Please report security problems privately, not in a public issue. Use GitHub's **Security** tab on this repository and choose **Report a vulnerability**. Include what you found and steps to reproduce it.

Only the latest release gets fixes.

## Sign-in key rotation

Before this change, `manifest.json` held a private key in its `"key"` field (extension ID `cfnlniilbhkbbpjinbhkiepadnbikbkj`). It was replaced with a new public key, so the extension ID is now `oeomcphpdaicmkpdpdnfmnkjidnbghaa`, with a new OAuth client. The old key stays in git history and must be treated as compromised for good.

Builds from before the rotation have a different extension ID and are not supported. They may stop signing in, so update to a current build. Export your settings first and import them afterwards (see the README).

The manifest `"key"` and OAuth client ID are public by design. Anyone can load a copy of this repo and get the same extension ID and client. Rotation fixes the leaked key; it does not make the client private. To run your own, see [CONTRIBUTING](CONTRIBUTING.md#google-sign-in-for-your-own-build).

## What is in scope

AliSwift reads product pages and writes to your Google Sheets, so these matter most:

- Page content (titles, prices) ending up as code or spreadsheet formulas
- Anything that reads or writes a sheet the user did not add
- Anything that leaks the Google token or settings to a third party
- Permissions broader than the extension needs
