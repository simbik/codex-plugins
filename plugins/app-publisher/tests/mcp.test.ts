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
