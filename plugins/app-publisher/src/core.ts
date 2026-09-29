import { readFileSync } from "node:fs";
import { tools } from "./tools.js";
export { tools } from "./tools.js";
import { AppleClient, GoogleClient, ApiFailure } from "./api.js";
import { checkKey, loadConfig, type Config } from "./config.js";
import { z } from "zod";
export function isWrite(name: string) {
  return tools.find((t) => t.name === name)?.write ?? true;
}
export function safeError(error: unknown) {
  const e = error as { status?: unknown; response?: { status?: unknown } };
  const status = e?.status ?? e?.response?.status;
  return {
    error:
      "Store operation failed. Check account permissions, input and store state before retrying. The result may be ambiguous; do not blindly repeat writes.",
    ...(typeof status === "number" ? { status } : {}),
    ...(error instanceof ApiFailure && error.recovery
      ? { recovery: error.recovery }
      : {}),
  };
}
export function publicResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicResult);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /token|secret|password|authorization|private.?key|requestHeaders|uploadOperations/i.test(
          k,
        )
          ? "[REDACTED]"
          : publicResult(v),
      ]),
    );
  if (typeof value === "string")
    return value.replace(/https:\/\/[^\s"<>]+/g, (u) => {
      try {
        const x = new URL(u);
        if (/signature|credential|token|x-amz/i.test(x.search))
          x.search = "?redacted";
        return x.toString();
      } catch {
        return "[URL]";
      }
    });
  return value;
}
export function toolSchema(t: (typeof tools)[number]) {
  return t.schema
    .extend({
      profile: z.string().min(1).describe("Explicit local account profile"),
      ...(isWrite(t.name)
        ? {
            confirm: z
              .literal(true)
              .describe("Set only for a mutation authorized by the user"),
          }
        : {}),
    })
    .strict();
}
export async function invoke(
  name: string,
  raw: unknown,
  options: {
    writeEnabled?: boolean;
    config?: Config;
    client?: any;
  } = {},
) {
  const t = tools.find((t) => t.name === name);
  if (!t) throw new Error("Unknown tool");
  const parsed = toolSchema(t).safeParse(raw);
  if (!parsed.success)
    return {
      error: "Invalid arguments",
      fields: parsed.error.issues.map((x) => ({ path: x.path, code: x.code })),
    };
  if (
    isWrite(name) &&
    !(options.writeEnabled ?? process.env.APP_PUBLISHER_ALLOW_WRITES === "1")
  )
    return {
      error:
        "Writes disabled. Enable APP_PUBLISHER_ALLOW_WRITES=1 locally for an authorized publishing session.",
    };
  const { profile, confirm, ...args } = parsed.data;
  try {
    const config = options.config ?? loadConfig();
    const p = config.profiles[String(profile)];
    if (!p)
      return {
        error: "Unknown profile; use doctor to list configured profile names.",
      };
    const apple = name.startsWith("apple_");
    if (!(apple ? p.apple : p.google))
      return {
        error: "This platform is not configured for the selected profile.",
      };
    let client = options.client;
    if (!client) {
      if (apple) {
        checkKey(p.apple!.p8Path);
        client = new AppleClient(p.apple!);
      } else {
        const g = p.google!;
        const path =
          "oauthTokenPath" in g ? g.oauthTokenPath : g.serviceAccountPath;
        checkKey(path);
        client = new GoogleClient(
          "oauthTokenPath" in g ? JSON.parse(readFileSync(path, "utf8")) : g,
        );
      }
    }
    return publicResult(await t.handler(client, args));
  } catch (e) {
    return safeError(e);
  }
}
