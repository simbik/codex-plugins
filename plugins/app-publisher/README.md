# App Publisher

A local Codex plugin for Apple App Store Connect and Google Play Console. Connect accounts in a browser wizard, prepare localized listings, upload signed builds and screenshots, and stage testing or releases. One installation serves multiple apps and account profiles.

**Own MCP server and direct store API clients.** No dependency on a third-party app-publishing MCP. Credentials stay outside Git on your computer. Version 0.1.2 is an early release with offline contract/security tests; live store publishing has not yet been verified.

## Install

Requires Codex with plugin support, Node.js 22+ and npm.

```sh
codex plugin marketplace add simbik/codex-plugins
codex plugin add app-publisher@simbik
```

Start a new Codex task and ask: **“Use App Publisher to connect my Apple and Google accounts.”** The setup skill installs locked dependencies, builds the local server, and opens the connection wizard. The initial MCP startup may report that setup is required; the setup skill remains usable. Start another task after the build to load MCP tools.

For a source checkout:

```sh
git clone https://github.com/simbik/codex-plugins.git
cd codex-plugins/plugins/app-publisher
npm ci --ignore-scripts
npm run build
npm run configure
node dist/cli.js setup
```

The wizard provides direct console links and file selectors. Apple Key ID is inferred from the .p8 filename; team keys also need the Issuer ID from Apple's key page. Google supports a service account JSON or a Desktop OAuth client JSON followed by Google consent. No shared verified Google OAuth client is shipped yet, so the first connection cannot be universal one-click sign-in. Later sessions reuse the saved connection.

![Connection wizard icon](assets/logo.png)

## What it does

- **Read:** apps, versions, builds, upload/review state, listings, edits and tracks.
- **Prepare:** version localizations, Play descriptions, screenshots and tester groups.
- **Upload:** signed IPA, AAB and APK files with SHA-256 checks.
- **Release:** staged App Review submission, approved manual Apple release, Google edit validation and commit. Google commits refuse to cancel an existing review.
- **Control:** explicit account profile on every call, writes disabled by default, confirmation on each mutation, retained IDs after ambiguous upload failures.

Preparing a release does not imply authorization to publish. A successful upload does not mean store approval or public availability. Account enrollment, banking, app creation, signing, IAP and many compliance forms remain outside this release. See [capabilities](docs/capabilities.md).

## Documentation

- [Connection and configuration](docs/configuration.md)
- [Metadata skill](skills/store-metadata/SKILL.md)
- [Release skill](skills/store-release/SKILL.md)
- [Privacy](PRIVACY.md), [terms](TERMS.md), [MIT license](LICENSE)
- [Validation and review scope](../../docs/VALIDATION.md)
- [Official directory submission status](../../docs/STORE-SUBMISSION.md)

## Development

```sh
cd plugins/app-publisher
npm ci --ignore-scripts
npm run check
npm run build
npm test
npm audit
```

All automated tests use synthetic local files and mocked store responses; no store credentials are required. The MCP smoke test launches the compiled server. Pin dependency upgrades in package-lock.json and review API contract changes. Never put keys, downloaded credentials, signed builds or real app metadata into commits or test fixtures.

Contributions and issues: https://github.com/simbik/codex-plugins/issues. Do not include secrets in reports.

## Distribution status

Public GitHub marketplace distribution is separate from the official OpenAI plugin directory. App Publisher is **not yet submitted to or accepted in the official directory**. The current public submission route requires HTTPS for MCP; this release is local stdio and needs OpenAI's local-MCP support path. See the submission dossier for exact remaining steps.
