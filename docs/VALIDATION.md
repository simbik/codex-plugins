# Validation scope

The distributed implementation is original App Publisher code. Candidate store MCP source was evaluated for feasibility, but no candidate MCP source, tests or runtime dependency is included. Third-party dependencies are the MCP SDK, Google authentication, schema tooling and development tools, with exact direct versions and an integrity-pinned npm lockfile. Their licenses remain in the installed packages.

## Verified offline

- TypeScript check/build.
- Unit/contract tests: profile selection, write confirmation, secret/error redaction, Apple JWT signature/claims, official-origin checks, no automatic write retry, exact upload byte ranges, Google validate-before-commit and review preservation, track replacement, artifact hashes, upload recovery IDs, file permissions and local setup CSRF protection.
- MCP stdio initialization, tools/list schemas/annotations and blocked mutation response.
- Dependency audit with npm's current advisory database.
- Codex plugin manifest and skills validation.

## Limits

Tests use generated keys and mock API responses. They do not prove store permission configuration, OAuth consent completion, successful real artifact processing, TestFlight access, Google review outcomes or public release. Artifact hashes do not prove identity/signing. Read-only Apple access and Google token authentication have been verified with local credentials. Google Reporting discovery returned SERVICE_DISABLED until that API is enabled. No app has been uploaded, submitted or released during development.

This is a bounded implementation review, not a comprehensive security audit. Filesystem credentials are plaintext with private permissions. Provider API schema changes and platform-specific browser behavior need ongoing validation. The browser wizard binds only to loopback and stays open until explicit shutdown.

## Release check, 2026-09-29

22 automated tests passed on Node.js 24.14.0/macOS ARM64. All 44 MCP tools appeared over stdio. TypeScript checks/build, Codex plugin validation and all three skill validators passed. npm audit reported zero known vulnerabilities at the time of checking. The setup form was inspected in the Codex browser; Apple and Google missing-file errors were exercised. No provider login/consent or credential import was completed in that UI review.

The packaged bootstrap also passed an MCP handshake from an unrelated working directory using a temporary runtime pointer. This covers Codex versions that leave plugin-root placeholders unexpanded. GitHub Actions independently passed the first 21-test suite on Node.js 22/Linux; the final 22-test run is linked from the release.

## Connection fixes, 0.1.3

Candidate credentials are validated before any persistence. Tests cover rejected Apple/Google replacements preserving the config and credential files, missing Team issuer, Reporting pagination, safe disabled-API diagnostics, explicit wizard shutdown and availability after 15 minutes. Google app discovery is exposed as a read-only MCP tool. New onboarding uses service accounts, with complete API/permission steps in the wizard and docs/access-setup.md. Existing OAuth profiles remain compatible for their previously granted scopes.

The 0.1.3 check/build and 30-test suite passed on Node.js 24/macOS, including the built MCP transport with 45 tools. Plugin and modified skill validation passed. A real browser confirmed Apple API access and the specific Google Reporting SERVICE_DISABLED message. Dependency audit reported zero production advisories at this check.

## 0.1.6 — first-app workflow and Apple provisioning

TypeScript check/build and 37 tests passed on Node.js 24/macOS. The MCP now exposes 59 tools. Six provisioning tests cover Team-key restrictions, write guards, exact relationship payloads, required development devices, CSR/private-key separation, capability updates, device registration, file permissions, non-overwrite/symlink protection and content redaction. Apple contracts were compared with the public OpenAPI 4.5 specification. Plugin validation and validation of all three new/modified skills passed.

The new store-app-setup skill offers automatic creation in the Codex in-app browser or manual instructions, reuses an explicit choice, hands login/2FA to the user and verifies the resulting app through API discovery. Browser availability depends on the host. This workflow was reviewed against the requested branching behavior; live store-card creation and live provisioning mutations were not exercised. No real app record, certificate, device or profile was created during this update.
