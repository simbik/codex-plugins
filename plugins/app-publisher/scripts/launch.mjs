import { existsSync } from "node:fs";
if (!existsSync(new URL("../dist/cli.js", import.meta.url))) {
  console.error(
    "App Publisher needs setup. Follow the app-publisher-setup skill, then start a new task.",
  );
  process.exit(1);
}
process.argv = [process.argv[0], process.argv[1], "serve"];
await import("../dist/cli.js");
