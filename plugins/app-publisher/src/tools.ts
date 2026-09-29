import { z } from "zod";
import { statSync } from "node:fs";
import { basename, extname, isAbsolute } from "node:path";
import { AppleClient, GoogleClient, ApiFailure, fileDigest } from "./api.js";
export interface Tool {
  name: string;
  description: string;
  write: boolean;
  schema: z.AnyZodObject;
  handler: (client: any, args: any) => Promise<any>;
}
export const tools: Tool[] = [];
const id = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .min(1)
  .max(200);
const locale = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);
const file = z.string().refine(isAbsolute, "Absolute file path required");
const packageName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/);
const add = (
  name: string,
  description: string,
  write: boolean,
  shape: z.ZodRawShape,
  handler: Tool["handler"],
) =>
  tools.push({
    name,
    description,
    write,
    schema: z.object(shape).strict(),
    handler,
  });
const rel = (type: string, id: string) => ({ data: { type, id } });
const doc = (
  type: string,
  attributes: unknown,
  relationships?: unknown,
  id?: string,
) => ({
  data: {
    type,
    ...(id ? { id } : {}),
    attributes,
    ...(relationships ? { relationships } : {}),
  },
});
const patch = (c: AppleClient, type: string, id: string, attributes: unknown) =>
  c.request("/" + type + "/" + id, {
    method: "PATCH",
    body: doc(type, attributes, undefined, id),
  });
const readApple = (
  name: string,
  description: string,
  shape: z.ZodRawShape,
  path: (a: any) => string,
  params?: (a: any) => Record<string, string>,
) =>
  add(name, description, false, shape, (c, a) =>
    c.request(path(a), { params: params?.(a) }),
  );
