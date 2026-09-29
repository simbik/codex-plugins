import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { startSetup, saveConnection } from "../src/setup.js";
import {
  AppleClient,
  GoogleClient,
  ApiFailure,
  jsonRequest,
} from "../src/api.js";

test("failed candidate checks preserve existing credentials and config for both stores", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "publisher-candidate-"));
  const path = join(dir, "config.json");
  const previous = process.env.APP_PUBLISHER_CONFIG;
  process.env.APP_PUBLISHER_CONFIG = path;
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  const google = {
    type: "service_account",
    project_id: "synthetic-project",
    client_email: "test@project.iam.gserviceaccount.com",
    private_key: generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString(),
    token_uri: "https://oauth2.googleapis.com/token",
  };
  saveConnection(
    "default",
    "apple",
    key,
    { keyId: "OLD", keyType: "INDIVIDUAL" },
    false,
    path,
  );
  saveConnection("default", "google", JSON.stringify(google), {}, false, path);
  const before = readFileSync(path, "utf8");
  const files = readdirSync(dir).sort();
  const { server, url } = await startSetup(false);
  const u = new URL(url);
  const post = async (platform: string, data: any) => {
    const r = await fetch(u.origin + "/connect/" + platform, {
      method: "POST",
      headers: {
        origin: u.origin,
        "x-setup-token": u.searchParams.get("token")!,
      },
      body: JSON.stringify({ profile: "default", replace: true, ...data }),
    });
    return { status: r.status, ...(await r.json()) };
  };
  try {
    const appleRequest = t.mock.method(
      AppleClient.prototype,
      "request",
      async () => {
        throw new ApiFailure(401);
      },
    );
    let result = await post("apple", {
      key,
      keyId: "NEW",
      keyType: "INDIVIDUAL",
    });
    assert.equal(result.status, 400);
    assert.match(result.error, /401/);
    assert.equal(readFileSync(path, "utf8"), before);
    assert.deepEqual(readdirSync(dir).sort(), files);
    result = await post("apple", { key, keyId: "NEW", keyType: "TEAM" });
    assert.match(result.error, /Issuer ID/);
    const googleAuth = t.mock.method(
      GoogleClient.prototype,
      "verifyAuthentication",
      async () => {
        throw new Error("PRIVATE_TOKEN_BODY");
      },
    );
    result = await post("google", { key: JSON.stringify(google) });
    assert.equal(result.status, 400);
    assert.doesNotMatch(result.error, /PRIVATE_TOKEN_BODY/);
    assert.equal(readFileSync(path, "utf8"), before);
    assert.deepEqual(readdirSync(dir).sort(), files);
    googleAuth.mock.mockImplementation(async () => {});
    const googleApps = t.mock.method(
      GoogleClient.prototype,
      "listApps",
      async () => {
        const e = new ApiFailure(403);
        (e as any).reason = "SERVICE_DISABLED";
        (e as any).service = "playdeveloperreporting.googleapis.com";
        throw e;
      },
    );
    result = await post("google", { key: JSON.stringify(google) });
    assert.equal(result.status, 400);
    assert.match(result.error, /Reporting API.*disabled/);
    assert.equal(result.projectId, "synthetic-project");
    assert.equal(readFileSync(path, "utf8"), before);
    assert.deepEqual(readdirSync(dir).sort(), files);
    googleApps.mock.mockImplementation(async () => [
      { name: "apps/com.example", displayName: "Example" },
    ]);
    result = await post("google", { key: JSON.stringify(google) });
    assert.equal(result.status, 200);
    assert.equal(result.apps[0].name, "apps/com.example");
    appleRequest.mock.mockImplementation(async () => ({ data: [] }));
    result = await post("apple", { key, keyId: "NEW", keyType: "INDIVIDUAL" });
    assert.equal(result.status, 200);
    assert.equal(
      JSON.parse(readFileSync(path, "utf8")).profiles.default.apple.keyId,
      "NEW",
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    if (previous === undefined) delete process.env.APP_PUBLISHER_CONFIG;
    else process.env.APP_PUBLISHER_CONFIG = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Google discovery uses Reporting API pagination without a package or leaking tokens", async () => {
  const urls: string[] = [];
  const c = new GoogleClient(
    { clientId: "fake", clientSecret: "fake", refreshToken: "fake" },
    async (url) => {
      urls.push(String(url));
      return Response.json(
        urls.length === 1
          ? {
              apps: [{ name: "apps/com.first", displayName: "First" }],
              nextPageToken: "next+page",
            }
          : { apps: [{ name: "apps/com.second", displayName: "Second" }] },
      );
    },
  );
  (c as any).reportingAuth = {
    getAccessToken: async () => ({ token: "PRIVATE_TOKEN" }),
  };
  const apps = await (c as any).listApps();
  assert.equal(apps.length, 2);
  assert.equal(new URL(urls[0]).pathname, "/v1beta1/apps:search");
  assert.equal(new URL(urls[1]).searchParams.get("pageToken"), "next+page");
  assert.doesNotMatch(JSON.stringify(apps), /PRIVATE_TOKEN/);
});
test("provider errors distinguish disabled API from permissions without keeping raw details", async () => {
  const error = await jsonRequest(
    "https://playdeveloperreporting.googleapis.com/v1beta1/apps:search",
    {},
    async () =>
      Response.json(
        {
          error: {
            message: "PRIVATE_MESSAGE",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "SERVICE_DISABLED",
                domain: "googleapis.com",
                metadata: {
                  service: "playdeveloperreporting.googleapis.com",
                  consumer: "PRIVATE_CONSUMER",
                },
              },
            ],
          },
        },
        { status: 403 },
      ),
  ).catch((e) => e);
  assert.equal(error.reason, "SERVICE_DISABLED");
  assert.equal(error.service, "playdeveloperreporting.googleapis.com");
  assert.doesNotMatch(JSON.stringify(error), /PRIVATE/);
});
test("Google app discovery is available through the read-only MCP tool without packageName", async () => {
  const { invoke } = await import("../src/core.js");
  const result = await invoke(
    "google_list_apps",
    { profile: "one" },
    {
      config: {
        profiles: { one: { google: { serviceAccountPath: "/not-used" } } },
      },
      client: {
        listApps: async () => [
          { name: "apps/com.example", displayName: "Example" },
        ],
      },
      writeEnabled: false,
    },
  );
  assert.deepEqual(result, [
    { name: "apps/com.example", displayName: "Example" },
  ]);
});
test("MCP errors retain safe disabled-service diagnostics", async () => {
  const { safeError } = await import("../src/core.js");
  const result = safeError(
    new ApiFailure(
      403,
      undefined,
      "SERVICE_DISABLED",
      "playdeveloperreporting.googleapis.com",
    ),
  );
  assert.equal((result as any).reason, "SERVICE_DISABLED");
  assert.equal(
    (result as any).service,
    "playdeveloperreporting.googleapis.com",
  );
});
