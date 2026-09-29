# Validation scope

The distributed implementation is original App Publisher code. Candidate store MCP source was evaluated for feasibility, but no candidate MCP source, tests or runtime dependency is included. Third-party dependencies are the MCP SDK, Google authentication, schema tooling and development tools, with exact direct versions and an integrity-pinned npm lockfile. Their licenses remain in the installed packages.

## Verified offline

- TypeScript check/build.
- Unit/contract tests: profile selection, write confirmation, secret/error redaction, Apple JWT signature/claims, official-origin checks, no automatic write retry, exact upload byte ranges, Google validate-before-commit and review preservation, track replacement, artifact hashes, upload recovery IDs, file permissions and local setup CSRF protection.
- MCP stdio initialization, tools/list schemas/annotations and blocked mutation response.
- Dependency audit with npm's current advisory database.
- Codex plugin manifest and skills validation.

## Limits

Tests use generated keys and mock API responses. They do not prove store permission configuration, OAuth consent completion, successful real artifact processing, TestFlight access, Google review outcomes or public release. Artifact hashes do not prove identity/signing. The publisher has not supplied store credentials for a live test. No app has been uploaded, submitted or released during development.

This is a bounded implementation review, not a comprehensive security audit. Filesystem credentials are plaintext with private permissions. Provider API schema changes and platform-specific browser behavior need ongoing validation. The browser wizard has a 15-minute lifetime and binds only to loopback.

## Release check, 2026-09-29

22 automated tests passed on Node.js 24.14.0/macOS ARM64. All 44 MCP tools appeared over stdio. TypeScript checks/build, Codex plugin validation and all three skill validators passed. npm audit reported zero known vulnerabilities at the time of checking. The setup form was inspected in the Codex browser; Apple and Google missing-file errors were exercised. No provider login/consent or credential import was completed in that UI review.

The packaged bootstrap also passed an MCP handshake from an unrelated working directory using a temporary runtime pointer. This covers Codex versions that leave plugin-root placeholders unexpanded. GitHub Actions independently passed the first 21-test suite on Node.js 22/Linux; the final 22-test run is linked from the release.
