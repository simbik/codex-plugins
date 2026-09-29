# Official directory submission dossier

Status: **not submitted; not approved; not published in the official OpenAI directory**.

The GitHub repository and its repo marketplace are independent public distribution channels. OpenAI's current portal is https://platform.openai.com/plugins. It requires a signed-in publisher with Apps Management write access and a verified developer/business identity. The available browser session reached its login page.

The documented ordinary MCP submission route requires a stable public HTTPS endpoint. App Publisher 0.1.0 uses local stdio so keys stay on the user's machine. OpenAI documents contacting an OpenAI representative for local MCP support. No representative or approved local-MCP submission channel was provided. A hosted credential service would be a separate architecture/security project, not a packaging change. Do not label this bundle as a remote MCP or claim a skills-only submission includes automatic remote tools.

Sources, checked 2026-09-29:
- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/deploy/submission-errors

## Ready listing copy

Name: App Publisher

Short description: Prepare and publish mobile app updates.

Long description: Local workflows for store metadata, screenshots, signed builds and release preparation across Apple App Store Connect and Google Play Console. Includes a browser-based local connection wizard, account profiles and explicit write controls. Requires Node.js 22+, store API access and signed artifacts. The initial Google connection requires a service account or Desktop OAuth client file. Live production publishing has not yet been verified for this early release.

Category: Productivity

Public publisher handle: simbik. This is a GitHub handle, not proof of a verified OpenAI publisher identity. The owner must select their verified identity in the portal.

Website/source: https://github.com/simbik/app-publisher
Support: https://github.com/simbik/app-publisher/issues
Privacy: https://github.com/simbik/app-publisher/blob/main/PRIVACY.md
Terms: https://github.com/simbik/app-publisher/blob/main/TERMS.md
Logo: plugins/app-publisher/assets/logo.png

Starter prompts:
1. Check the release status of my app.
2. Prepare localized store descriptions.
3. Prepare a signed build for internal testing.

Release notes: First local release with an original MCP/CLI server, local connection wizard, Apple JWT and Google OAuth/service-account authentication, multi-account profiles, listing and upload tools, staged releases, write guards and offline tests.

## Reviewer scenarios

Positive:
1. Run setup without credentials: see direct console links and file selectors; no secrets requested in chat.
2. Connect an Apple test account: select .p8, enter team Issuer ID, check API access, list apps with the explicit profile.
3. Connect Google with a Desktop OAuth file: follow consent, return through the state-bound callback, reuse the saved refresh token.
4. Prepare a localized listing in a temporary Google edit: read existing listing, update reviewed copy, validate; no commit until authorized.
5. Upload an authorized signed IPA: check hash, receive reservation IDs, inspect processing state; no automatic review submission.

Negative:
1. Request a mutation with writes disabled or without confirm:true: reject before a network call.
2. Supply an external URL to Apple pagination or incorrect upload hash: reject without transmitting credentials/upload data to that destination.
3. Trigger an ambiguous upload/commit failure: retain known resource IDs, redact raw exception/secret details, do not blindly repeat writes or delete remote data.

Automated tests cover corresponding protocol and safety boundaries. Scenarios using real accounts still require reviewer-controlled demo credentials and live evidence; no live test credentials are bundled. Country availability and mandatory legal/policy attestations require the verified publisher's decisions.

## Remaining external steps

1. Obtain OpenAI's supported submission route for local stdio MCP.
2. Sign into the portal, select the verified publishing identity and permitted organization.
3. Complete live review scenarios with controlled test apps and reviewer access.
4. Upload the prepared release ZIP and listing assets through the agreed route, choose availability and complete required attestations.
5. Submit for review. After approval, choose publication in the portal. Neither GitHub upload nor a draft is approval.
