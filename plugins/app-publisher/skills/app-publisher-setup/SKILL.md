---
name: app-publisher-setup
description: Connect Apple App Store Connect or Google Play accounts to App Publisher using a local browser wizard; diagnose local installation and authentication.
---

Use the bundled local setup wizard. Never ask the user to paste a key, refresh token, client secret or service account JSON into chat.

Resolve the plugin root as two directories above this skill file. Run commands in that root, not the user's app repository. Requires Node.js 22 or later. On first use run `npm ci --ignore-scripts` and `npm run build`, then `npm run configure`; both are local setup steps with dependencies locked in package-lock.json. Do not download or execute third-party install scripts.

Run `node dist/cli.js setup`. It opens a loopback browser wizard with direct Apple and Google console links, file selectors, profile names and access-check buttons. Let the user interact with provider login, consent and credential file selection themselves. Keep the process running while they connect, including between agent turns (launch it as a detached process when your command runner does not preserve foreground processes). The wizard has no expiry timer. The user can stop it with Finish setup. Do not read the saved credential files.

Apple: the wizard imports a downloaded .p8 and infers Key ID from the filename. Team keys additionally need Issuer ID from the linked Apple page. Apple has no equivalent user OAuth sign-in for this API.

Google: use a service account JSON. The wizard includes direct links for both Android Publisher API and Play Developer Reporting API, service account creation, JSON download and Play Console invitation. It verifies authentication and lists accessible apps through Reporting API before saving; failures preserve the previous profile. No package name is required. New Desktop OAuth onboarding is not supported. Existing OAuth profiles remain usable where their scopes permit. Do not claim that Reporting discovery proves Publisher enablement or release permissions. Give the user the complete [API and permission checklist](../../docs/access-setup.md), including all permissions required for their intended publishing workflow; do not send them on an unexplained console hunt.

Profiles represent accounts, not individual apps. One profile can serve all apps permitted by that account. Use another profile for another account. Profile selection is not an app-level authorization sandbox.

Run `node dist/cli.js doctor` for credential-presence checks without revealing values. It does not verify network access. The wizard checks saved connections; save or connect a newly selected file first. Apple Team keys come from Users and Access → Integrations and need Issuer ID even for an individual developer account. Google checks Reporting app discovery without a package name. Use google_list_apps to list saved-account apps; SERVICE_DISABLED identifies the disabled API without exposing provider error bodies. Once setup/build finishes, start a new Codex task if MCP tools were unavailable at startup. CLI fallback is `node dist/cli.js schema TOOL` then `node dist/cli.js call TOOL /absolute/args.json`; keep argument files private.

See [configuration](../../docs/configuration.md) for paths and write-session controls, or [privacy](../../PRIVACY.md) for data handling.
