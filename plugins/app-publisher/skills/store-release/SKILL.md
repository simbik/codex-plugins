---
name: store-release
description: Upload signed IPA/AAB/APK artifacts, prepare TestFlight or Google Play testing, and stage or submit explicitly authorized app releases through App Publisher.
---

Determine the exact profile, app/package, version/build, artifact, target track or TestFlight group, and authorized action. This plugin uploads already signed artifacts; it does not build, sign, register developer accounts, handle banking, or automatically answer compliance declarations.

Read current store state before changing it. Use the bundled MCP tools or the CLI in [configuration](../../docs/configuration.md). Writes need local write enablement and confirm:true. Do not expand a request to prepare a release into permission to submit or publish it. Reuse existing authorization when scope is clear.

Compute the artifact's SHA-256 locally and pass expectedSha256. Verify bundle/package identity and signature with platform build tooling where available; the hash only identifies the selected file and does not prove signing or package identity. Never request signing keys in chat.

Apple: upload the IPA, retain buildUploadId/buildUploadFileId, poll apple_get_build_upload with reasonable intervals, and find the imported build with apple_list_builds. Check processing and export compliance. Attach the build to the intended version. For testing, add an imported build to an existing TestFlight group; external groups may need Beta App Review in the console. For App Review, create a draft review submission, attach the correct version, inspect it, then submit only within user authorization. Release approved manual versions only when PENDING_DEVELOPER_RELEASE. Do not repeat a submission after a timeout without checking state.

Google: create or verify an edit, inspect existing bundles/APKs and tracks, upload only the missing artifact, and verify versionCode. google_update_track replaces the complete releases array: read it first and preserve every release that should remain. Prefer the requested internal/closed track; never assume production. Validate before committing. The commit tool refuses to cancel an existing review. Do not work around that refusal by canceling review automatically. Managed publishing, review and staged rollouts may delay availability.

Provide a release plan containing identifiers, artifact hash, locale changes, exact audience/track and rollout values before irreversible external actions. When already authorized, execute it and read back state. Recovery responses may contain reservation IDs: retain them and inspect before another upload. No automatic destructive cleanup.

Report uploaded, processing, testing, submitted, approved and publicly available as separate states. The current plugin has no live credential test history bundled into its release. Console-only gaps and supported operations are listed in [capabilities](../../docs/capabilities.md).

For a new app without a store record, follow [store-app-setup](../store-app-setup/SKILL.md). Ask once whether to create the card automatically in the Codex in-app browser or provide manual instructions, unless the user already chose. Browser login is separate from API credentials. Use supported Apple provisioning tools for preparation; never silently choose a browser mode.
