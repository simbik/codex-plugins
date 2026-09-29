# App Publisher local plugin

Requires Node.js 22+ and npm. Run these commands in this directory:

```sh
npm ci --ignore-scripts
npm run build
npm run configure
node dist/cli.js setup
```

The local browser wizard connects Apple and Google accounts without entering secrets in chat. Start a new Codex task after setup so the MCP server can load. One account profile can serve multiple apps.

See [configuration](docs/configuration.md), [capabilities](docs/capabilities.md), [privacy](PRIVACY.md), and [source repository](https://github.com/simbik/app-publisher).

This is an early release with offline tests. No real app has been uploaded or published as part of its validation. This package is not approved in the official OpenAI plugin directory.
