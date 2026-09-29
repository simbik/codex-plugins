import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, randomUUID, createPrivateKey } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  renameSync,
  existsSync,
  readFileSync,
  chmodSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { configPath, loadConfig, configSchema } from "./config.js";
import { AppleClient, ApiFailure } from "./api.js";
import { GoogleClient } from "./api.js";
class SetupFailure extends Error {}
function googleSetupInfo(key: any) {
  return {
    projectId:
      typeof key?.project_id === "string" &&
      /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(key.project_id)
        ? key.project_id
        : undefined,
    serviceEmail:
      typeof key?.client_email === "string" &&
      /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(key.client_email)
        ? key.client_email
        : undefined,
  };
}
function googleResult(count: number, saved: boolean) {
  return `Google credentials and Reporting API access verified.${saved ? " Connection saved privately." : ""} ${count ? `Found ${count} accessible app(s).` : "No apps are visible to this account. Check app access in Play Console if you expected apps."} Publisher API and release permissions are checked when those operations are used.`;
}
export function validateServiceAccount(x: any) {
  if (
    x?.type !== "service_account" ||
    typeof x.client_email !== "string" ||
    !x.client_email.endsWith(".iam.gserviceaccount.com") ||
    typeof x.private_key !== "string" ||
    !x.private_key.includes("BEGIN PRIVATE KEY") ||
    x.token_uri !== "https://oauth2.googleapis.com/token"
  )
    throw new Error("Invalid service account");
  return {
    type: x.type,
    project_id: x.project_id,
    private_key_id: x.private_key_id,
    private_key: x.private_key,
    client_email: x.client_email,
    client_id: x.client_id,
    token_uri: x.token_uri,
  };
}
export function saveConnection(
  profile: string,
  platform: "apple" | "google",
  credential: string,
  details: any,
  replace = false,
  path = configPath(),
) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(profile))
    throw new SetupFailure(
      "Use 1–64 letters, numbers, underscores or hyphens for the profile name.",
    );
  const config = existsSync(path)
    ? loadConfig(path)
    : ({ profiles: {} } as any);
  if (config.profiles[profile]?.[platform] && !replace)
    throw new SetupFailure(
      "This profile already has a saved connection. Select Replace connection to save the new key. Check access uses the saved connection.",
    );
  const folder = dirname(path);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);
  const keyPath = join(folder, `${platform}-${randomUUID()}.json`);
  const entry =
    platform === "apple"
      ? { ...details, p8Path: keyPath }
      : { [details.oauth ? "oauthTokenPath" : "serviceAccountPath"]: keyPath };
  const next = configSchema.parse({
    profiles: {
      ...config.profiles,
      [profile]: { ...config.profiles[profile], [platform]: entry },
    },
  });
  writeFileSync(keyPath, credential, { mode: 0o600, flag: "wx" });
  const temp = join(folder, `.config-${randomUUID()}.tmp`);
  writeFileSync(temp, JSON.stringify(next, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  renameSync(temp, path);
  return keyPath;
}
function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "rundll32"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  execFile(cmd, args, () => {});
}
async function body(req: IncomingMessage) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 128_000) throw new Error();
  }
  return JSON.parse(text);
}
export async function startSetup(open = true) {
  const token = randomBytes(32).toString("hex");
  let origin = "";
  const server = createServer(async (req, res) => {
    let googleSetup: ReturnType<typeof googleSetupInfo> | undefined;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const reply = (status: number, value: any) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...value, ...googleSetup }));
    };
    try {
      const url = new URL(req.url!, origin);
      if (req.headers.host !== new URL(origin).host)
        return reply(403, { error: "Forbidden" });
      if (
        req.method === "GET" &&
        url.pathname === "/" &&
        url.searchParams.get("token") === token
      ) {
        res.setHeader(
          "Content-Security-Policy",
          `default-src 'none'; script-src 'nonce-${token}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'`,
        );
        res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
        res.end(html.replaceAll("__TOKEN__", token));
        return;
      }
      if (
        req.method !== "POST" ||
        req.headers["x-setup-token"] !== token ||
        req.headers.origin !== origin
      )
        return reply(403, { error: "Forbidden" });
      const data = await body(req);
      if (url.pathname === "/connections") {
        const profile = existsSync(configPath()) ? loadConfig().profiles[data.profile] : undefined;
        return reply(200, {apple:{saved:!!profile?.apple},google:{saved:!!profile?.google}});
      }
      if (url.pathname === "/close") {
        reply(200, {
          message: "Setup closed. Saved connections are ready to use.",
        });
        server.close();
        return;
      }
      if (["/connect/apple", "/connect/google"].includes(url.pathname)) {
        if (
          typeof data.profile !== "string" ||
          !/^[a-zA-Z0-9_-]{1,64}$/.test(data.profile)
        )
          throw new SetupFailure(
            "Use 1–64 letters, numbers, underscores or hyphens for the profile name.",
          );
        const platform = url.pathname === "/connect/apple" ? "apple" : "google";
        if (
          existsSync(configPath()) &&
          loadConfig().profiles[data.profile]?.[platform] &&
          data.replace !== true
        )
          throw new SetupFailure(
            "This profile already has a saved connection. Select Replace connection to verify and save the new key. The existing connection stays unchanged if validation fails.",
          );
      }
      if (url.pathname === "/connect/apple") {
        if (
          typeof data.key !== "string" ||
          !data.key.includes("BEGIN PRIVATE KEY")
        )
          return reply(400, { error: "Select an Apple .p8 private key file." });
        let privateKey;
        try {
          privateKey = createPrivateKey(data.key);
        } catch {
          throw new SetupFailure(
            "The .p8 file is not a valid private key. Select the downloaded Apple API key.",
          );
        }
        if (
          privateKey.asymmetricKeyType !== "ec" ||
          privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
        )
          throw new SetupFailure("Select an Apple P-256 API key (.p8).");
        if (typeof data.keyId !== "string" || !data.keyId.trim())
          throw new SetupFailure(
            "Enter the Key ID belonging to the selected .p8 file.",
          );
        if (!["TEAM", "INDIVIDUAL"].includes(data.keyType))
          throw new SetupFailure("Select Team or Individual API key type.");
        if (
          data.keyType === "TEAM" &&
          (typeof data.issuerId !== "string" || !data.issuerId.trim())
        )
          throw new SetupFailure(
            "Team keys need the Issuer ID from App Store Connect → Users and Access → Integrations.",
          );
        const details = {
          keyId: data.keyId.trim(),
          issuerId: data.keyType === "TEAM" ? data.issuerId.trim() : undefined,
          keyType: data.keyType,
        };
        await new AppleClient({ ...details, privateKey: data.key }).request(
          "/apps",
          { params: { limit: "1" } },
        );
        saveConnection(
          data.profile,
          "apple",
          data.key,
          details,
          data.replace === true,
        );
        return reply(200, {
          message: "Apple API access verified. Connection saved privately.",
        });
      }
      if (url.pathname === "/connect/google") {
        let key;
        try {
          key = validateServiceAccount(JSON.parse(data.key));
        } catch {
          throw new SetupFailure(
            "Select a service account JSON key (type: service_account), not a Desktop OAuth client. Follow the Google setup steps below.",
          );
        }
        googleSetup = googleSetupInfo(key);
        const client = new GoogleClient({ serviceAccount: key });
        await client.verifyAuthentication();
        const apps = await client.listApps();
        saveConnection(
          data.profile,
          "google",
          JSON.stringify(key),
          {},
          data.replace === true,
        );
        return reply(200, { message: googleResult(apps.length, true), apps });
      }
      if (url.pathname === "/check") {
        const p = existsSync(configPath())
          ? loadConfig().profiles[data.profile]
          : undefined;
        if (!p || !p[data.platform as "apple" | "google"])
          throw new SetupFailure(
            "Save or Connect this store for the selected profile first. Check access uses the saved connection.",
          );
        if (data.platform === "apple" && p.apple) {
          await new AppleClient(p.apple).request("/apps", {
            params: { limit: "1" },
          });
          return reply(200, { message: "Apple API access verified." });
        }
        if (data.platform === "google" && p.google) {
          if ("serviceAccountPath" in p.google)
            googleSetup = googleSetupInfo(
              JSON.parse(readFileSync(p.google.serviceAccountPath, "utf8")),
            );
          const client = new GoogleClient(
            "oauthTokenPath" in p.google
              ? JSON.parse(readFileSync(p.google.oauthTokenPath, "utf8"))
              : p.google,
          );
          await client.verifyAuthentication();
          const apps = await client.listApps();
          return reply(200, {
            message: googleResult(apps.length, false),
            apps,
          });
        }
        throw new Error();
      }
      return reply(404, { error: "Unknown action" });
    } catch (error) {
      // Only locally authored messages and numeric provider status are safe to return.
      let message =
        "Connection failed. Check the selected credential file and retry. No credentials were logged.";
      if (error instanceof SetupFailure) message = error.message;
      else {
        const status =
          error instanceof ApiFailure
            ? error.status
            : (error as any)?.response?.status;
        if (error instanceof ApiFailure && error.reason === "SERVICE_DISABLED")
          message = `Google accepted the credential, but ${error.service === "androidpublisher.googleapis.com" ? "Android Publisher API" : "Play Developer Reporting API"} is disabled in its Cloud project. Enable it using the matching setup link, wait a few minutes, then retry. The existing connection has not been replaced.`;
        else if (
          error instanceof ApiFailure &&
          error.reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT"
        )
          message =
            "Google token is missing the Reporting API scope. Reconnect with a service account JSON key using the steps below. The existing connection has not been replaced.";
        else if (
          error instanceof ApiFailure &&
          error.reason === "INVALID_CREDENTIALS"
        )
          message =
            "Google rejected the credential. Check that the service account is active and the selected JSON key has not been deleted or revoked. The existing connection has not been replaced.";
        else if (status === 401)
          message =
            "Store rejected authentication (401). For Apple, match Key ID and .p8 file, and choose Team or Individual according to where the API key was created (not your developer account type). Team keys also require the matching Issuer ID. The existing connection has not been replaced.";
        else if (status === 403)
          message =
            "Store denied this access check (403). For Google, invite the service account email in Play Console → Users and permissions and grant access to app information. Check Reporting API access. For Apple, check the API key role and app access.";
        else if (status === 404)
          message =
            "App not found or not accessible (404). Check the existing Android package name and Play Console app permissions.";
        else if (status === 429)
          message = "Store rate limit reached (429). Wait briefly and retry.";
        else if (typeof status === "number")
          message = `Store request failed (HTTP ${status}). Retry or check the store service status.`;
        else if (
          error instanceof Error &&
          ["TimeoutError", "AbortError"].includes(error.name)
        )
          message =
            "Store request timed out. The setup window is still available; retry the check.";
      }
      reply(400, { error: message });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  origin = `http://127.0.0.1:${address.port}`;
  const url = origin + "/?token=" + token;
  console.error(
    "App Publisher setup is open locally until you choose Finish setup or press Ctrl-C.",
  );
  if (open) openBrowser(url);
  return { server, url };
}
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect App Publisher</title><style>
:root{color-scheme:light;--bg:#f5f6f8;--surface:#fff;--text:#172338;--muted:#566477;--line:#dde3eb;--accent:#2459d3;--soft:#eef3ff;--radius:16px}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1140px;margin:0 auto;padding:44px 28px 28px}header{margin-bottom:28px}.tag{font-size:11px;letter-spacing:1.7px;font-weight:750;color:var(--accent)}h1{font-size:36px;line-height:1.2;letter-spacing:-1.2px;margin:10px 0 12px}h2{font-size:21px;line-height:1.3;letter-spacing:-.4px;margin:0}h3{font-size:16px;margin:0 0 8px;color:var(--text)}p{color:var(--muted);margin:8px 0 14px}header p{max-width:670px;font-size:16px}a{color:var(--accent);text-underline-offset:3px}button,input,select{font:inherit}button,.link{display:inline-flex;align-items:center;justify-content:center;min-height:40px;gap:7px;padding:9px 14px;border:1px solid transparent;border-radius:9px;background:var(--accent);color:white;font-size:13px;line-height:1.4;font-weight:650;text-decoration:none;cursor:pointer;transition:background .15s,border-color .15s}button:hover,.link:hover{background:#1947b5}.secondary{background:var(--surface);color:var(--accent);border-color:#ccd8ef}.secondary:hover{background:var(--soft);border-color:#9eb4df}:focus-visible{outline:3px solid #91b3ff;outline-offset:3px}button:disabled{opacity:.55;cursor:wait}input,select{display:block;width:100%;min-width:0;min-height:44px;border:1px solid #cbd4e0;border-radius:8px;background:white;color:var(--text);padding:10px 12px}input:disabled{background:#edf0f5;color:var(--muted)}label{display:block;font-size:13px;font-weight:650;margin:18px 0 6px}input[type=checkbox]{width:16px;min-height:16px;flex:none;accent-color:var(--accent)}input[type=file]{font-size:12px;border-style:dashed;padding:10px;background:#fff}input::file-selector-button{border:0;border-radius:5px;padding:7px 9px;margin-right:10px;background:var(--soft);color:var(--accent);font:600 12px system-ui;cursor:pointer}.profile-bar{display:flex;gap:28px;align-items:center;padding:18px 22px;background:white;border:1px solid var(--line);border-radius:12px;margin-bottom:22px}.profile-field{width:225px;flex:none}.profile-field label{margin-top:0}.profile-note{font-size:13px;margin:0 0 8px}.check-label{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:500;margin:0}.grid{display:grid;gap:22px}.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;box-shadow:0 3px 12px #17233804}.store-heading{display:flex;align-items:center;gap:13px;padding:22px 26px;border-bottom:1px solid var(--line)}.store-heading p{font-size:13px;margin:3px 0 0}.store-mark{display:grid;place-items:center;width:40px;height:40px;border:1px solid var(--line);background:#f8f9fc;border-radius:11px;font-weight:750;font-size:17px}.badge{margin-left:auto;font-size:11px;font-weight:600;color:var(--muted);padding:5px 9px;border-radius:20px;background:#f2f4f8}.store-body{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)}.guide{padding:26px}.connection{padding:26px;background:#fafbfd;border-left:1px solid var(--line)}.eyebrow{font-size:11px;letter-spacing:1.3px;font-weight:700;color:var(--muted);margin:0 0 18px;text-transform:uppercase}.steps{margin:0;padding:0;list-style:none;counter-reset:step}.steps>li{counter-increment:step;position:relative;padding:0 0 28px 40px;font-size:16px}.steps>li:last-child{padding-bottom:0}.steps>li:before{content:counter(step);position:absolute;left:0;top:0;display:grid;place-items:center;width:25px;height:25px;border:1px solid #d5e0f7;border-radius:50%;background:var(--soft);color:var(--accent);font-size:12px;font-weight:700}.steps p{margin-top:10px;margin-bottom:0}.key-path{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0;font-size:14px;font-weight:650}.key-path span:nth-child(odd){padding:6px 9px;background:var(--soft);border-radius:6px}.actions{display:flex;gap:8px;flex-wrap:wrap}.form-actions{display:grid;gap:9px;margin-top:22px}.form-actions button{width:100%;min-height:43px}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.hint,small{display:block;color:var(--muted);font-size:12px;line-height:1.6;margin:8px 0 0}.notice{padding:12px 14px;background:var(--soft);border-radius:8px;font-size:12px;color:#374c71;margin-top:16px}details{margin-top:16px;border:1px solid var(--line);border-radius:8px;background:white;padding:11px 13px}summary{cursor:pointer;font-size:14px;font-weight:650;color:var(--text)}details ul{padding-left:18px;margin:12px 0}details li{margin:12px 0;color:var(--muted);font-size:14px}details p{font-size:14px}#googleIdentity{font-size:12px;overflow-wrap:anywhere;padding:10px 12px;background:var(--soft);border-radius:8px}#googleIdentity:empty{display:none}.feedback{margin-top:20px;padding:17px 20px;background:white;border:1px solid var(--line);border-radius:12px}.feedback-label{font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:5px}#status{white-space:pre-wrap;font-size:13px;color:var(--text);overflow-wrap:anywhere}#apps{font-size:13px;padding-left:20px}#apps:empty{display:none}footer{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-top:20px}footer small{margin:0;max-width:690px}footer button{flex:none}@media(max-width:760px){main{padding:26px 16px}h1{font-size:30px}.profile-bar{align-items:stretch;flex-direction:column;gap:12px}.profile-field{width:auto}.store-body{grid-template-columns:1fr}.connection{border-left:0;border-top:1px solid var(--line)}.guide,.connection{padding:22px 18px}.store-heading{padding:18px}.badge{display:none}.actions{flex-direction:column;align-items:stretch}.steps>li{padding-left:35px}.field-row{grid-template-columns:1fr}footer{align-items:flex-start;flex-direction:column}}@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
[hidden]{display:none!important}.store-tabs{display:flex;gap:12px;margin:0 0 18px;padding:8px 0;position:sticky;top:0;z-index:5;background:var(--bg)}.store-tab{flex:1;justify-content:space-between;text-align:left;padding:16px 20px;min-height:68px;background:white;color:var(--text);border:1px solid var(--line);font-size:16px}.store-tab:hover{background:var(--soft)}.store-tab[aria-selected=true]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent);background:var(--soft)}.tab-state{font-size:12px;padding:4px 9px;border-radius:20px;background:#edf0f5;color:#526174;font-weight:600}.tab-state[data-state=verified]{background:#e0f3e8;color:#186b3b}.tab-state[data-state=failed]{background:#ffebe8;color:#a13023}.tab-state[data-state=checking]{background:#e0eafe;color:#2459d3}.local-status{margin-top:14px;padding:13px 15px;border:1px solid var(--line);border-radius:9px;background:#fff;font-size:14px;line-height:1.6;overflow-wrap:anywhere}.local-status[data-kind=success]{background:#f0faf4;border-color:#b9dec6}.local-status[data-kind=error]{background:#fff4f2;border-color:#efc7bf}.local-status[data-kind=loading]{background:var(--soft);border-color:#c6d5f6}.saved-state{font-size:13px;margin:8px 0 14px;color:var(--muted)}.local-apps{max-height:200px;overflow:auto;font-size:13px;padding-left:20px}.connection{align-self:start}.store-body{align-items:start}.guide{grid-column:2;grid-row:1}.connection{grid-column:1;grid-row:1;border-left:0;border-right:1px solid var(--line);height:100%}.store-body{grid-template-columns:minmax(0,1fr) minmax(0,1.15fr)}@media(max-width:760px){.store-tabs{gap:8px}.store-tab{padding:12px;align-items:flex-start;flex-direction:column;gap:8px}.connection,.guide{grid-column:1;grid-row:auto}.connection{order:-1;border:0;border-bottom:1px solid var(--line)}.store-body{display:flex;flex-direction:column}.connection,.guide{width:100%}} </style>
<main><header><span class="tag">APP PUBLISHER · CONNECTIONS</span><h1>Connect your stores.</h1><p>A one-time setup for Apple and Google. Your credentials stay on this computer and are verified before saving.</p></header>
<section class="profile-bar" aria-label="Account profile"><div class="profile-field"><label for="profile">Account profile</label><input id="profile" value="default" maxlength="64" pattern="[a-zA-Z0-9_-]+"></div><div><p class="profile-note">One profile per account. Use the same connection for all apps it can access.</p><label class="check-label"><input type="checkbox" id="replace">Replace an existing connection after verification</label></div></section>
<div class="store-tabs" role="tablist" aria-label="Store connections"><button id="appleTab" class="store-tab" role="tab" aria-selected="true" aria-controls="applePanel"><span>Apple App Store</span><span id="appleTabState" class="tab-state">Loading…</span></button><button id="googleTab" class="store-tab" role="tab" aria-selected="false" aria-controls="googlePanel" tabindex="-1"><span>Google Play</span><span id="googleTabState" class="tab-state">Loading…</span></button></div><div class="grid"><section id="applePanel" class="card" role="tabpanel" aria-labelledby="appleTab"><div class="store-heading"><span class="store-mark" aria-hidden="true">A</span><div><h2 id="appleHeading">Apple App Store</h2><p>Connect with an App Store Connect API key.</p></div><span class="badge">.p8 API key</span></div><div class="store-body"><div class="guide"><div class="eyebrow">Setup guide</div><ol class="steps"><li><h3>Create an API key</h3><a class="link secondary" href="https://appstoreconnect.apple.com/access/integrations/api" target="_blank" rel="noreferrer">Open Apple API keys ↗</a><p>Users and Access → Integrations → Team Keys → “+”. Choose <b>App Manager</b> for metadata, builds and releases. For full provisioning, including distribution certificates, use an <b>Admin Team key</b>. An existing Admin key also works.</p><small>If API access is unavailable, the Account Holder must complete Request Access first.</small></li><li><h3>Download your key</h3><p>Download the .p8 file. The <b>Issuer ID</b> appears above the key list; Key ID is filled from the filename when possible.</p></li><li><h3>Verify and connect</h3><p>Select your key and enter its details. We check Apple API access before saving. Failed verification keeps your existing connection intact.</p></li></ol><details><summary>Key types and required access</summary><p><b>Team keys</b> require Issuer ID, even for an individual developer account. They apply to all team apps within the selected role.</p><p><b>Individual keys</b> come from Edit Profile → Individual API Key and inherit the user’s app access. Use an App Manager user to cover metadata, screenshots, uploads, TestFlight, review submissions and releases.</p><p>API keys do not sign builds. Upload an already signed .ipa. External TestFlight may require Beta App Review.</p><a href="https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api" target="_blank" rel="noreferrer">Apple setup reference ↗</a></details></div>
<div class="connection"><div class="eyebrow">Your connection</div><h3>Add your Apple key</h3><p id="appleSaved" class="saved-state">Loading saved connection…</p><label for="appleFile">Private key file</label><input type="file" id="appleFile" accept=".p8"><small>Choose the .p8 file downloaded from App Store Connect.</small><div class="field-row"><div><label for="keyId">Key ID</label><input id="keyId" placeholder="From your key filename"></div><div><label for="keyType">API key type</label><select id="keyType"><option value="TEAM">Team key</option><option value="INDIVIDUAL">Individual key</option></select></div></div><div class="notice">A key created under <b>Team Keys</b> needs Team key here, even if your developer account is personal.</div><label for="issuer">Issuer ID</label><input id="issuer" placeholder="Required for Team keys"><small>Copy from the Apple API keys page. Not needed for Individual keys.</small><div class="form-actions"><button id="appleConnect">Verify and save Apple</button><button class="secondary" id="appleCheck">Check saved Apple connection</button></div><div id="appleStatus" class="local-status" role="status" aria-live="polite">Select a key or check the saved connection.</div><ul id="appleApps" class="local-apps" hidden></ul></div></div></section>
<section id="googlePanel" class="card" role="tabpanel" aria-labelledby="googleTab" hidden><div class="store-heading"><span class="store-mark" aria-hidden="true">G</span><div><h2 id="googleHeading">Google Play</h2><p>Connect with a Google Cloud service account.</p></div><span class="badge">.json service key</span></div><div class="store-body"><div class="guide"><div class="eyebrow">Setup guide</div><ol class="steps"><li><h3>Enable both APIs</h3><p>Choose the same Google Cloud project on both pages, then click Enable.</p><div class="actions"><a id="publisherLink" class="link secondary" href="https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com" target="_blank" rel="noreferrer">Enable Publisher API ↗</a><a id="reportingLink" class="link secondary" href="https://console.cloud.google.com/apis/library/playdeveloperreporting.googleapis.com" target="_blank" rel="noreferrer">Enable Reporting API ↗</a></div><p>Publisher handles metadata, builds and releases. Reporting lists accessible apps without a package name. Click Enable on each page.</p></li>
<li><h3>Create a service account</h3><a id="serviceLink" class="link secondary" href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noreferrer">Open service accounts ↗</a><p>Click <b>Create service account</b>, enter a name, then choose <b>Create and continue</b>. Skip the optional Cloud role and user access steps, then click <b>Done</b>.</p><p>Play Console permissions are assigned separately in the last step below.</p></li>
<li><h3>Download a JSON key</h3><p>Open the service account you just created, then follow:</p><div class="key-path"><span>Keys</span><span aria-hidden="true">→</span><span>Add key</span><span aria-hidden="true">→</span><span>Create new key</span></div><p>Select <b>JSON</b> and click <b>Create</b>. Your browser downloads the key file. Select that file in the connection form.</p></li>
<li><h3>Grant access to your apps</h3><a class="link secondary" href="https://play.google.com/console/" target="_blank" rel="noreferrer">Open Play Console ↗</a><p>Select your developer account → Users and permissions → Invite new users. Enter the service account email from the JSON file. Under App permissions, select your apps and the permissions below, then choose Invite user.</p>
<details><summary>Required Play Console permissions</summary><ul>
<li><b>View app information (read-only)</b> — read and discover selected apps. For all apps: Account permissions → <b>View app information and download bulk reports (read-only)</b>.</li>
<li><b>Manage store presence</b> — descriptions, localizations and screenshots.</li>
<li><b>Release apps to testing tracks</b> / <b>Release to testing tracks</b> — build uploads and test releases.</li>
<li><b>Manage testing tracks and edit tester lists</b> — testing track configuration and tester lists.</li>
<li><b>Release to production, exclude devices, and use Play App Signing</b> — production publishing and staged rollouts.</li>
<li><b>Edit and delete draft apps</b> — required when working with draft apps.</li>
</ul><p>For all current publishing workflows, grant the listed permissions on your target apps. These tools do not require financial, order, subscription, review or user-management permissions. <a href="https://developers.google.com/android-publisher/api-ref/rest/v3/grants" target="_blank" rel="noreferrer">Google permission reference ↗</a></p></details></li>
</ol></div><div class="connection"><div class="eyebrow">Your connection</div><h3>Add your service account</h3><p id="googleSaved" class="saved-state">Loading saved connection…</p><p class="hint">Already have a JSON key? Select it here to point the setup links at its Cloud project.</p><label for="googleFile">Service account key</label><input type="file" id="googleFile" accept=".json"><small>Use the downloaded service account JSON, not a Desktop OAuth client.</small><p id="googleIdentity"></p><div class="notice">We verify the key and list accessible apps before saving. No package name is required.</div><div class="form-actions"><button id="googleConnect">Verify and save Google</button><button class="secondary" id="googleCheck">Check saved Google connection</button></div><div id="googleStatus" class="local-status" role="status" aria-live="polite">Select a key or check the saved connection.</div><ul id="googleApps" class="local-apps" hidden></ul><small>Recent API or permission changes can take a few minutes to apply.</small><details><summary>What does this check verify?</summary><p>App discovery confirms Reporting API access. Publisher API and release permissions are checked when those operations are used. Setup does not create test releases.</p></details></div></div></section></div>
<footer><small>Setup stays open while you create keys. Nothing is published during setup.<br>Start a new Codex task after connecting to load the updated tools.</small><div><button class="secondary" id="finish">Finish setup</button><small id="finishStatus" role="status"></small></div></footer></main>
<script nonce="__TOKEN__">
const $=id=>document.getElementById(id),token='__TOKEN__',platforms=['apple','google'];
history.replaceState(null,'','/');
let active='apple',generation=0,busy=false,closed=false,loading=true;
const states={apple:{saved:false,check:'unknown',dirty:false},google:{saved:false,check:'unknown',dirty:false}};
function render(p){const s=states[p];const labels={unknown:s.saved?'Saved · not checked':'Not connected',checking:'Checking…',verified:'Verified',failed:'Check failed'};$(p+'TabState').textContent=labels[s.check];$(p+'TabState').dataset.state=s.check;$(p+'Saved').textContent=s.saved?'A key is saved for this profile. '+(s.check==='verified'?'Access verified in this session.':'Check access to verify it.'):'No saved connection for this profile.';}
function show(p,message,kind='info'){const el=$(p+'Status');el.textContent=message;el.dataset.kind=kind;if(active===p&&kind!=='info'){const r=el.getBoundingClientRect();if(r.bottom>window.innerHeight||r.top<0)el.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}}
function selectTab(p,focus=false){active=p;for(const name of platforms){const selected=name===p;$(name+'Tab').setAttribute('aria-selected',String(selected));$(name+'Tab').tabIndex=selected?0:-1;$(name+'Panel').hidden=!selected;}if(focus)$(p+'Tab').focus();}
for(const p of platforms){$(p+'Tab').onclick=()=>selectTab(p);$(p+'Tab').onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();selectTab(e.key==='Home'?'apple':e.key==='End'?'google':p==='apple'?'google':'apple',true);}};}
async function request(path,data){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','x-setup-token':token},body:JSON.stringify(data)});return {ok:response.ok,...await response.json()};}
function lock(value){busy=value;for(const id of ['profile','replace','finish','appleConnect','appleCheck','googleConnect','googleCheck','appleFile','keyId','keyType','issuer','googleFile'])$(id).disabled=value||closed;$('issuer').disabled=value||closed||$('keyType').value==='INDIVIDUAL';}
async function loadConnections(){loading=true;const version=++generation;for(const p of platforms){states[p]={saved:false,check:'unknown',dirty:false};$(p+'TabState').textContent='Loading…';$(p+'Apps').replaceChildren();$(p+'Apps').hidden=true;show(p,'Loading saved connection…');}$('appleFile').value='';$('googleFile').value='';$('keyId').value='';$('issuer').value='';setGoogleProject();try{const result=await request('/connections',{profile:$('profile').value});if(version!==generation)return;if(!result.ok)throw new Error();for(const p of platforms){states[p].saved=result[p].saved;render(p);show(p,states[p].saved?'Your saved key is ready to check. No file selection is needed.':'Choose your credential file, then verify and save.');}}catch{if(version!==generation)return;for(const p of platforms){render(p);$(p+'TabState').textContent='Status unavailable';show(p,'Could not load saved connections. Reopen setup if the local server has stopped.','error');}}finally{if(version===generation)loading=false;}}
async function post(p,path,data){if(busy||closed)return;if(loading){show(p,'Loading saved connections. Try again in a moment.');return;}const s=states[p],candidate=path.startsWith('/connect/'),previous=s.check;lock(true);s.check='checking';render(p);show(p,'Checking with '+(p==='apple'?'Apple':'Google')+'…','loading');$(p+'Apps').replaceChildren();$(p+'Apps').hidden=true;try{const result=await request(path,{profile:$('profile').value,replace:$('replace').checked,...data});if(p==='google')setGoogleProject(result.projectId,result.serviceEmail);if(result.ok){s.saved=true;s.check='verified';if(candidate)s.dirty=false;show(p,result.message,'success');for(const app of result.apps||[]){const li=document.createElement('li');li.textContent=app.displayName+' — '+app.name.slice(5);$(p+'Apps').appendChild(li);}$(p+'Apps').hidden=!(result.apps||[]).length;}else{s.check=candidate?previous:'failed';show(p,result.error+(candidate?' Your saved connection was not changed.':''),'error');}}catch{s.check=candidate?previous:'failed';show(p,'Could not reach the local setup server. Reopen App Publisher setup; saved connections are preserved.','error');}finally{render(p);lock(false);}}
function dirty(p){states[p].dirty=true;show(p,'Unsaved changes. Verify and save this key to replace the saved connection.');}
$('profile').addEventListener('input',loadConnections);
$('keyType').onchange=()=>{$('issuer').disabled=$('keyType').value==='INDIVIDUAL'};
$('appleFile').onchange=()=>{const match=$('appleFile').files[0]?.name.match(/AuthKey_([A-Za-z0-9]+)\\.p8$/);if(match)$('keyId').value=match[1]};
for(const id of ['appleFile','keyId','keyType','issuer'])$(id).addEventListener('input',()=>dirty('apple'));
function setGoogleProject(projectId,email){$('googleIdentity').textContent=email?'Email to invite in Play Console: '+email:'';for(const id of ['publisherLink','reportingLink','serviceLink']){const url=new URL($(id).href);url.search='';if(typeof projectId==='string'&&/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId))url.searchParams.set('project',projectId);$(id).href=url.href}}
$('googleFile').onchange=async()=>{dirty('google');const f=$('googleFile').files[0];setGoogleProject();if(!f)return;try{const key=JSON.parse(await f.text());if(key.type!=='service_account'){show('google','Choose a service account JSON, not an OAuth client.','error');return}setGoogleProject(key.project_id,key.client_email)}catch{show('google','Could not read the JSON file.','error')}};
$('appleConnect').onclick=async()=>{const f=$('appleFile').files[0];if(!f){show('apple','Choose the Apple .p8 file first.','error');return}await post('apple','/connect/apple',{key:await f.text(),keyId:$('keyId').value,issuerId:$('issuer').value,keyType:$('keyType').value})};
$('googleConnect').onclick=async()=>{const f=$('googleFile').files[0];if(!f){show('google','Choose a service account JSON file first.','error');return}await post('google','/connect/google',{key:await f.text()})};
for(const p of platforms)$(p+'Check').onclick=()=>{if(states[p].dirty){show(p,'You have unsaved changes. Use Verify and save to check the selected key.','error');return}post(p,'/check',{platform:p})};
$('finish').onclick=async()=>{if(busy||closed)return;lock(true);try{const r=await request('/close',{});if(!r.ok)throw new Error();closed=true;$('finishStatus').textContent='Setup closed. You can close this tab.';for(const p of platforms)show(p,'Setup closed. Saved connections are preserved.');}catch{$('finishStatus').textContent='Setup is unavailable. You can close this tab.';}finally{lock(false)}};
loadConnections();
</script></html>`;
