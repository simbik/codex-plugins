#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, checkKey } from "./config.js";
import { tools, invoke, isWrite, toolSchema } from "./core.js";
const [command = "help", name, file] = process.argv.slice(2);
const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));
async function main() {
  if (command === "setup") {
    const { startSetup } = await import("./setup.js");
    await startSetup();
    return;
  }
  if (command === "serve") {
    const server = new McpServer({ name: "app-publisher", version: "0.1.6" });
    for (const t of tools)
      server.registerTool(
        t.name,
        {
          description: t.description,
          inputSchema: toolSchema(t).shape,
          annotations: {
            readOnlyHint: !isWrite(t.name),
            destructiveHint: isWrite(t.name),
            openWorldHint: true,
            idempotentHint: !isWrite(t.name),
          },
        },
        async (args) => {
          const result = await invoke(t.name, args);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result ?? {}) },
            ],
            isError: !!(
              result &&
              typeof result === "object" &&
              "error" in result
            ),
          };
        },
      );
    await server.connect(new StdioServerTransport());
    return;
  }
  if (command === "tools") {
    print(
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        write: isWrite(t.name),
      })),
    );
    return;
  }
  if (command === "schema") {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error();
    const { zodToJsonSchema } = await import("zod-to-json-schema");
    print(zodToJsonSchema(toolSchema(t)));
    return;
  }
  if (command === "doctor") {
    const config = loadConfig();
    print({
      networkChecked: false,
      writesEnabled: process.env.APP_PUBLISHER_ALLOW_WRITES === "1",
      profiles: Object.entries(config.profiles).map(([name, p]) => ({
        name,
        apple: !!p.apple,
        google: !!p.google,
        credentialFilesReadable: [
          p.apple?.p8Path,
          p.google &&
            ("oauthTokenPath" in p.google
              ? p.google.oauthTokenPath
              : p.google.serviceAccountPath),
        ]
          .filter(Boolean)
          .every((path) => {
            try {
              checkKey(path!);
              readFileSync(path!);
              return true;
            } catch {
              return false;
            }
          }),
      })),
    });
    return;
  }
  if (command === "call" && name && file) {
    const result = await invoke(name, JSON.parse(readFileSync(file, "utf8")));
    print(result ?? {});
    if (result && typeof result === "object" && "error" in result)
      process.exitCode = 1;
    return;
  }
  console.log(
    "App Publisher: setup | tools | schema TOOL | doctor | call TOOL args.json | serve",
  );
}
main().catch(() => {
  console.error(
    "App Publisher failed. Check command, local configuration and file permissions. No raw error details are logged.",
  );
  process.exitCode = 1;
});
