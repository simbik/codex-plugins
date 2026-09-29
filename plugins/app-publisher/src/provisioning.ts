import { z } from "zod";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import type { Tool } from "./tools.js";
// Enum values from Apple's public OpenAPI 4.5 specification.
const capabilityType = z.enum([
  "ICLOUD",
  "IN_APP_PURCHASE",
  "GAME_CENTER",
  "PUSH_NOTIFICATIONS",
  "WALLET",
  "INTER_APP_AUDIO",
  "MAPS",
  "ASSOCIATED_DOMAINS",
  "PERSONAL_VPN",
  "APP_GROUPS",
  "HEALTHKIT",
  "HOMEKIT",
  "WIRELESS_ACCESSORY_CONFIGURATION",
  "APPLE_PAY",
  "DATA_PROTECTION",
  "SIRIKIT",
  "NETWORK_EXTENSIONS",
  "MULTIPATH",
  "HOT_SPOT",
  "NFC_TAG_READING",
  "CLASSKIT",
  "AUTOFILL_CREDENTIAL_PROVIDER",
  "ACCESS_WIFI_INFORMATION",
  "NETWORK_CUSTOM_PROTOCOL",
  "COREMEDIA_HLS_LOW_LATENCY",
  "SYSTEM_EXTENSION_INSTALL",
  "USER_MANAGEMENT",
  "APPLE_ID_AUTH",
] as const);
const profileType = z.enum([
  "IOS_APP_DEVELOPMENT",
  "IOS_APP_STORE",
  "IOS_APP_ADHOC",
  "IOS_APP_INHOUSE",
  "MAC_APP_DEVELOPMENT",
  "MAC_APP_STORE",
  "MAC_APP_DIRECT",
  "TVOS_APP_DEVELOPMENT",
  "TVOS_APP_STORE",
  "TVOS_APP_ADHOC",
  "TVOS_APP_INHOUSE",
  "MAC_CATALYST_APP_DEVELOPMENT",
  "MAC_CATALYST_APP_STORE",
  "MAC_CATALYST_APP_DIRECT",
] as const);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const name = z.string().trim().min(1).max(200);
const path = z.string().refine(isAbsolute, "Absolute path required");
const platform = z.enum(["IOS", "MAC_OS", "UNIVERSAL"]);
const identifier = z
  .string()
  .regex(/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/)
  .max(255);
const settings = z
  .array(
    z
      .object({
        key: z.enum([
          "ICLOUD_VERSION",
          "DATA_PROTECTION_PERMISSION_LEVEL",
          "APPLE_ID_AUTH_APP_CONSENT",
        ]),
        options: z
          .array(
            z
              .object({
                key: z.enum([
                  "XCODE_5",
                  "XCODE_6",
                  "COMPLETE_PROTECTION",
                  "PROTECTED_UNLESS_OPEN",
                  "PROTECTED_UNTIL_FIRST_USER_AUTH",
                  "PRIMARY_APP_CONSENT",
                ]),
                enabled: z.boolean(),
              })
              .strict(),
          )
          .min(1)
          .max(10),
      })
      .strict(),
  )
  .min(1)
  .max(10);
const certificateType = z.enum([
  "DEVELOPMENT",
  "DISTRIBUTION",
  "IOS_DEVELOPMENT",
  "IOS_DISTRIBUTION",
  "MAC_APP_DEVELOPMENT",
  "MAC_APP_DISTRIBUTION",
  "MAC_INSTALLER_DISTRIBUTION",
  "DEVELOPER_ID_APPLICATION",
  "DEVELOPER_ID_APPLICATION_G2",
]);
export const provisioningTools: Tool[] = [];
const add = (
  name: string,
  description: string,
  write: boolean,
  shape: z.ZodRawShape,
  handler: Tool["handler"],
) =>
  provisioningTools.push({
    name,
    description:
      description + " Requires a Team API key with provisioning access.",
    write,
    teamRequired: true,
    schema: z.object(shape).strict(),
    handler,
  });
const rel = (type: string, id: string) => ({ data: { type, id } });
const many = (type: string, ids: string[]) => ({
  data: ids.map((id) => ({ type, id })),
});
const create = (c: any, type: string, attributes: any, relationships?: any) =>
  c.request("/" + type, {
    method: "POST",
    body: {
      data: { type, attributes, ...(relationships ? { relationships } : {}) },
    },
  });
