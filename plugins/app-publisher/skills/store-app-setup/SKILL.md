---
name: store-app-setup
description: Create a new Apple or Google store app with a choice of automatic setup in the Codex in-app browser or manual instructions; prepare Apple bundle IDs, capabilities, certificates, devices and provisioning profiles through API tools.
---

Use this workflow when the user wants to create an app for the first time, register its store record, or prepare Apple provisioning. Read [first-app setup](../../docs/first-app-setup.md) and the [access checklist](../../docs/access-setup.md). Product UI, documentation and field labels are English; converse in the user's language.

## Establish the target and reuse existing work

Identify the local account profile, store/developer team, application identifier, app name, primary language, platform and release intent. Inspect project configuration and existing store apps to fill known values before asking for missing information. For Apple also establish SKU; for Google establish app/game and free/paid choices. Do not guess business choices or legal declarations. Read existing apps and, for Apple, matching bundle IDs before creating anything. Follow pagination when proving a record is absent. A matching identifier is stronger evidence than a matching name. If the app already exists, reuse it and report the remaining setup steps.

## Ask how to create the store record

Public store app records cannot be created with the current public Apple or Google publishing API. Before console interaction, offer one concise choice, in the user's language:

- **Create automatically in the Codex browser** — Codex fills the form; you sign in if needed.
- **Show me the instructions** — get a direct console link and the exact field values to enter yourself.

Use the available question tool, or a normal question if none is available. Wait for the answer before browser interaction or app creation. While waiting, read API state or prepare field values. Reuse an explicit automatic/manual preference already given for this task; do not ask again for every step. Never silently choose automatic mode after a timeout. Choosing automatic mode authorizes creating the requested draft record with the agreed values, not public release or unrelated account changes.

## Automatic mode: the Codex in-app browser

Use the host's browser/computer-use tools, with the Codex in-app browser (`iab`), not an external browser. Discover those tools if necessary. Follow their entry-point instructions and returned runtime documentation before interacting. Reuse an appropriate existing tab or create a visible tab at https://appstoreconnect.apple.com/apps or https://play.google.com/console/. Do not launch shell-driven browser automation, call undocumented console endpoints, or export browser cookies to imitate an API. If the in-app browser tools are unavailable, explain the limitation and offer the manual instructions; do not claim automatic creation is available in that session.

Inspect the current page. If signed out, show the tab and ask the user to sign in there, including 2FA or CAPTCHA, and tell you when ready. Pause dependent work until they respond, then re-inspect the page. Never request passwords, verification codes, recovery codes or session cookies in chat; never inspect browser credential storage. Repeat this handoff only if a new login challenge actually appears.

Verify the selected developer account/team in the browser matches the intended profile/account. An API key and a browser session can belong to different accounts. Stop for clarification on a mismatch. Use fresh observed page state for controls; never invent selectors, field values or success states. Navigate to New App/Create app, fill the agreed values, and submit the draft creation form within the user's authorization. Avoid duplicate submissions after a timeout: inspect the app list and API first.

Apple: select the registered Bundle ID, platform, language and SKU; create the app record. Google: select the correct developer account, app name, language, app/game and free/paid settings. If creation requires declarations or agreement acceptance, explain the exact pending item and let the user complete it or supply explicit truthful answers. Do not invent compliance answers or accept new legal terms on the user's behalf. Do not publish, enroll in payments, change pricing or upload an artifact merely because the user authorized creating the card.

If a separate authorized first-upload step requires Play Console, use the same browser mode and only the user's selected signed artifact. Never substitute an arbitrary file. If file-upload controls are unavailable, hand the upload step to the user in that tab. Do not claim that a created card proves an uploaded build or release readiness.

## Manual mode

Give one short numbered checklist with a direct [Apple Apps](https://appstoreconnect.apple.com/apps) or [Play Console](https://play.google.com/console/) link and a table of exact known field values. Mark missing required values clearly. Explain which account/team to select, which button to use, and where to stop. Do not require screenshots or copying credentials. Ask the user to say when the card is created, then verify it through the API. Do not open or operate the console in this mode unless the user changes their choice.

## API preparation and verification

For Apple, use a Team key and the provisioning tools documented in first-app setup. Reuse existing Bundle IDs, certificates, devices and valid profiles. A public certificate alone is insufficient for signing: the matching private key stays in the user's Keychain or build system. Pass a local CSR path to apple_create_certificate; never request or print a signing private key. Save certificate/profile content using the download tools, outside the repository, and report only path and IDs. These downloads require write enablement and confirmation because they write local files.

All API mutations require the normal explicit profile, local APP_PUBLISHER_ALLOW_WRITES=1 and confirm:true for actions within the user's authorized scope. No automatic certificate revocation, profile deletion or device disabling. Enabling a capability does not configure the application's entitlements or all related services; report outstanding app groups, containers or Apple approvals.

After creating the record, call apple_list_apps/apple_get_app or google_list_apps using the intended profile. Report the app ID/package, account, console URL if observed, and what was verified. If Google discovery is delayed or access/API enablement is missing, distinguish visible console creation from API verification; resolve access or wait and recheck without recreating the app. The next task is metadata/build preparation using store-metadata and store-release. Creating a draft is never evidence of publication.