readApple(
  "apple_list_apps",
  "List accessible Apple apps; follow links.next for further pages.",
  {},
  () => "/apps",
  () => ({ limit: "200" }),
);
readApple(
  "apple_get_app",
  "Read an Apple app.",
  { appId: id },
  (a) => "/apps/" + a.appId,
);
readApple(
  "apple_get_next_page",
  "Read the next page from an Apple response; official API origin only.",
  { url: z.string().url() },
  (a) => a.url,
);
readApple(
  "apple_list_versions",
  "List App Store versions and review states.",
  { appId: id },
  (a) => "/apps/" + a.appId + "/appStoreVersions",
);
readApple(
  "apple_list_builds",
  "List imported builds.",
  { appId: id },
  () => "/builds",
  (a) => ({ "filter[app]": a.appId, limit: "200" }),
);
readApple(
  "apple_list_localizations",
  "Read version descriptions and release notes.",
  { versionId: id },
  (a) => "/appStoreVersions/" + a.versionId + "/appStoreVersionLocalizations",
);
readApple(
  "apple_list_screenshot_sets",
  "Read screenshot sets for a version localization.",
  { localizationId: id },
  (a) =>
    "/appStoreVersionLocalizations/" + a.localizationId + "/appScreenshotSets",
);
readApple(
  "apple_get_screenshot",
  "Check screenshot delivery state.",
  { screenshotId: id },
  (a) => "/appScreenshots/" + a.screenshotId,
);
readApple(
  "apple_get_build_upload",
  "Check build upload processing; COMPLETE is not a public release.",
  { buildUploadId: id },
  (a) => "/buildUploads/" + a.buildUploadId,
);
readApple(
  "apple_list_beta_groups",
  "List TestFlight groups for an app.",
  { appId: id },
  (a) => "/apps/" + a.appId + "/betaGroups",
);
add(
  "apple_create_version",
  "Create a version with MANUAL release mode.",
  true,
  {
    appId: id,
    versionString: z.string().regex(/^\d+(\.\d+){0,2}$/),
    platform: z.enum(["IOS", "MAC_OS", "TV_OS", "VISION_OS"]).default("IOS"),
  },
  (c, a) =>
    c.request("/appStoreVersions", {
      method: "POST",
      body: doc(
        "appStoreVersions",
        {
          versionString: a.versionString,
          platform: a.platform,
          releaseType: "MANUAL",
        },
        { app: rel("apps", a.appId) },
      ),
    }),
);
const localFields = {
  description: z.string().max(4000).optional(),
  keywords: z.string().max(100).optional(),
  whatsNew: z.string().max(4000).optional(),
  promotionalText: z.string().max(170).optional(),
  supportUrl: z.string().url().optional(),
  marketingUrl: z.string().url().optional(),
};
add(
  "apple_create_localization",
  "Add a localized version description.",
  true,
  { versionId: id, locale, ...localFields },
  (c, { versionId, ...a }) =>
    c.request("/appStoreVersionLocalizations", {
      method: "POST",
      body: doc("appStoreVersionLocalizations", a, {
        appStoreVersion: rel("appStoreVersions", versionId),
      }),
    }),
);
add(
  "apple_update_localization",
  "Update selected fields in a version localization.",
  true,
  { localizationId: id, ...localFields },
  (c, { localizationId, ...a }) =>
    patch(c, "appStoreVersionLocalizations", localizationId, a),
);
add(
  "apple_create_screenshot_set",
  "Create a device-size screenshot set. Supply an Apple screenshotDisplayType enum.",
  true,
  {
    localizationId: id,
    screenshotDisplayType: z.string().regex(/^[A-Z0-9_]+$/),
  },
  (c, a) =>
    c.request("/appScreenshotSets", {
      method: "POST",
      body: doc(
        "appScreenshotSets",
        { screenshotDisplayType: a.screenshotDisplayType },
        {
          appStoreVersionLocalization: rel(
            "appStoreVersionLocalizations",
            a.localizationId,
          ),
        },
      ),
    }),
);
function checkedFile(path: string, extensions: string[]) {
  const s = statSync(path);
  if (
    !s.isFile() ||
    !s.size ||
    !extensions.includes(extname(path).toLowerCase())
  )
    throw new Error("Invalid artifact");
  return s.size;
}
function recovery(error: unknown, ids: Record<string, string>): never {
  throw new ApiFailure(
    error instanceof ApiFailure ? error.status : undefined,
    ids,
  );
}
add(
  "apple_upload_screenshot",
  "Upload a PNG/JPEG and commit its checksum. Check delivery state afterwards; failures retain reservation IDs.",
  true,
  { screenshotSetId: id, filePath: file },
  async (c: AppleClient, a) => {
    const fileSize = checkedFile(a.filePath, [".png", ".jpg", ".jpeg"]);
    const checksum = await fileDigest(a.filePath, "md5");
    const reserved = await c.request("/appScreenshots", {
      method: "POST",
      body: doc(
        "appScreenshots",
        { fileName: basename(a.filePath), fileSize },
        { appScreenshotSet: rel("appScreenshotSets", a.screenshotSetId) },
      ),
    });
    const screenshotId = id.parse(reserved.data?.id);
    try {
      await c.uploadRanges(
        reserved.data.attributes.uploadOperations,
        a.filePath,
      );
      await patch(c, "appScreenshots", screenshotId, {
        uploaded: true,
        sourceFileChecksum: checksum,
      });
      return { screenshotId, processing: true };
    } catch (e) {
      recovery(e, { screenshotId });
    }
  },
);
add(
  "apple_upload_build",
  "Upload an already signed IPA; return reservation IDs for processing checks. Does not submit for review.",
  true,
  {
    appId: id,
    filePath: file,
    versionString: z.string().min(1),
    buildNumber: z.string().min(1),
    platform: z.enum(["IOS", "TV_OS", "VISION_OS"]).default("IOS"),
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  },
  async (c: AppleClient, a) => {
    const fileSize = checkedFile(a.filePath, [".ipa"]);
    const hash = await fileDigest(a.filePath, "sha256");
    if (hash !== a.expectedSha256) throw new Error("Artifact hash mismatch");
    const reserved = await c.request("/buildUploads", {
      method: "POST",
      body: doc(
        "buildUploads",
        {
          cfBundleShortVersionString: a.versionString,
          cfBundleVersion: a.buildNumber,
          platform: a.platform,
        },
        { app: rel("apps", a.appId) },
      ),
    });
    const buildUploadId = id.parse(reserved.data?.id);
    let buildUploadFileId: string | undefined;
    try {
      const uploaded = await c.request("/buildUploadFiles", {
        method: "POST",
        body: doc(
          "buildUploadFiles",
          {
            assetType: "ASSET",
            fileName: basename(a.filePath),
            fileSize,
            uti: "com.apple.ipa",
          },
          { buildUpload: rel("buildUploads", buildUploadId) },
        ),
      });
      buildUploadFileId = id.parse(uploaded.data?.id);
      await c.uploadRanges(
        uploaded.data.attributes.uploadOperations,
        a.filePath,
      );
      await patch(c, "buildUploadFiles", buildUploadFileId, {
        uploaded: true,
        sourceFileChecksums: { file: { hash, algorithm: "SHA_256" } },
      });
      return {
        buildUploadId,
        buildUploadFileId,
        sha256: hash,
        processing: true,
      };
    } catch (e) {
      recovery(e, {
        buildUploadId,
        ...(buildUploadFileId ? { buildUploadFileId } : {}),
      });
    }
  },
);
add(
  "apple_assign_build",
  "Attach an imported build to an App Store version.",
  true,
  { versionId: id, buildId: id },
  (c, a) =>
    c.request("/appStoreVersions/" + a.versionId + "/relationships/build", {
      method: "PATCH",
      body: rel("builds", a.buildId),
    }),
);
add(
  "apple_set_build_encryption",
  "Set the user-provided non-exempt encryption answer; supporting declarations may still be needed.",
  true,
  { buildId: id, usesNonExemptEncryption: z.boolean() },
  (c, a) =>
    patch(c, "builds", a.buildId, {
      usesNonExemptEncryption: a.usesNonExemptEncryption,
    }),
);
add(
  "apple_add_build_to_beta_group",
  "Add an imported build to an existing TestFlight group; external testing may require Beta App Review.",
  true,
  { groupId: id, buildId: id },
  (c, a) =>
    c.request("/betaGroups/" + a.groupId + "/relationships/builds", {
      method: "POST",
      body: { data: [{ type: "builds", id: a.buildId }] },
    }),
);
// Review submission is intentionally staged: each state-changing step has a distinct tool.
readApple(
  "apple_get_review_submission",
  "Inspect a review submission before acting.",
  { submissionId: id },
  (a) => "/reviewSubmissions/" + a.submissionId,
);
add(
  "apple_create_review_submission",
  "Create a draft review submission for a specific app/platform.",
  true,
  {
    appId: id,
    platform: z.enum(["IOS", "MAC_OS", "TV_OS", "VISION_OS"]).default("IOS"),
  },
  (c, a) =>
    c.request("/reviewSubmissions", {
      method: "POST",
      body: doc(
        "reviewSubmissions",
        { platform: a.platform },
        { app: rel("apps", a.appId) },
      ),
    }),
);
add(
  "apple_attach_review_version",
  "Attach a version to a draft review submission; verify both belong to the intended app.",
  true,
  { submissionId: id, versionId: id },
  (c, a) =>
    c.request("/reviewSubmissionItems", {
      method: "POST",
      body: doc(
        "reviewSubmissionItems",
        {},
        {
          reviewSubmission: rel("reviewSubmissions", a.submissionId),
          appStoreVersion: rel("appStoreVersions", a.versionId),
        },
      ),
    }),
);
add(
  "apple_submit_review",
  "Submit an existing prepared review submission to Apple.",
  true,
  { submissionId: id },
  (c, a) => patch(c, "reviewSubmissions", a.submissionId, { submitted: true }),
);
add(
  "apple_release_version",
  "Release an approved version awaiting manual developer release.",
  true,
  { versionId: id },
  async (c, a) => {
    const current = await c.request("/appStoreVersions/" + a.versionId);
    if (current.data?.attributes?.appStoreState !== "PENDING_DEVELOPER_RELEASE")
      throw new Error("Version is not ready for release");
    return c.request("/appStoreVersionReleaseRequests", {
      method: "POST",
      body: {
        data: {
          type: "appStoreVersionReleaseRequests",
          relationships: {
            appStoreVersion: rel("appStoreVersions", a.versionId),
          },
        },
      },
    });
  },
);
const app = { packageName };
const edit = { ...app, editId: id };
const base = (a: any) => "/applications/" + encodeURIComponent(a.packageName);
const ep = (a: any) => base(a) + "/edits/" + a.editId;
add(
  "google_create_edit",
  "Create a temporary Google Play edit. This does not publish changes.",
  true,
  app,
  (c, a) => c.request(base(a) + "/edits", { method: "POST", body: {} }),
);
add(
  "google_get_edit",
  "Read expiry and identity of an edit.",
  false,
  edit,
  (c, a) => c.request(ep(a)),
);
add(
  "google_delete_edit",
  "Discard the specified edit; never discard an edit created by another workflow without authorization.",
  true,
  edit,
  (c, a) => c.request(ep(a), { method: "DELETE" }),
);
add(
  "google_validate_edit",
  "Validate a staged edit without committing it.",
  true,
  edit,
  (c, a) => c.request(ep(a) + ":validate", { method: "POST" }),
);
add(
  "google_commit_edit",
  "Commit all staged changes. May submit for review; never cancels an existing review.",
  true,
  { ...edit, changesNotSentForReview: z.boolean().default(false) },
  async (c, a) => {
    await c.request(ep(a) + ":validate", { method: "POST" });
    return c.request(ep(a) + ":commit", {
      method: "POST",
      params: {
        changesInReviewBehavior: "ERROR_IF_IN_REVIEW",
        changesNotSentForReview: String(a.changesNotSentForReview),
      },
    });
  },
);
for (const [name, suffix, description] of [
  ["details", "details", "Read app contact and language details"],
  ["listings", "listings", "Read localized listings"],
  ["tracks", "tracks", "Read testing and production tracks"],
  ["bundles", "bundles", "Read uploaded Android bundles"],
  ["apks", "apks", "Read uploaded APKs"],
])
  add("google_list_" + name, description, false, edit, (c, a) =>
    c.request(ep(a) + "/" + suffix),
  );
