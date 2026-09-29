#!/usr/bin/env python3
"""Build a deterministic plugin ZIP from explicit public package paths."""
import argparse
import hashlib
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

repo = Path(__file__).resolve().parents[1]
plugin = repo / 'plugins' / 'app-publisher'
parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path)
args = parser.parse_args()
if not (plugin / 'dist/cli.js').is_file():
    raise SystemExit('Build the plugin with npm run build first.')
args.output.mkdir(parents=True, exist_ok=True)
paths = ['.codex-plugin', '.mcp.json', 'skills', 'scripts', 'assets', 'docs',
         'src', 'dist', 'tests', 'package.json', 'package-lock.json', 'tsconfig.json',
         'LICENSE', 'PRIVACY.md', 'TERMS.md', 'README.md']
archive = args.output / 'app-publisher-0.1.0.zip'
with ZipFile(archive, 'w', ZIP_DEFLATED) as out:
    for relative in sorted(paths):
        root = plugin / relative
        files = sorted(root.rglob('*')) if root.is_dir() else [root]
        for path in files:
            if path.is_file():
                info = ZipInfo('app-publisher/' + path.relative_to(plugin).as_posix(), (2026, 9, 29, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                out.writestr(info, path.read_bytes())
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(args.output / 'SHA256SUMS').write_text(f'{digest}  {archive.name}\n')
print(f'{archive.name}: {archive.stat().st_size} bytes; sha256 {digest}')
