import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invoke, tools } from "../src/core.js";
const config: any = {
  profiles: {
    one: {
      apple: { keyType: "TEAM", keyId: "K", issuerId: "I", p8Path: "/unused" },
    },
  },
};
const call = (name: string, args: any, client: any, cfg = config) =>
  invoke(
    name,
    { profile: "one", confirm: true, ...args },
    { config: cfg, client, writeEnabled: true },
  );
test("provisioning rejects individual keys and disabled writes before API calls", async () => {
  let calls = 0;
  const client = {
    request: async () => {
      calls++;
      return {};
    },
  };
  const args = {
    identifier: "com.example.app",
    name: "Example",
    platform: "IOS",
  };
  const individual = structuredClone(config);
  individual.profiles.one.apple.keyType = "INDIVIDUAL";
  assert.match(
    JSON.stringify(
      await call("apple_create_bundle_id", args, client, individual),
    ),
    /Team API key/,
  );
  assert.match(
    JSON.stringify(
      await invoke(
        "apple_create_bundle_id",
        { profile: "one", confirm: true, ...args },
        { config, client, writeEnabled: false },
      ),
    ),
    /Writes disabled/,
  );
  assert.equal(calls, 0);
});
test("bundle, capability and profile requests follow Apple contracts", async () => {
  const calls: any[] = [];
  const client = {
    request: async (...a: any[]) => {
      calls.push(a);
      return { data: { id: "NEW", attributes: { profileContent: "hidden" } } };
    },
  };
  await call(
    "apple_create_bundle_id",
    { identifier: "com.example.app", name: "Example", platform: "IOS" },
    client,
  );
  assert.deepEqual(calls[0], [
    "/bundleIds",
    {
      method: "POST",
      body: {
        data: {
          type: "bundleIds",
          attributes: {
            identifier: "com.example.app",
            name: "Example",
            platform: "IOS",
          },
        },
      },
    },
  ]);
  await call(
    "apple_enable_capability",
    { bundleId: "B", capabilityType: "PUSH_NOTIFICATIONS" },
    client,
  );
  assert.deepEqual(calls[1][1].body.data.relationships, {
    bundleId: { data: { type: "bundleIds", id: "B" } },
  });
  const result = await call(
    "apple_create_profile",
    {
      name: "Store",
      profileType: "IOS_APP_STORE",
      bundleId: "B",
      certificateIds: ["C"],
    },
    client,
  );
  assert.deepEqual(calls[2][1].body.data.relationships, {
    bundleId: { data: { type: "bundleIds", id: "B" } },
    certificates: { data: [{ type: "certificates", id: "C" }] },
  });
  assert.ok(!JSON.stringify(result).includes("hidden"));
  await call(
    "apple_create_profile",
    {
      name: "Dev",
      profileType: "IOS_APP_DEVELOPMENT",
      bundleId: "B",
      certificateIds: ["C"],
    },
    client,
  );
  assert.equal(calls.length, 3);
  await call(
    "apple_create_profile",
    {
      name: "Dev",
      profileType: "IOS_APP_DEVELOPMENT",
      bundleId: "B",
      certificateIds: ["C"],
      deviceIds: ["D"],
    },
    client,
  );
  assert.deepEqual(calls[3][1].body.data.relationships.devices, {
    data: [{ type: "devices", id: "D" }],
  });
});
test("certificate creation reads a local CSR and rejects private keys", async () => {
  const dir = mkdtempSync(join(tmpdir(), "publisher-csr-"));
  try {
    const path = join(dir, "request.csr");
    let calls = 0;
    const client = {
      request: async (_: string, o: any) => {
        calls++;
        assert.match(
          o.body.data.attributes.csrContent,
          /BEGIN CERTIFICATE REQUEST/,
        );
        return {
          data: { id: "C", attributes: { certificateContent: "hidden" } },
        };
      },
    };
    writeFileSync(
      path,
      "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----",
    );
    assert.ok(
      (
        (await call(
          "apple_create_certificate",
          { csrPath: path, certificateType: "DISTRIBUTION" },
          client,
        )) as any
      ).error,
    );
    assert.equal(calls, 0);
    writeFileSync(
      path,
      "-----BEGIN CERTIFICATE REQUEST-----\nAAAA\n-----END CERTIFICATE REQUEST-----",
    );
    const result = await call(
      "apple_create_certificate",
      { csrPath: path, certificateType: "DISTRIBUTION" },
      client,
    );
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes("hidden"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("downloads are private and do not overwrite files or follow output symlinks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "publisher-download-"));
  try {
    const path = join(dir, "app.mobileprovision");
    const client = {
      request: async () => ({
        data: {
          id: "P",
          attributes: {
            profileContent: Buffer.from("profile-fixture").toString("base64"),
          },
        },
      }),
    };
    const result: any = await call(
      "apple_download_profile",
      { profileId: "P", outputPath: path },
      client,
    );
    assert.equal(result.path, path);
    assert.equal(readFileSync(path, "utf8"), "profile-fixture");
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(result.sha256.length, 64);
    assert.ok(!JSON.stringify(result).includes("profile-fixture"));
    assert.ok(
      (
        (await call(
          "apple_download_profile",
          { profileId: "P", outputPath: path },
          client,
        )) as any
      ).error,
    );
    const link = join(dir, "link");
    symlinkSync(path, link);
    assert.ok(
      (
        (await call(
          "apple_download_profile",
          { profileId: "P", outputPath: link },
          client,
        )) as any
      ).error,
    );
    assert.equal(readFileSync(path, "utf8"), "profile-fixture");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("provisioning reads require Team keys and preserve pagination", async () => {
  for (const name of [
    "apple_list_bundle_ids",
    "apple_list_bundle_id_capabilities",
    "apple_list_certificates",
    "apple_list_profiles",
    "apple_list_devices",
  ])
    assert.equal(
      (tools.find((t) => t.name === name) as any)?.teamRequired,
      true,
    );
  const result = await invoke(
    "apple_list_bundle_ids",
    { profile: "one", identifier: "com.example.app" },
    {
      config,
      client: {
        request: async (path: string, o: any) => {
          assert.equal(path, "/bundleIds");
          assert.equal(o.params["filter[identifier]"], "com.example.app");
          return {
            data: [],
            links: {
              next: "https://api.appstoreconnect.apple.com/v1/bundleIds?cursor=next",
            },
          };
        },
      },
    },
  );
  assert.ok((result as any).links.next);
});
test("capability updates, device registration and certificate downloads use bounded contracts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "publisher-cert-"));
  try {
    const calls: any[] = [];
    const client = {
      request: async (...args: any[]) => {
        calls.push(args);
        return {
          data: {
            attributes: {
              certificateContent: Buffer.from("certificate-fixture").toString(
                "base64",
              ),
            },
          },
        };
      },
    };
    const settings = [
      { key: "ICLOUD_VERSION", options: [{ key: "XCODE_6", enabled: true }] },
    ];
    await call(
      "apple_update_capability",
      { capabilityId: "CAP", settings },
      client,
    );
    assert.deepEqual(calls[0], [
      "/bundleIdCapabilities/CAP",
      {
        method: "PATCH",
        body: {
          data: {
            type: "bundleIdCapabilities",
            id: "CAP",
            attributes: { settings },
          },
        },
      },
    ]);
    await call(
      "apple_register_device",
      {
        name: "Test device",
        platform: "IOS",
        udid: "00008030-0012345678901234",
      },
      client,
    );
    assert.equal(calls[1][0], "/devices");
    assert.equal(
      calls[1][1].body.data.attributes.udid,
      "00008030-0012345678901234",
    );
    const outputPath = join(dir, "distribution.cer");
    await call(
      "apple_download_certificate",
      { certificateId: "C", outputPath },
      client,
    );
    assert.equal(calls[2][0], "/certificates/C");
    assert.equal(readFileSync(outputPath, "utf8"), "certificate-fixture");
    const before = calls.length;
    const bad = await call(
      "apple_create_bundle_id",
      { name: "Invalid", platform: "IOS", identifier: "../apps" },
      client,
    );
    assert.ok((bad as any).error);
    assert.equal(calls.length, before);
    const malformed = await call(
      "apple_download_profile",
      { profileId: "P", outputPath: join(dir, "bad") },
      {
        request: async () => ({
          data: { attributes: { profileContent: "not base64" } },
        }),
      },
    );
    assert.ok((malformed as any).error);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