add(
  "apple_list_bundle_ids",
  "Find existing bundle IDs before registering one. Follow links.next.",
  false,
  { identifier: identifier.optional() },
  (c, a) =>
    c.request("/bundleIds", {
      params: {
        limit: "200",
        ...(a.identifier ? { "filter[identifier]": a.identifier } : {}),
      },
    }),
);
add(
  "apple_get_bundle_id",
  "Read a registered bundle ID.",
  false,
  { bundleId: id },
  (c, a) => c.request("/bundleIds/" + a.bundleId),
);
add(
  "apple_create_bundle_id",
  "Register an explicit bundle ID. This does not create an App Store Connect app record.",
  true,
  { identifier, name, platform },
  (c, a) => create(c, "bundleIds", a),
);
add(
  "apple_list_bundle_id_capabilities",
  "Read enabled capabilities before changing them. Follow links.next.",
  false,
  { bundleId: id },
  (c, a) =>
    c.request("/bundleIds/" + a.bundleId + "/bundleIdCapabilities", {
      params: { limit: "200" },
    }),
);
add(
  "apple_enable_capability",
  "Enable a capability on an existing bundle ID. Some capabilities need additional Apple approval or resource configuration.",
  true,
  { bundleId: id, capabilityType, settings: settings.optional() },
  (c, { bundleId, ...attributes }) =>
    create(c, "bundleIdCapabilities", attributes, {
      bundleId: rel("bundleIds", bundleId),
    }),
);
add(
  "apple_update_capability",
  "Update settings of an existing bundle capability; read and preserve required settings first.",
  true,
  { capabilityId: id, settings },
  (c, { capabilityId, ...attributes }) =>
    c.request("/bundleIdCapabilities/" + capabilityId, {
      method: "PATCH",
      body: {
        data: { type: "bundleIdCapabilities", id: capabilityId, attributes },
      },
    }),
);
add(
  "apple_list_certificates",
  "List certificates for reuse; content is omitted. Follow links.next.",
  false,
  {},
  (c) =>
    c.request("/certificates", {
      params: {
        limit: "200",
        "fields[certificates]":
          "name,certificateType,displayName,serialNumber,platform,expirationDate",
      },
    }),
);
add(
  "apple_create_certificate",
  "Create a signing certificate from a local PEM CSR. Private signing keys remain local. Returns certificate ID; use apple_download_certificate to save it.",
  true,
  { certificateType, csrPath: path },
  (c, a) => {
    const stat = statSync(a.csrPath);
    if (!stat.isFile() || stat.size > 65536)
      throw new Error("Expected a small CSR file");
    const csrContent = readFileSync(a.csrPath, "utf8").trim();
    if (
      !/^-----BEGIN CERTIFICATE REQUEST-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE REQUEST-----$/.test(
        csrContent,
      )
    )
      throw new Error("Expected a PEM CSR, never a private key");
    return create(c, "certificates", {
      certificateType: a.certificateType,
      csrContent,
    });
  },
);
add(
  "apple_list_devices",
  "List registered testing devices. Follow links.next.",
  false,
  {},
  (c) => c.request("/devices", { params: { limit: "200" } }),
);
add(
  "apple_register_device",
  "Register an authorized test device. Apple device quotas apply; registration is not automatically reversible.",
  true,
  {
    name,
    platform: z.enum(["IOS", "MAC_OS"]),
    udid: z.string().regex(/^[A-Fa-f0-9-]{16,64}$/),
  },
  (c, a) => create(c, "devices", a),
);
add(
  "apple_list_profiles",
  "List provisioning profiles for reuse; content is omitted. Follow links.next.",
  false,
  {},
  (c) =>
    c.request("/profiles", {
      params: {
        limit: "200",
        "fields[profiles]":
          "name,platform,profileType,profileState,uuid,createdDate,expirationDate",
      },
    }),
);
add(
  "apple_create_profile",
  "Create a provisioning profile from an existing bundle ID and certificates. Development and Ad Hoc profiles require device IDs. Returns ID; download separately.",
  true,
  {
    name,
    profileType,
    bundleId: id,
    certificateIds: z.array(id).min(1).max(100),
    deviceIds: z.array(id).min(1).max(1000).optional(),
  },
  (c, a) => {
    const needsDevices = /DEVELOPMENT|ADHOC/.test(a.profileType);
    if (needsDevices && !a.deviceIds?.length)
      return Promise.resolve({
        error:
          "Development and Ad Hoc profiles require deviceIds. Use apple_list_devices or apple_register_device first.",
      });
    if (!needsDevices && a.deviceIds)
      return Promise.resolve({
        error: "This profile type does not accept deviceIds.",
      });
    return create(
      c,
      "profiles",
      { name: a.name, profileType: a.profileType },
      {
        bundleId: rel("bundleIds", a.bundleId),
        certificates: many("certificates", a.certificateIds),
        ...(a.deviceIds ? { devices: many("devices", a.deviceIds) } : {}),
      },
    );
  },
);
for (const kind of ["certificate", "profile"] as const) {
  const resource = kind === "certificate" ? "certificates" : "profiles";
  add(
    "apple_download_" + kind,
    "Download an existing " +
      kind +
      " to a new absolute local file with private permissions. Never overwrites files. Returns only path, size and SHA-256.",
    true,
    { [kind + "Id"]: id, outputPath: path },
    async (c, a) => {
      const result = await c.request("/" + resource + "/" + a[kind + "Id"]);
      const content = result?.data?.attributes?.[kind + "Content"];
      if (
        typeof content !== "string" ||
        !content.length ||
        content.length > 16 * 1024 * 1024 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          content,
        )
      )
        throw new Error("Invalid file response");
      const bytes = Buffer.from(content, "base64");
      writeFileSync(a.outputPath, bytes, { flag: "wx", mode: 0o600 });
      return {
        id: a[kind + "Id"],
        path: a.outputPath,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    },
  );
}
