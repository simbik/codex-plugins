import { createPrivateKey, sign, createHash } from "node:crypto";
import { readFileSync, createReadStream, statSync } from "node:fs";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
export type RequestOptions = {
  method?: string;
  body?: unknown;
  params?: Record<string, string>;
};
export class ApiFailure extends Error {
  constructor(
    public status?: number,
    public recovery?: Record<string, string>,
  ) {
    super("Store request failed");
  }
}
export async function jsonRequest(
  url: string,
  init: RequestInit,
  fetcher = fetch,
): Promise<any> {
  const response = await fetcher(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiFailure(response.status);
  }
  if (response.status === 204) return {};
  return response.json();
}
export class AppleClient {
  constructor(
    private config: {
      keyId: string;
      issuerId?: string;
      p8Path: string;
      keyType?: "TEAM" | "INDIVIDUAL";
    },
    private fetcher = fetch,
  ) {}
  private token() {
    const now = Math.floor(Date.now() / 1000);
    const encode = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString("base64url");
    const payload = {
      iat: now,
      exp: now + 600,
      aud: "appstoreconnect-v1",
      ...(this.config.keyType === "INDIVIDUAL"
        ? { sub: "user" }
        : { iss: this.config.issuerId }),
    };
    if (this.config.keyType !== "INDIVIDUAL" && !this.config.issuerId)
      throw new Error("Issuer required");
    const input =
      encode({ alg: "ES256", kid: this.config.keyId, typ: "JWT" }) +
      "." +
      encode(payload);
    const key = createPrivateKey(readFileSync(this.config.p8Path));
    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    )
      throw new Error("Expected P-256 key");
    return (
      input +
      "." +
      sign("sha256", Buffer.from(input), {
        key,
        dsaEncoding: "ieee-p1363",
      }).toString("base64url")
    );
  }
  async request(path: string, options: RequestOptions = {}) {
    const url = new URL(
      path.startsWith("https:")
        ? path
        : "https://api.appstoreconnect.apple.com/v1" + path,
    );
    if (
      url.origin !== "https://api.appstoreconnect.apple.com" ||
      !/^\/v[12]\//.test(url.pathname) ||
      url.username ||
      url.password
    )
      throw new Error("Invalid API origin");
    for (const [k, v] of Object.entries(options.params ?? {}))
      url.searchParams.set(k, v);
    return jsonRequest(
      url.href,
      {
        method: options.method ?? "GET",
        headers: {
          Authorization: "Bearer " + this.token(),
          "Content-Type": "application/json",
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      this.fetcher,
    );
  }
  async uploadRanges(operations: UploadRange[], path: string) {
    const size = statSync(path).size;
    validateRanges(operations, size);
    for (const operation of operations) {
      const stream = createReadStream(path, {
        start: operation.offset,
        end: operation.offset + operation.length - 1,
      });
      const headers: Record<string, string> = {};
      for (const h of operation.requestHeaders ?? []) {
        if (/^(authorization|cookie|host)$/i.test(h.name))
          throw new Error("Unexpected upload header");
        headers[h.name] = h.value;
      }
      for (const k of Object.keys(headers))
        if (k.toLowerCase() === "content-length") delete headers[k];
      headers["Content-Length"] = String(operation.length);
      try {
        const r = await this.fetcher(operation.url, {
          method: operation.method,
          headers,
          body: stream as any,
          duplex: "half",
          redirect: "error",
          signal: AbortSignal.timeout(15 * 60_000),
        } as RequestInit);
        await r.body?.cancel();
        if (!r.ok) throw new ApiFailure(r.status);
      } finally {
        stream.destroy();
      }
    }
  }
}
export type UploadRange = {
  url: string;
  method: string;
  offset: number;
  length: number;
  requestHeaders?: { name: string; value: string }[];
};
export function validateRanges(operations: UploadRange[], size: number) {
  if (!Array.isArray(operations) || !operations.length)
    throw new Error("Upload ranges missing");
  let offset = 0;
  for (const r of [...operations].sort((a, b) => a.offset - b.offset)) {
    const u = new URL(r.url);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      !["PUT", "POST"].includes(r.method) ||
      !Number.isSafeInteger(r.offset) ||
      r.offset !== offset ||
      !Number.isSafeInteger(r.length) ||
      r.length <= 0
    )
      throw new Error("Invalid upload range");
    // Upload destinations come only from an authenticated Apple reservation, never tool arguments.
    offset += r.length;
  }
  if (offset !== size) throw new Error("Upload ranges do not match file size");
}
export async function fileDigest(path: string, algorithm: "md5" | "sha256") {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export class GoogleClient {
  private auth: GoogleAuth | OAuth2Client;
  constructor(
    config: {
      serviceAccountPath?: string;
      clientId?: string;
      clientSecret?: string;
      refreshToken?: string;
    },
    private fetcher = fetch,
  ) {
    if (config.serviceAccountPath) {
      const key = JSON.parse(readFileSync(config.serviceAccountPath, "utf8"));
      if (
        key.type !== "service_account" ||
        key.token_uri !== "https://oauth2.googleapis.com/token"
      )
        throw new Error("Invalid service account");
      this.auth = new GoogleAuth({
        credentials: {
          client_email: key.client_email,
          private_key: key.private_key,
        },
        scopes: ["https://www.googleapis.com/auth/androidpublisher"],
      });
    } else if (config.clientId && config.clientSecret && config.refreshToken) {
      const oauth = new OAuth2Client(config.clientId, config.clientSecret);
      oauth.setCredentials({ refresh_token: config.refreshToken });
      this.auth = oauth;
    } else throw new Error("Google credentials required");
  }
  private async token() {
    const value = await this.auth.getAccessToken();
    const token = typeof value === "string" ? value : value?.token;
    if (!token) throw new Error("No access token");
    return token;
  }
  async request(path: string, options: RequestOptions = {}) {
    if (!path.startsWith("/applications/"))
      throw new Error("Invalid Google path");
    const url = new URL(
      "https://androidpublisher.googleapis.com/androidpublisher/v3" + path,
    );
    for (const [k, v] of Object.entries(options.params ?? {}))
      url.searchParams.set(k, v);
    return jsonRequest(
      url.href,
      {
        method: options.method ?? "GET",
        headers: {
          Authorization: "Bearer " + (await this.token()),
          "Content-Type": "application/json",
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      this.fetcher,
    );
  }
  async upload(path: string, filePath: string, mime: string) {
    if (!path.startsWith("/applications/"))
      throw new Error("Invalid upload path");
    const stream = createReadStream(filePath);
    try {
      const r = await this.fetcher(
        "https://androidpublisher.googleapis.com/upload/androidpublisher/v3" +
          path +
          "?uploadType=media",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + (await this.token()),
            "Content-Type": mime,
            "Content-Length": String(statSync(filePath).size),
          },
          body: stream as any,
          duplex: "half",
          redirect: "error",
          signal: AbortSignal.timeout(15 * 60_000),
        } as RequestInit,
      );
      if (!r.ok) {
        await r.body?.cancel();
        throw new ApiFailure(r.status);
      }
      return r.json();
    } finally {
      stream.destroy();
    }
  }
  async listReviews(packageName: string, _token?: string, maxResults = 1) {
    return this.request(
      "/applications/" + encodeURIComponent(packageName) + "/reviews",
      { params: { maxResults: String(maxResults) } },
    );
  }
}
