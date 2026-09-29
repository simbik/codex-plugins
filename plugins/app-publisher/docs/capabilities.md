# First release boundaries

App Publisher implements its own MCP server and direct REST clients. It does not depend on app-publish-mcp, fastlane or another store MCP server. Official MCP and Google authentication libraries handle protocol and Google credentials; Node crypto signs Apple JWTs.

| Workflow | Apple | Google |
| --- | --- | --- |
| State | apps, versions, builds, upload/review state | app discovery via Reporting API, edits, listings, bundles, APKs, tracks |
| Localized copy | version descriptions, keywords, release notes | title, short/full description |
| Screenshots | create set, append upload, delivery check | append images in an edit |
| Signed builds | IPA via Build Uploads API, SHA-256 | AAB/APK uploads, SHA-256 |
| Testing | existing TestFlight groups, add build | testing tracks and Google Groups |
| Release | draft review, attach version, submit, manual release | full track update, validate and commit edit |
| First app | bundle IDs, capabilities, certificates, devices, profiles; browser/manual card creation | browser/manual card creation |
| Credentials | team/individual .p8 key | service account onboarding; existing OAuth profiles supported |

App name/subtitle edits, screenshot deletion/reordering, building/signing binaries, IAP, pricing, banking, tax forms, automated compliance declarations and a hosted remote MCP service are outside this release. TestFlight external testing can require Beta App Review in the console. First-app setup is guided by [store-app-setup](../skills/store-app-setup/SKILL.md): choose automatic Codex in-app browser creation or manual instructions. Neither store offers public app-record creation through its publishing API. Google account and initial app setup must be complete before using the publishing edit workflow.

Profile selection chooses an account; it is not an app-level security sandbox. Provider IAM remains the security boundary. Local workflows run with the user's filesystem access. Store tool responses include app metadata and identifiers and are visible to the AI host. Avoid placing sensitive data in metadata unless necessary.

Uploads are asynchronous. Upload success does not prove processing, review acceptance, publication or correct signing. Read-only Apple authentication has been verified live. Google credentials are valid; Reporting API was disabled in the tested account. Upload/release operations remain unverified against live stores. Automated tests use synthetic data and mocked transports.

Reference contracts:
- https://developer.apple.com/documentation/appstoreconnectapi
- https://developer.apple.com/documentation/appstoreconnectapi/build-uploads
- https://developers.google.com/android-publisher/api-ref/rest
- https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit
