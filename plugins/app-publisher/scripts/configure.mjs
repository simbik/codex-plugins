import { mkdirSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
const server = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
if (!existsSync(server))
  throw new Error("Build App Publisher before configuring the launcher.");
const target =
  process.env.APP_PUBLISHER_RUNTIME ||
  join(homedir(), ".config", "app-publisher", "runtime.json");
mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
const temp = target + "." + randomUUID() + ".tmp";
writeFileSync(temp, JSON.stringify({ server }) + "\n", {
  mode: 0o600,
  flag: "wx",
});
renameSync(temp, target);
console.log(
  "App Publisher local launcher configured. Start a new Codex task to load MCP tools.",
);