add(
  "google_get_listing",
  "Read a localized store listing.",
  false,
  { ...edit, language: locale },
  (c, a) => c.request(ep(a) + "/listings/" + a.language),
);
add(
  "google_update_listing",
  "Replace a localized listing using complete title and descriptions.",
  true,
  {
    ...edit,
    language: locale,
    title: z.string().min(1).max(30),
    shortDescription: z.string().max(80),
    fullDescription: z.string().max(4000),
  },
  (c, { packageName, editId, language, ...listing }) =>
    c.request(ep({ packageName, editId }) + "/listings/" + language, {
      method: "PUT",
      body: { language, ...listing },
    }),
);
const imageType = z.enum([
  "icon",
  "featureGraphic",
  "phoneScreenshots",
  "sevenInchScreenshots",
  "tenInchScreenshots",
  "tvScreenshots",
  "tvBanner",
  "wearScreenshots",
]);
add(
  "google_list_images",
  "List images in a locale and category.",
  false,
  { ...edit, language: locale, imageType },
  (c, a) => c.request(ep(a) + "/listings/" + a.language + "/" + a.imageType),
);
add(
  "google_upload_image",
  "Upload a PNG/JPEG into a staged edit.",
  true,
  { ...edit, language: locale, imageType, filePath: file },
  (c: GoogleClient, a) => {
    checkedFile(a.filePath, [".png", ".jpg", ".jpeg"]);
    return c.upload(
      ep(a) + "/listings/" + a.language + "/" + a.imageType,
      a.filePath,
      extname(a.filePath).toLowerCase() === ".png" ? "image/png" : "image/jpeg",
    );
  },
);
for (const [name, extension, mime, endpoint] of [
  ["bundle", ".aab", "application/octet-stream", "bundles"],
  ["apk", ".apk", "application/vnd.android.package-archive", "apks"],
])
  add(
    "google_upload_" + name,
    "Upload a signed artifact into an existing edit. Verify returned versionCode.",
    true,
    {
      ...edit,
      filePath: file,
      expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
    },
    async (c: GoogleClient, a) => {
      checkedFile(a.filePath, [extension]);
      if ((await fileDigest(a.filePath, "sha256")) !== a.expectedSha256)
        throw new Error("Artifact hash mismatch");
      return c.upload(ep(a) + "/" + endpoint, a.filePath, mime);
    },
  );
