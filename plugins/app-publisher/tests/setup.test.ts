import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { startSetup, saveConnection } from "../src/setup.js";
import { AppleClient, ApiFailure, GoogleClient } from "../src/api.js";

test("setup stays available while the user spends more than 15 minutes creating keys", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { server } = await startSetup(false);
  try {
    t.mock.timers.tick(16 * 60_000);
    assert.equal(server.listening, true);
  } finally {
    t.mock.timers.reset();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("setup explains saved-key failures and replacement without exposing provider secrets", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "publisher-setup-"));
  const path = join(dir, "config.json");
  const previous = process.env.APP_PUBLISHER_CONFIG;
  process.env.APP_PUBLISHER_CONFIG = path;
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  saveConnection(
    "default",
    "apple",
    key,
    { keyId: "SYNTHETIC", keyType: "INDIVIDUAL" },
    false,
    path,
  );
  const before = readFileSync(path, "utf8");
  const { server, url } = await startSetup(false);
  const u = new URL(url);
  const post = async (route: string, data: any) => {
    const r = await fetch(u.origin + route, {
      method: "POST",
      headers: {
        origin: u.origin,
        "x-setup-token": u.searchParams.get("token")!,
      },
      body: JSON.stringify({ profile: "default", ...data }),
    });
    return { status: r.status, ...(await r.json()) };
  };
  try {
    const duplicate = await post("/connect/apple", {
      key,
      keyId: "NEW",
      keyType: "INDIVIDUAL",
    });
    assert.match(duplicate.error, /Replace connection/);
    assert.equal(readFileSync(path, "utf8"), before);
    const appleRequest = t.mock.method(
      AppleClient.prototype,
      "request",
      async () => {
        throw new ApiFailure(401);
      },
    );
    const rejected = await post("/check", { platform: "apple" });
    assert.match(rejected.error, /401/);
    assert.match(rejected.error, /Team|Individual/);
    appleRequest.mock.mockImplementation(async () => {
      throw new Error("SECRET_PROVIDER_BODY");
    });
    assert.doesNotMatch(
      JSON.stringify(await post("/check", { platform: "apple" })),
      /SECRET_PROVIDER_BODY/,
    );
    const missing = await post("/check", { platform: "google" });
    assert.match(missing.error, /Save|Connect/);
    saveConnection(
      "default",
      "google",
      JSON.stringify({
        type: "service_account",
        client_email: "test@project.iam.gserviceaccount.com",
        private_key: "synthetic",
        token_uri: "https://oauth2.googleapis.com/token",
      }),
      {},
      false,
      path,
    );
    t.mock.method(
      GoogleClient.prototype,
      "verifyAuthentication",
      async () => {},
    );
    const googleApps = t.mock.method(
      GoogleClient.prototype,
      "listApps",
      async () => {
        throw new ApiFailure(403);
      },
    );
    const app = await post("/check", { platform: "google" });
    assert.match(app.error, /403/);
    assert.match(app.error, /Play Console/);
    googleApps.mock.mockImplementation(async () => [
      { name: "apps/com.example", displayName: "Example" },
    ]);
    const google = await post("/check", { platform: "google" });
    assert.equal(google.status, 200);
    assert.equal(google.apps[0].name, "apps/com.example");
    const close = await post("/close", {});
    assert.equal(close.status, 200);
    assert.equal(server.listening, false);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    if (previous === undefined) delete process.env.APP_PUBLISHER_CONFIG;
    else process.env.APP_PUBLISHER_CONFIG = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Google authentication can be checked without a package or reviews permission", async () => {
  const client = new GoogleClient({
    clientId: "synthetic",
    clientSecret: "synthetic",
    refreshToken: "synthetic",
  });
  (client as any).auth = {
    getAccessToken: async () => ({ token: "NEVER_RETURN_TOKEN" }),
  };
  assert.equal(await (client as any).verifyAuthentication(), undefined);
  (client as any).auth = { getAccessToken: async () => ({ token: null }) };
  await assert.rejects(() => (client as any).verifyAuthentication());
});
