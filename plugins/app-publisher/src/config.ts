import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
const absolutePath = z
  .string()
  .refine(isAbsolute, "Use an absolute local path");
const profile = z
  .object({
    apple: z
      .object({
        keyId: z.string().min(1),
        issuerId: z.string().min(1).optional(),
        p8Path: absolutePath,
        keyType: z.enum(["TEAM", "INDIVIDUAL"]).default("TEAM"),
      })
      .strict()
      .refine((x) => x.keyType === "INDIVIDUAL" || !!x.issuerId)
      .optional(),
    google: z
      .union([
        z.object({ serviceAccountPath: absolutePath }).strict(),
        z.object({ oauthTokenPath: absolutePath }).strict(),
      ])
      .optional(),
  })
  .strict();
export const configSchema = z
  .object({ profiles: z.record(z.string().regex(/^[a-zA-Z0-9_-]+$/), profile) })
  .strict();
export type Config = z.infer<typeof configSchema>;
export function configPath() {
  return (
    process.env.APP_PUBLISHER_CONFIG ||
    join(homedir(), ".config", "app-publisher", "config.json")
  );
}
export function loadConfig(path = configPath()): Config {
  try {
    const st = statSync(path);
    if (!st.isFile() || (process.platform !== "win32" && st.mode & 0o077))
      throw new Error();
    return configSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    throw new Error(
      "Configuration unavailable or invalid. Use a valid config.json with mode 600; see setup documentation.",
    );
  }
}
export function checkKey(path: string) {
  const st = statSync(path);
  if (!st.isFile() || (process.platform !== "win32" && st.mode & 0o077))
    throw new Error("Credential file must be private (mode 600).");
}