const track = z.string().regex(/^[A-Za-z0-9_.:-]+$/);
add(
  "google_get_track",
  "Read all releases on a track before replacing its contents.",
  false,
  { ...edit, track },
  (c, a) => c.request(ep(a) + "/tracks/" + encodeURIComponent(a.track)),
);
const release = z
  .object({
    name: z.string().optional(),
    versionCodes: z
      .array(
        z
          .string()
          .regex(/^[1-9][0-9]*$/)
          .refine((x) => BigInt(x) <= 2100000000n),
      )
      .min(1),
    status: z.enum(["draft", "inProgress", "halted", "completed"]),
    userFraction: z.number().gt(0).lt(1).optional(),
    releaseNotes: z
      .array(z.object({ language: locale, text: z.string().max(500) }).strict())
      .optional(),
  })
  .strict();
add(
  "google_update_track",
  "Replace the full releases array of a track. Read existing releases and preserve any releases that should remain.",
  true,
  { ...edit, track, releases: z.array(release).min(1) },
  (c, a) => {
    for (const r of a.releases) {
      if (
        new Set(r.versionCodes).size !== r.versionCodes.length ||
        (r.status === "inProgress" && r.userFraction === undefined) ||
        (!["inProgress", "halted"].includes(r.status) &&
          r.userFraction !== undefined)
      )
        throw new Error("Invalid release");
    }
    return c.request(ep(a) + "/tracks/" + encodeURIComponent(a.track), {
      method: "PUT",
      body: { track: a.track, releases: a.releases },
    });
  },
);
add(
  "google_get_testers",
  "Read tester groups for a testing track.",
  false,
  { ...edit, track },
  (c, a) => c.request(ep(a) + "/testers/" + encodeURIComponent(a.track)),
);
add(
  "google_update_testers",
  "Set Google Groups that may test this track. This does not send messages.",
  true,
  { ...edit, track, googleGroups: z.array(z.string().email()) },
  (c, a) =>
    c.request(ep(a) + "/testers/" + encodeURIComponent(a.track), {
      method: "PUT",
      body: { googleGroups: a.googleGroups },
    }),
);
