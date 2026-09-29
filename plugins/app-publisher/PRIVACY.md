# Privacy

App Publisher is local software. The project does not operate a credential-hosting backend, collect analytics, sell data or receive your app files. Setup runs on 127.0.0.1 and stores credentials in a private local directory outside the plugin and Git. Files are plaintext protected by filesystem permissions, not encrypted keychain entries. Browser OAuth sends authorization requests and code exchanges to Google. API requests, metadata and requested uploads go to Apple or Google and their upload infrastructure.

The AI host receives requested app metadata, resource identifiers and operation results. App descriptions, testing configuration and review details can be sensitive. Secret-like response fields and presigned URL query strings are redacted, and raw provider exceptions are withheld. This does not make all app metadata public or non-sensitive. The host has its own data policy.

Dependency installation contacts the npm registry. Opening console links contacts the corresponding provider. The setup wizard contains no remote scripts, fonts or analytics. Replacing a connection retains old credential files locally; delete obsolete files and revoke old credentials deliberately. Removing the plugin does not automatically remove the separate credentials directory.

To report a problem, use the GitHub issue tracker without keys, account documents, private app data or raw OAuth logs: https://github.com/simbik/app-publisher/issues
