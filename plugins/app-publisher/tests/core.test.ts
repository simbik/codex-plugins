import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  statSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, verify } from "node:crypto";
import {
  AppleClient,
  ApiFailure,
  validateRanges,
  fileDigest,
  jsonRequest,
} from "../src/api.js";
import { invoke, publicResult, safeError, tools } from "../src/core.js";
import { loadConfig } from "../src/config.js";
import {
  saveConnection,
  startSetup,
  validateServiceAccount,
} from "../src/setup.js";
const config: any = {
  profiles: {
    one: {
      apple: {
        keyId: "K",
        issuerId: "I",
        p8Path: "/not-used",
        keyType: "TEAM",
      },
      google: { serviceAccountPath: "/not-used" },
    },
  },
};
const tool = (name: string) => {
  const t = tools.find((t) => t.name === name);
  assert.ok(t);
  return t;
};
const temp = () => mkdtempSync(join(tmpdir(), "app-publisher-test-"));
test("tool names are unique and every mutation requires confirmation and write enablement", async () => {
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
  for (const t of tools.filter((t) => t.write))
    assert.ok(
      ((await invoke(t.name, { profile: "one" }, { config })) as any).error,
    );
  let calls = 0;
  const client = {
    request: async () => {
      calls++;
      return {};
    },
  };
  assert.match(
    JSON.stringify(
      await invoke(
        "google_create_edit",
        { profile: "one", packageName: "com.example.app", confirm: true },
        { config, client, writeEnabled: false },
      ),
    ),
    /Writes disabled/,
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    await invoke(
      "google_create_edit",
      { profile: "one", packageName: "com.example.app", confirm: true },
      { config, client, writeEnabled: true },
    ),
    {},
  );
  assert.equal(calls, 1);
});
test("explicit profile prevents silent account fallback and rejects extra arguments", async () => {
  const client = {
    request: async () => {
      throw new Error("should not run");
    },
  };
  assert.match(
    JSON.stringify(
      await invoke(
        "apple_list_apps",
        { profile: "missing" },
        { config, client },
      ),
    ),
    /Unknown profile/,
  );
  assert.match(
    JSON.stringify(
      await invoke(
        "apple_list_apps",
        { profile: "one", secret: "never-print-this" },
        { config, client },
      ),
    ),
    /Invalid arguments/,
  );
  assert.doesNotMatch(
    JSON.stringify(
      await invoke(
        "apple_list_apps",
        { profile: "one", secret: "never-print-this" },
        { config, client },
      ),
    ),
    /never-print-this/,
  );
});
test("provider errors expose status and recovery IDs but never raw messages", () => {
  const e: any = new Error("Authorization: secret-value");
  e.response = { status: 403, data: { token: "secret-value" } };
  assert.equal(safeError(e).status, 403);
  assert.doesNotMatch(JSON.stringify(safeError(e)), /secret-value/);
  assert.deepEqual(
    safeError(new ApiFailure(503, { buildUploadId: "u1" })).recovery,
    { buildUploadId: "u1" },
  );
});
test("redacts secrets and presigned URLs recursively", () => {
  const value = publicResult({
    data: [
      {
        password: "secret",
        requestHeaders: [1],
        url: "https://example.com/a?X-Amz-Signature=secret",
        name: "App",
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(value), /secret/);
  assert.match(JSON.stringify(value), /App/);
});
test("Apple JWT uses ES256 P-256 signature and correct individual claims", async () => {
  const dir = temp();
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const path = join(dir, "key.p8");
    writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }));
    let token = "";
    const client = new AppleClient(
      { keyId: "KEY", keyType: "INDIVIDUAL", p8Path: path },
      async (url, init) => {
        assert.equal(init?.redirect, "error");
        token = String((init?.headers as any).Authorization).slice(7);
        return Response.json({ data: [] });
      },
    );
    await client.request("/apps");
    const [header, payload, sig] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    assert.equal(claims.sub, "user");
    assert.equal(claims.iss, undefined);
    assert.equal(claims.exp - claims.iat, 600);
    assert.equal(
      JSON.parse(Buffer.from(header, "base64url").toString()).alg,
      "ES256",
    );
    assert.ok(
      verify(
        "sha256",
        Buffer.from(header + "." + payload),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(sig, "base64url"),
      ),
    );
    await assert.rejects(() =>
      client.request("https://attacker.invalid/v1/apps"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("HTTP mutation errors are not automatically retried", async () => {
  let n = 0;
  await assert.rejects(
    () =>
      jsonRequest("https://example.test", { method: "POST" }, async () => {
        n++;
        return new Response("secret", { status: 503 });
      }),
    ApiFailure,
  );
  assert.equal(n, 1);
});
test("range validation refuses gaps, overlaps and unsafe destinations", () => {
  const r = {
    url: "https://uploads.apple.com/a",
    method: "PUT",
    offset: 0,
    length: 4,
  };
  validateRanges([r], 4);
  for (const bad of [
    [{ ...r, offset: 1 }],
    [r, r],
    [{ ...r, url: "http://example.test/a" }],
    [{ ...r, length: -1 }],
    [{ ...r, method: "GET" }],
  ])
    assert.throws(() => validateRanges(bad, 4));
});
test("Apple upload sends only prescribed headers and exact bytes", async () => {
  const dir = temp();
  try {
    const path = join(dir, "bytes");
    writeFileSync(path, "abcdefgh");
    const got: any[] = [];
    const client = new AppleClient(
      { keyId: "K", p8Path: "/unused" },
      async (url, init) => {
        let text = "";
        for await (const chunk of init!.body as any) text += chunk;
        got.push({ text, headers: init!.headers });
        return new Response(null, { status: 204 });
      },
    );
    await client.uploadRanges(
      [
        {
          url: "https://upload.apple.com/1",
          method: "PUT",
          offset: 0,
          length: 3,
        },
        {
          url: "https://upload.apple.com/2",
          method: "PUT",
          offset: 3,
          length: 5,
        },
      ],
      path,
    );
    assert.deepEqual(
      got.map((x) => x.text),
      ["abc", "defgh"],
    );
    assert.ok(got.every((x) => !x.headers.Authorization));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Google commit validates first and refuses to cancel existing review", async () => {
  const calls: any[] = [];
  await tool("google_commit_edit").handler(
    {
      request: async (...a: any[]) => {
        calls.push(a);
        return {};
      },
    },
    {
      packageName: "com.example.app",
      editId: "e1",
      changesNotSentForReview: true,
    },
  );
  assert.match(calls[0][0], /:validate$/);
  assert.match(calls[1][0], /:commit$/);
  assert.equal(
    calls[1][1].params.changesInReviewBehavior,
    "ERROR_IF_IN_REVIEW",
  );
});
test("failed Google validation prevents commit", async () => {
  let n = 0;
  await assert.rejects(() =>
    tool("google_commit_edit").handler(
      {
        request: async () => {
          n++;
          throw new ApiFailure(400);
        },
      },
      { packageName: "com.example.app", editId: "e1" },
    ),
  );
  assert.equal(n, 1);
});
test("track replacement preserves explicitly provided releases and validates rollout", async () => {
  let body: any;
  const client = {
    request: async (_: any, o: any) => {
      body = o.body;
    },
  };
  const args = {
    packageName: "com.example.app",
    editId: "e1",
    track: "internal",
    releases: [
      { versionCodes: ["1"], status: "completed" },
      { versionCodes: ["2"], status: "draft" },
    ],
  };
  await tool("google_update_track").handler(client, args);
  assert.deepEqual(body.releases, args.releases);
  assert.throws(() =>
    tool("google_update_track").handler(client, {
      ...args,
      releases: [{ versionCodes: ["2"], status: "inProgress" }],
    }),
  );
});
test("Apple upload checks hash before network and retains ID on failed upload", async () => {
  const dir = temp();
  try {
    const path = join(dir, "build.ipa");
    writeFileSync(path, "fake-signed-build");
    const hash = await fileDigest(path, "sha256");
    let calls = 0;
    const client: any = {
      request: async () => {
        calls++;
        return {
          data: {
            id: calls === 1 ? "upload1" : "file1",
            attributes: { uploadOperations: [] },
          },
        };
      },
      uploadRanges: async () => {
        throw new ApiFailure(503);
      },
    };
    const args = {
      appId: "app1",
      filePath: path,
      versionString: "1.0",
      buildNumber: "1",
      platform: "IOS",
      expectedSha256: "0".repeat(64),
    };
    await assert.rejects(() =>
      tool("apple_upload_build").handler(client, args),
    );
    assert.equal(calls, 0);
    await assert.rejects(
      () =>
        tool("apple_upload_build").handler(client, {
          ...args,
          expectedSha256: hash,
        }),
      (e: any) =>
        e.recovery.buildUploadId === "upload1" &&
        e.recovery.buildUploadFileId === "file1",
    );
    assert.equal(calls, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Apple build reservation and checksum commit match API payload", async () => {
  const dir = temp();
  try {
    const path = join(dir, "build.ipa");
    writeFileSync(path, "build");
    const hash = await fileDigest(path, "sha256");
    const calls: any[] = [];
    const c = {
      request: async (p: string, o: any) => {
        calls.push([p, o]);
        return {
          data: {
            id: calls.length === 1 ? "u1" : "f1",
            attributes: { uploadOperations: [1] },
          },
        };
      },
      uploadRanges: async () => {},
    };
    const r = await tool("apple_upload_build").handler(c, {
      appId: "app1",
      filePath: path,
      versionString: "1.0",
      buildNumber: "4",
      platform: "IOS",
      expectedSha256: hash,
    });
    assert.equal(calls[0][1].body.data.attributes.cfBundleVersion, "4");
    assert.equal(
      calls[2][1].body.data.attributes.sourceFileChecksums.file.hash,
      hash,
    );
    assert.equal(r.processing, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Apple release requires pending developer release state", async () => {
  let n = 0;
  await assert.rejects(() =>
    tool("apple_release_version").handler(
      {
        request: async () => {
          n++;
          return {
            data: { attributes: { appStoreState: "WAITING_FOR_REVIEW" } },
          };
        },
      },
      { versionId: "v1" },
    ),
  );
  assert.equal(n, 1);
});
test("local profile saves use private permissions and preserve other accounts", () => {
  const dir = temp();
  try {
    const path = join(dir, "config.json");
    const k = saveConnection(
      "one",
      "apple",
      "fixture",
      { keyId: "K", issuerId: "I", keyType: "TEAM" },
      false,
      path,
    );
    saveConnection("two", "google", "{}", {}, false, path);
    assert.deepEqual(Object.keys(loadConfig(path).profiles), ["one", "two"]);
    assert.equal(statSync(k).mode & 0o777, 0o600);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.throws(() =>
      saveConnection(
        "one",
        "apple",
        "fixture",
        { keyId: "K", issuerId: "I", keyType: "TEAM" },
        false,
        path,
      ),
    );
    assert.throws(() =>
      saveConnection("../escape", "google", "{}", {}, false, path),
    );
    chmodSync(path, 0o644);
    assert.throws(() => loadConfig(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("service account import does not accept attacker-controlled token endpoints", () => {
  const key = {
    type: "service_account",
    client_email: "a@b.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----",
    token_uri: "https://oauth2.googleapis.com/token",
  };
  assert.equal(validateServiceAccount(key).token_uri, key.token_uri);
  assert.throws(() =>
    validateServiceAccount({ ...key, token_uri: "https://attacker.test" }),
  );
});
test("setup binds loopback and rejects CSRF, invalid callbacks and unauthenticated reads", async () => {
  const { server, url } = await startSetup(false);
  try {
    const u = new URL(url);
    const html = await fetch(url);
    assert.equal(html.status, 200);
    assert.match(
      html.headers.get("content-security-policy")!,
      /frame-ancestors 'none'/,
    );
    assert.equal((await fetch(u.origin)).status, 403);
    assert.equal(
      (await fetch(u.origin + "/connect/apple", { method: "POST", body: "{}" }))
        .status,
      403,
    );
    assert.equal(
      (
        await fetch(u.origin + "/connect/apple", {
          method: "POST",
          headers: {
            origin: "https://evil.test",
            "x-setup-token": u.searchParams.get("token")!,
          },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(u.origin + "/oauth/callback?state=bad&code=bad")).status,
      403,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("Google REST requests encode params and never retry media uploads", async () => {
  const { GoogleClient } = await import("../src/api.js");
  const dir = temp();
  try {
    const file = join(dir, "bundle.aab");
    writeFileSync(file, "bundle");
    const seen: any[] = [];
    const c = new GoogleClient(
      {
        clientId: "example",
        clientSecret: "synthetic-secret",
        refreshToken: "synthetic-token",
      },
      async (url, init) => {
        seen.push({ url: String(url), init });
        if (String(url).includes("/upload/")) {
          for await (const chunk of init!.body as any) {
          }
          return new Response(null, { status: 503 });
        }
        return Response.json({ id: "e1" });
      },
    );
    (c as any).auth = {
      getAccessToken: async () => ({ token: "synthetic-access" }),
    };
    await c.request("/applications/com.example.app/edits/e1:commit", {
      method: "POST",
      params: { changesInReviewBehavior: "ERROR_IF_IN_REVIEW" },
    });
    assert.match(seen[0].url, /changesInReviewBehavior=ERROR_IF_IN_REVIEW/);
    assert.equal(seen[0].init.redirect, "error");
    await assert.rejects(
      () =>
        c.upload(
          "/applications/com.example.app/edits/e1/bundles",
          file,
          "application/octet-stream",
        ),
      ApiFailure,
    );
    assert.equal(seen.length, 2);
    assert.match(seen[1].url, /uploadType=media/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("setup rejects Desktop OAuth files with service-account guidance", async () => {
  const { server, url } = await startSetup(false);
  const u = new URL(url);
  try {
    const r = await fetch(u.origin + "/connect/google", {
      method: "POST",
      headers: {
        origin: u.origin,
        "x-setup-token": u.searchParams.get("token")!,
      },
      body: JSON.stringify({
        profile: "synthetic_unconfigured",
        key: JSON.stringify({
          installed: {
            client_id: "synthetic.apps.googleusercontent.com",
            client_secret: "PRIVATE_SECRET",
          },
        }),
      }),
    });
    const result = await r.json();
    assert.equal(r.status, 400);
    assert.match(result.error, /service account/);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("confirmation is mandatory even when writes are enabled", async () => {
  let calls = 0;
  const result = await invoke(
    "google_create_edit",
    { packageName: "com.example.app", profile: "one" },
    {
      writeEnabled: true,
      config,
      client: {
        request: async () => {
          calls++;
        },
      },
    },
  );
  assert.equal(calls, 0);
  assert.match(JSON.stringify(result), /Invalid arguments/);
});
