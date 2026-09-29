import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tools } from "../src/tools.js";
test("built MCP server initializes, lists schema/annotations and blocks writes over stdio", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/cli.js", "serve"],
    env: {
      PATH: process.env.PATH!,
      APP_PUBLISHER_CONFIG: "/nonexistent/config.json",
      APP_PUBLISHER_ALLOW_WRITES: "0",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "app-publisher-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, tools.length);
    const upload = listed.tools.find((t) => t.name === "apple_upload_build")!;
    assert.equal(upload.annotations?.readOnlyHint, false);
    assert.ok(upload.inputSchema.required?.includes("profile"));
    const result = await client.callTool({
      name: "google_create_edit",
      arguments: {
        packageName: "com.example.app",
        profile: "default",
        confirm: true,
      },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /Writes disabled/);
  } finally {
    await client.close();
  }
});

test("packaged MCP bootstrap starts from an unrelated cwd using configured runtime pointer", async () => {
  const { mkdtempSync, writeFileSync, rmSync, readFileSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "app-publisher-bootstrap-"));
  try {
    const pointer = join(dir, "runtime.json");
    writeFileSync(pointer, JSON.stringify({ server: resolve("dist/cli.js") }), {
      mode: 0o600,
    });
    const definition = JSON.parse(readFileSync(".mcp.json", "utf8")).mcpServers[
      "app-publisher"
    ];
    const transport = new StdioClientTransport({
      ...definition,
      cwd: dir,
      env: { PATH: process.env.PATH!, APP_PUBLISHER_RUNTIME: pointer },
      stderr: "pipe",
    });
    const client = new Client({ name: "bootstrap-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      assert.equal((await client.listTools()).tools.length, tools.length);
    } finally {
      await client.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
