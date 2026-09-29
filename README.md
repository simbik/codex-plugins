# Simbik Plugins

A Git-backed marketplace of independent Codex plugins. Connect this repository once, then install the plugins you need. Each plugin keeps its own name, version, skills and runtime.

## Install the marketplace

```sh
codex plugin marketplace add simbik/codex-plugins
```

## Available plugins

| Plugin | Purpose | Install |
| --- | --- | --- |
| [App Publisher](plugins/app-publisher/README.md) | Local Apple App Store Connect and Google Play workflows: account setup, metadata, signed uploads and staged releases | `codex plugin add app-publisher@simbik` |

The selector is `plugin-name@marketplace-name`. The marketplace ID is `simbik`; its display name is **Simbik Plugins**. The GitHub repository is `simbik/codex-plugins`.

After installing App Publisher, start a new Codex task and ask it to open the account connection wizard. Node.js 22+ and npm are required. The setup skill installs locked dependencies, builds the server and configures the local launcher. Store credentials stay outside the repository.

## Existing installations

If you installed the former `app-publisher` marketplace, migrate with:

```sh
codex plugin marketplace add simbik/codex-plugins
codex plugin add app-publisher@simbik
codex plugin remove app-publisher@app-publisher
codex plugin marketplace remove app-publisher
```

Then run the App Publisher setup skill in a new task to build/configure the new installation. Existing account profiles remain in their separate local configuration directory; they do not need to be recreated.

## Repository layout

- `.agents/plugins/marketplace.json` lists the plugins.
- `plugins/<plugin-name>/` contains each independent plugin and its `.codex-plugin/plugin.json`.
- `docs/` contains validation and publishing notes for App Publisher.
- `scripts/package.py` packages the App Publisher release.

To add another plugin, give it a separate directory and manifest, add an entry to the catalog, and document its setup and permissions. Never commit credentials or real user data.

## Development

```sh
cd plugins/app-publisher
npm ci --ignore-scripts
npm run check
npm run build
npm test
```

See [App Publisher validation](docs/VALIDATION.md) and its [capability boundaries](plugins/app-publisher/docs/capabilities.md). GitHub marketplace distribution is separate from the official OpenAI directory; see [submission status](docs/STORE-SUBMISSION.md).

[MIT license](LICENSE) · [Privacy](PRIVACY.md) · [Terms](TERMS.md) · [Issues](https://github.com/simbik/codex-plugins/issues)
