# Apple and Google setup: APIs and permissions

This checklist covers App Publisher’s current workflows: reading store data, metadata, screenshots, signed build uploads, testing tracks/TestFlight, review submissions and releases. Complete setup once. **Verify and save** checks the selected credential before writing it; failed verification preserves the existing connection. Select credential files in the wizard rather than pasting secrets into chat or editing configuration.

## Google: enable two APIs in the same Cloud project

1. Sign in to [Google Cloud Console](https://console.cloud.google.com/) and select the project that will own the service account.
2. Open [Google Play Android Developer API / Android Publisher](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com) → **Enable**. This API handles metadata, screenshots, AAB/APK uploads, tracks and releases.
3. Open [Google Play Developer Reporting API](https://console.cloud.google.com/apis/library/playdeveloperreporting.googleapis.com) → **Enable**. This separate API lists accessible apps without a package name. Enabling Publisher alone is not enough for discovery.
4. Open [Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) → **Create service account**, enter a name and finish creation. Cloud Owner/Editor roles are not required for Play access; app permissions are granted in Play Console.
5. Open the new service account → **Keys → Add key → Create new key → JSON**. Download the file. If an organization policy blocks key creation, a Cloud administrator must resolve that policy; the wizard does not bypass it.
6. Select the JSON file in the wizard. It displays the email to invite and points the API links at the project from that file. Checking a saved connection also updates these links.
7. Open [Google Play Console](https://play.google.com/console/), select your developer account → **Users and permissions → Invite new users**. Enter the **service account email**, not your personal Google email.
8. Under **App permissions**, add your target apps and select the permissions below. To cover every app, use the corresponding **Account permissions**. Click **Invite user** and ensure access has not expired.
9. Click **Verify and save Google**. The wizard verifies authentication and reads every page of the accessible app list. After recently changing permissions or enabling APIs, allow a few minutes for propagation and retry. Failed checks do not replace the saved key.

### Google Play Console permissions

Grant these permissions on the target apps for all current publishing workflows. Production and draft permissions are needed only when working with those workflows.

| Workflow | Console permission | API identifier |
| --- | --- | --- |
| Read and discover apps and app data | **View app information (read-only)** | `CAN_VIEW_NON_FINANCIAL_DATA` (legacy: `CAN_ACCESS_APP`) |
| Read information across every app | **View app information and download bulk reports (read-only)** under Account permissions | `CAN_SEE_ALL_APPS` in console exports |
| Descriptions, translations and screenshots | **Manage store presence** | `CAN_MANAGE_PUBLIC_LISTING` |
| Upload builds and release to testing tracks | **Release apps to testing tracks** / **Release to testing tracks** | `CAN_MANAGE_TRACK_APKS` |
| Configure tracks and tester lists | **Manage testing tracks and edit tester lists** | `CAN_MANAGE_TRACK_USERS` |
| Production releases and staged rollouts | **Release to production, exclude devices, and use Play App Signing** | `CAN_MANAGE_PUBLIC_APKS` |
| Work with draft apps | **Edit and delete draft apps** | `CAN_MANAGE_DRAFT_APPS` |

Current tools do not require financial, order, subscription, review-reply or user-management permissions. Cloud IAM permissions and Play Console permissions are separate. This service-account flow does not need an OAuth consent screen, Desktop OAuth client, Play Games API, Pub/Sub or Cloud Owner access. The plugin does not create the initial Play Console app or configure signing: the app record and signed AAB/APK must already exist.

**What setup verifies:** Google accepts the key, Reporting API is enabled, and apps.search responds. An empty app list is reported explicitly; check app grants if you expected apps. Discovery does not establish Publisher API enablement, mutation permissions or production readiness. Those operations are checked when used. Setup does not publish a trial release to test permissions.

**Error recovery:**

- `INVALID_CREDENTIALS` / 401: check for a deleted or revoked key, a disabled service account, or an incorrect JSON file.
- `SERVICE_DISABLED`: enable the API named in the message in the credential’s Cloud project.
- 403 without `SERVICE_DISABLED`: check the Play Console invitation, app grants and access expiration.
- `ACCESS_TOKEN_SCOPE_INSUFFICIENT`: a legacy OAuth profile lacks Reporting scope; reconnect with a service account.
- 429: the service rate limit was reached; retry later.

Sources: [Publisher setup](https://developers.google.com/android-publisher/getting_started), [Reporting setup](https://developers.google.com/play/developer/reporting/overview), [apps.search](https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/apps/search), [current app permissions](https://developers.google.com/android-publisher/api-ref/rest/v3/grants), [Play Console permission labels](https://support.google.com/googleplay/android-developer/answer/10019561?hl=en).

## Apple: App Store Connect API

1. Open [Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api). If **Request Access** appears, the Account Holder must request API access and personally accept Apple’s terms.
2. For metadata, build and release workflows, create a **Team Key** with the **App Manager** role. This covers app management, metadata, builds, TestFlight, review submissions and releases. An existing **Admin** key also works; there is no need to replace a working key. Team keys can be created by the Account Holder or an Admin.
3. Download the `.p8` file. Select **Team key** in the wizard. Key ID is inferred from the filename; copy **Issuer ID** from above the key list on the same Apple page.
4. Click **Verify and save Apple**. The wizard verifies access by requesting the app list. A 401/403 leaves the previous connection intact.

**Team/Individual describes the API key, not the developer account.** A key from Team Keys requires Team and Issuer ID even if your developer account belongs to an individual.

Team keys apply to every app on the team within the selected role and cannot be restricted to one app. To restrict app access, use an **Individual API Key** from an App Manager user with the intended app grants: user menu → **Edit Profile → Individual API Key**. Select Individual in the wizard and leave Issuer ID empty. If individual key creation is disabled, an Admin or Account Holder can restore that user’s Generate Individual API Keys permission.

Current tools do not require separate In-App Purchase keys, subscription shared secrets or Finance access. An API key is not a signing certificate: uploads require an already signed `.ipa`. Provisioning preparation is available with a Team key and the permissions below; building and signing remain local build tasks. External TestFlight can require Beta App Review. A successful app-list request does not bypass Apple’s requirements for build status, agreements, listing completeness or app review.

Sources: [Apple key creation and key types](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api), [Apple roles](https://developer.apple.com/help/account/access/roles), [JWT fields for Team and Individual keys](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests).

## Apple provisioning permissions

The new bundle ID, capability, certificate, device and profile commands require a **Team API key**. An Individual key cannot access these endpoints, regardless of the associated user's role. Do not replace a working key solely because new commands exist; check its permissions for the intended operation.

For the full workflow including distribution certificate creation, use an **Admin Team key** created in [Users and Access → Integrations](https://appstoreconnect.apple.com/access/integrations/api). Apple reserves distribution certificate creation to Account Holder/Admin; Developer ID certificates can have additional Account Holder restrictions. Never grant Finance access for provisioning. A more limited key may be sufficient when certificates already exist and the intended endpoint permits it.

For human users of an organization, an Account Holder/Admin can grant **Certificates, Identifiers & Profiles** access in [Users and Access](https://appstoreconnect.apple.com/access/users). App Manager/Developer roles alone do not guarantee that separate access. Users added to an individual developer's App Store Connect account are not members of that developer's Apple Developer Program team. The Account Holder must keep membership and agreements current.

There is no separate Apple Cloud API switch. Use the local wizard to save the Team key and Issuer ID, then test the provisioning list commands required by the task. HTTP 403 on these endpoints can mean provisioning/role restrictions even when the app list works. Google requires no additional API for the browser-created public app card; the signed-in console user needs permission to create draft apps.

See [first-app setup](first-app-setup.md) for automatic/browser versus manual creation and the certificate/profile workflow.

Sources: [API key restrictions](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api), [certificate roles](https://developer.apple.com/help/account/certificates/certificates-overview), [App Manager access](https://developer.apple.com/help/glossary/app-manager/), [role matrix](https://developer.apple.com/help/account/access/roles).
