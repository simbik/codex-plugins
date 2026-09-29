# First app setup

App Publisher combines official API preparation with a choice for the store record:

- **Create automatically in the Codex browser:** Codex opens the visible in-app browser, verifies the selected account and fills the agreed values. If signed out, you sign in in that tab and complete 2FA; Codex resumes afterwards.
- **Show me the instructions:** Codex provides the direct console link and a field-by-field checklist, waits for you to create the record, and checks the result.

Codex asks once per task, unless you already chose a mode. It does not open the console before your choice. Automatic mode requires browser tools supplied by the Codex host; the App Publisher MCP itself does not operate a browser or store website passwords. If these tools are unavailable, use the manual workflow. API credentials and the browser login are separate connections.

## Apple preparation

Use a **Team API key**. Individual keys cannot call provisioning endpoints. See [permissions](access-setup.md#apple-provisioning-permissions). A successful app-list check does not prove provisioning access.

1. List bundle IDs filtered by the intended identifier and reuse a match. Otherwise register an explicit identifier such as `com.example.app` with the intended platform and name. Bundle registration is separate from creating an App Store Connect record.
2. List existing capabilities and enable only those required by the app. For capabilities with settings, supply the intended option values. Configuring the bundle does not update Xcode entitlements, create app groups/iCloud containers, or obtain restricted entitlement approval.
3. Inspect existing certificates and their expiry. Reuse a certificate whose matching private key is available locally. When needed, create a CSR in Keychain Access: **Certificate Assistant → Request a Certificate From a Certificate Authority → Saved to disk**. Supply that local `.certSigningRequest`/`.csr` path to the certificate tool. The API key `.p8` is not the signing private key and must never be passed as the CSR.
4. Create a certificate from the CSR only when needed. Download it to a new `.cer` path outside the repository and import it into the Keychain that holds the matching private key. Supported types cover Apple development/distribution, iOS development/distribution, Mac development/store/installer and Developer ID application certificates. Special-purpose Apple Pay/Pass certificates are outside this workflow.
5. For development or Ad Hoc distribution, list registered devices and register only missing, authorized devices. Registration consumes Apple's device allowance. Store profiles do not require device IDs.
6. Create a profile with the exact bundle resource ID, certificate resource IDs, profile type and, when required, device resource IDs. Reuse an existing valid profile when possible. Download the profile to a new `.mobileprovision` or `.provisionprofile` path outside the repository. Building, installing signing assets into a build system and signing the binary remain separate local build tasks.
7. Create the store card using the chosen browser/manual mode. [Open App Store Connect Apps](https://appstoreconnect.apple.com/apps), choose **+ → New App**, and supply platform, name, primary language, registered Bundle ID, SKU and intended user access. Account Holder, Admin or App Manager access is required; the Account Holder must accept pending agreements.
8. Verify the new record through Apple app discovery. Then prepare metadata and an already signed build. Do not confuse draft creation with App Review submission or release.

### API tools

| Area | Commands |
| --- | --- |
| Bundle IDs | `apple_list_bundle_ids`, `apple_get_bundle_id`, `apple_create_bundle_id` |
| Capabilities | `apple_list_bundle_id_capabilities`, `apple_enable_capability`, `apple_update_capability` |
| Certificates | `apple_list_certificates`, `apple_create_certificate`, `apple_download_certificate` |
| Devices | `apple_list_devices`, `apple_register_device` |
| Profiles | `apple_list_profiles`, `apple_create_profile`, `apple_download_profile` |

All list commands retain `links.next`; use `apple_get_next_page` until the required inventory is complete. Certificate/profile bodies are redacted from tool output. Downloads create mode-0600 files and refuse overwrite, including output symlinks. They return path, byte count and SHA-256. No delete/revoke tools are added by this workflow. A certificate/profile creation timeout must be reconciled against store state before retrying.

## Google Play preparation

Enable **Android Publisher API** and **Play Developer Reporting API** in the credential's project, invite the service account to Play Console and grant the exact permissions in the [access checklist](access-setup.md). Browser automation additionally needs a signed-in Play Console user with permission to **Create, edit, and delete draft apps**. A service account JSON does not sign that user into the browser.

In the chosen browser/manual mode, open [Play Console](https://play.google.com/console/), select the intended developer account and choose **Create app**. Prepare app name, default language, app/game and free/paid choices. The user supplies or completes any required policy declarations and legal consents. The package identifier comes from the signed artifact; do not invent a package field on the creation form.

Google's Edits documentation requires an existing app and an initial console upload before API editing. Treat this as a separate setup step using the intended signed AAB/APK, only within the authorized scope. The browser workflow may assist when requested; otherwise provide exact instructions. An initial upload does not authorize production release. After setup, use `google_list_apps` for discovery and normal edit/listing/track tools for publishing work. Discovery alone does not prove release permissions.

## Verified API boundary (2026-09-29)

Apple OpenAPI 4.5 has GET `/v1/apps` and GET/PATCH `/v1/apps/{id}`, with no app creation endpoint. Google Publisher Discovery revision 20260929 has no ordinary public Play app creation method. Google `appstoreappsreview.createappstorehostedapp` is for apps hosted by third-party stores; Custom App Publishing creates permanently private enterprise apps. Neither substitutes for public Play app creation.

Sources: [Apple Apps](https://developer.apple.com/documentation/appstoreconnectapi/apps), [Apple OpenAPI](https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip), [Bundle IDs](https://developer.apple.com/documentation/appstoreconnectapi/bundle-ids), [Apple new app](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/), [Google Edits](https://developers.google.com/android-publisher/edits), [Publisher reference](https://developers.google.com/android-publisher/api-ref/rest), [third-party hosted apps](https://developers.google.com/android-publisher/api-ref/rest/v3/appstoreappsreview/createappstorehostedapp), [private enterprise apps](https://developers.google.com/android/work/play/custom-app-api/publish).
