# Local configuration

The preferred setup is `node dist/cli.js setup` from the plugin directory. It opens a private loopback wizard and writes configuration for you. No keys belong in chat or Git.

Requires Node.js 22+ and npm. On first install: `npm ci --ignore-scripts && npm run build && npm run configure`. Package installation does not happen automatically when the MCP server launches.

Configuration defaults to `~/.config/app-publisher/config.json`. `APP_PUBLISHER_CONFIG` may point to another absolute private file. Config and credentials require mode 600 on Unix; the wizard creates a mode 700 directory. Windows users must protect the directory with their account ACLs. Files are local plaintext credentials, not an OS keychain. Old credential files remain after replacement for deliberate manual cleanup; revoke obsolete keys at the provider.

A profile can have Apple, Google or both. The wizard stores only local paths in configuration. It accepts a Google service account JSON or a downloaded Desktop OAuth client JSON, exchanges the latter through a state-bound PKCE flow, and saves the refresh token locally. A shared publisher-owned OAuth client is not included in 0.1.0.

`node dist/cli.js doctor` checks configured profiles and private file availability without printing credential values. It is not a network check. The wizard's Apple check reads one app; Google's check reads reviews for the selected package. Successful checks do not prove release permissions.

## Authorized write session

Reads work by default. Start the CLI or MCP host with `APP_PUBLISHER_ALLOW_WRITES=1` only for a user-authorized write session. Every mutation also requires `confirm: true` in its arguments. The flag is a technical guard, not authorization to publish anything. For a one-off CLI mutation Codex can set the variable on that command, without asking the user to edit configuration.

Example read arguments file (private local file):

```json
{"profile":"default","appId":"123456789"}
```

```sh
node dist/cli.js tools
node dist/cli.js schema apple_get_app
node dist/cli.js call apple_get_app /absolute/path/to/args.json
```

Calls emit structured JSON. Exit status 1 means failure. No raw provider exception bodies or tokens are logged. Recovery IDs should be retained before retrying an ambiguous operation. CLI input/output may include private app metadata: do not commit it.

## Troubleshooting

- No MCP tools: finish dependency installation/build in the installed plugin directory and start a new task. The launcher prints a setup message and exits if the build is absent.
- Writes disabled: use the session flag for an action already authorized by the user, plus confirm:true.
- 401/403: use the wizard's direct console links to verify API enablement, current key, account role and app grants. Do not paste the key into a bug report.
- Google OAuth access denied: check the Cloud project's consent setup/test users and use a Desktop client. This project has no verified shared OAuth client.
- Generic operation failure: check IDs, permissions and store state. Raw errors are deliberately withheld because they can contain credentials, review passwords or signed URLs.
- Timeout after upload/commit: inspect the edit, build or returned recovery IDs first. Writes are never automatically retried.

## Portable local launcher

Some Codex versions do not expand plugin-root placeholders in MCP arguments. `npm run configure` writes a mode-600 runtime.json beside the default config, pointing to the built CLI in this installation. The bundled launcher reads that pointer instead of relying on cache paths or shell interpolation. Run configure again after an upgrade; the setup skill does this automatically. APP_PUBLISHER_RUNTIME can override the pointer location for tests or custom installations. This file contains a local executable path, not credentials.
