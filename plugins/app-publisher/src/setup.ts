import { createServer, type IncomingMessage } from "node:http";
import {
  randomBytes,
  randomUUID,
  createHash,
  createPrivateKey,
} from "node:crypto";
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
import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { configPath, loadConfig, configSchema } from "./config.js";
import { AppleClient, ApiFailure } from "./api.js";
import { GoogleClient } from "./api.js";
class SetupFailure extends Error {}
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
  let pending:
    | {
        state: string;
        verifier: string;
        oauth: OAuth2Client;
        profile: string;
        replace: boolean;
        clientId: string;
        clientSecret: string;
      }
    | undefined;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const reply = (status: number, value: any) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url!, origin);
      if (req.headers.host !== new URL(origin).host)
        return reply(403, { error: "Forbidden" });
      if (url.pathname === "/oauth/callback" && req.method === "GET") {
        const p = pending;
        pending = undefined;
        if (
          !p ||
          url.searchParams.get("state") !== p.state ||
          !url.searchParams.get("code")
        )
          return reply(400, {
            error: "OAuth cancelled or invalid state. Restart connection.",
          });
        const { tokens } = await p.oauth.getToken({
          code: url.searchParams.get("code")!,
          codeVerifier: p.verifier,
          redirect_uri: origin + "/oauth/callback",
        });
        if (!tokens.refresh_token)
          return reply(400, {
            error: "No refresh token. Reconnect and allow offline access.",
          });
        saveConnection(
          p.profile,
          "google",
          JSON.stringify({
            clientId: p.clientId,
            clientSecret: p.clientSecret,
            refreshToken: tokens.refresh_token,
          }),
          { oauth: true },
          p.replace,
        );
        res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
        res.end(
          `<h1>Google connected</h1><p>Credentials saved locally.</p><p><a href="${origin}/?token=${token}">Return to App Publisher and check app access</a></p>`,
        );
        return;
      }
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
      if (url.pathname === "/close") {
        reply(200, {
          message: "Setup closed. Saved connections are ready to use.",
        });
        server.close();
        return;
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
        saveConnection(
          data.profile,
          "apple",
          data.key,
          {
            keyId: data.keyId.trim(),
            issuerId:
              data.keyType === "TEAM" ? data.issuerId.trim() : undefined,
            keyType: data.keyType,
          },
          data.replace,
        );
        return reply(200, {
          message: "Apple key saved privately. Use Check Apple access.",
        });
      }
      if (url.pathname === "/connect/google") {
        const key = JSON.parse(data.key);
        if (key.installed) {
          if (
            typeof key.installed.client_id !== "string" ||
            !key.installed.client_id.endsWith(".apps.googleusercontent.com") ||
            typeof key.installed.client_secret !== "string"
          )
            throw new Error();
          const verifier = randomBytes(64).toString("base64url");
          const state = randomBytes(32).toString("hex");
          const oauth = new OAuth2Client(
            key.installed.client_id,
            key.installed.client_secret,
            origin + "/oauth/callback",
          );
          pending = {
            state,
            verifier,
            oauth,
            profile: data.profile,
            replace: data.replace,
            clientId: key.installed.client_id,
            clientSecret: key.installed.client_secret,
          };
          return reply(200, {
            url: oauth.generateAuthUrl({
              access_type: "offline",
              scope: ["https://www.googleapis.com/auth/androidpublisher"],
              prompt: "consent",
              state,
              code_challenge_method: CodeChallengeMethod.S256,
              code_challenge: createHash("sha256")
                .update(verifier)
                .digest("base64url"),
            }),
          });
        }
        saveConnection(
          data.profile,
          "google",
          JSON.stringify(validateServiceAccount(key)),
          {},
          data.replace,
        );
        return reply(200, {
          message:
            "Google key saved privately. Check access using an existing package name.",
        });
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
          const client = new GoogleClient(
            "oauthTokenPath" in p.google
              ? JSON.parse(readFileSync(p.google.oauthTokenPath, "utf8"))
              : p.google,
          );
          await client.verifyAuthentication();
          if (!data.packageName?.trim())
            return reply(200, {
              message:
                "Google credentials accepted. Connection works. Optionally enter an existing Android package to check Play API and reviews access; release permissions have not been checked.",
            });
          if (
            !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(
              data.packageName.trim(),
            )
          )
            throw new SetupFailure(
              "Google credentials accepted. Enter a valid existing Android package name (for example com.company.app) for the optional app access check.",
            );
          await client.listReviews(data.packageName.trim(), undefined, 1);
          return reply(200, {
            message:
              "Google Play API access verified for the package (reviews permission). Release permissions are checked when used.",
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
        if (status === 401)
          message =
            "Store rejected authentication (401). For Apple, match Key ID and .p8 file, and choose Team or Individual according to where the API key was created (not your developer account type). Team keys also require the matching Issuer ID. Save the connection before checking again.";
        else if (status === 403)
          message =
            "Store denied this access check (403). For Google, enable the Android Publisher API in the key's Cloud project and grant the service account app access and reviews permission in Play Console. For Apple, check the API key role and app access.";
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
*{box-sizing:border-box}body{margin:0;background:#f2f4f7;color:#182233;font:16px system-ui}main{max-width:980px;margin:50px auto;padding:24px}header{margin-bottom:30px}h1{font-size:40px;letter-spacing:-1.4px;margin:10px 0}h2{margin-top:0}p{color:#526174;line-height:1.55}.tag{color:#2563eb;font-weight:700;font-size:13px;letter-spacing:1px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.card{background:white;border:1px solid #dce1e8;border-radius:18px;padding:25px;box-shadow:0 6px 24px #18223308}label{display:block;margin:16px 0 6px;font-size:14px;font-weight:600}input,select{width:100%;padding:11px;border:1px solid #c4ceda;border-radius:8px;background:white}input[type=checkbox]{width:auto}button,.link{display:inline-block;border:0;border-radius:8px;background:#245ee9;color:white;font:600 14px system-ui;padding:12px 16px;margin:12px 5px 0 0;text-decoration:none;cursor:pointer}.secondary{background:#eaf0ff;color:#234db0}.steps{font-size:14px}#status{white-space:pre-wrap;padding:16px;border-radius:10px;background:#e6edfa;margin:24px 0;min-height:55px}small{color:#526174;display:block;margin-top:12px;line-height:1.5}@media(max-width:720px){.grid{grid-template-columns:1fr}main{margin:15px auto}h1{font-size:30px}}</style>
<main><header><span class="tag">APP PUBLISHER / LOCAL SETUP</span><h1>Connect your stores.</h1><p>Choose the downloaded key file. App Publisher saves it privately on this computer.<br>No secrets in chat, no config editing, no app is published during setup.</p></header>
<label for="profile">Account profile</label><input id="profile" value="default" maxlength="64" pattern="[a-zA-Z0-9_-]+"><label><input type="checkbox" id="replace"> Replace an existing connection for this profile</label><p class="steps">Use one profile for multiple apps in the same account. Create another profile for another account.</p>
<div class="grid"><section class="card"><h2>Apple App Store</h2><p>Apple uses API keys rather than a browser OAuth sign-in.</p><a class="link secondary" href="https://appstoreconnect.apple.com/access/integrations/api" target="_blank" rel="noreferrer">Open Apple API keys ↗</a><p class="steps">Create a key with the role your work needs and download the .p8 file. Apple shows the Issuer ID on the same page. Your account may need API access enabled first.</p>
<label for="appleFile">Apple key (.p8)</label><input type="file" id="appleFile" accept=".p8"><label for="keyId">Key ID (filled from the filename when possible)</label><input id="keyId"><label for="keyType">Key type</label><select id="keyType"><option value="TEAM">Team key</option><option value="INDIVIDUAL">Individual key</option></select><small>Team keys come from Users and Access → Integrations. Individual API keys come from your user profile. This is not your developer account type.</small><label for="issuer">Issuer ID (team keys)</label><input id="issuer"><button id="appleConnect">Save Apple connection</button><button class="secondary" id="appleCheck">Check Apple access</button></section>
<section class="card"><h2>Google Play</h2><p>Select a service account key, or a Desktop OAuth client file to continue with Google sign-in.</p><a class="link secondary" href="https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com" target="_blank" rel="noreferrer">Enable Play API ↗</a><a class="link secondary" href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noreferrer">Service account keys ↗</a><a class="link secondary" href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Desktop OAuth client ↗</a><a class="link secondary" href="https://play.google.com/console/developers/users-and-permissions" target="_blank" rel="noreferrer">Play access permissions ↗</a><p class="steps">For a service account, grant its email access in Play Console and download a JSON key. For OAuth, download a Desktop client JSON; the next step opens Google consent. Choose the correct Cloud project on linked pages.</p>
<label for="googleFile">Google credentials (.json)</label><input type="file" id="googleFile" accept=".json"><button id="googleConnect">Connect Google</button><label for="packageName">Existing Android package (optional app permissions check)</label><input id="packageName" placeholder="com.example.app"><button class="secondary" id="googleCheck">Check Google access</button><small>App Publisher does not yet provide a shared verified Google OAuth client. Your first connection requires a downloaded client or service account file. Later sessions reuse the saved connection.</small></section></div><div id="status" role="status">Ready to connect. Store credentials never leave this computer except to authenticate with Apple or Google.</div><small>Changes are disabled by default. This window stays available while you create keys. Choose Finish setup when done. Restart the Codex task after connecting.</small><button class="secondary" id="finish">Finish setup</button></main>
<script nonce="__TOKEN__">const $=id=>document.getElementById(id);const token='__TOKEN__';history.replaceState(null,'','/');
async function post(path,data){$('status').textContent='Working…';try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','x-setup-token':token},body:JSON.stringify({profile:$('profile').value,replace:$('replace').checked,...data})});const result=await r.json();if(r.ok&&path==='/connect/apple')appleDirty=false;if(r.ok&&path==='/connect/google')googleDirty=false;$('status').textContent=result.message||result.error||'Opening Google sign-in…';if(result.url)window.location.assign(result.url);}catch{$('status').textContent='The local setup server is no longer running. Ask Codex to reopen App Publisher setup; your saved connections are preserved.'}}
$('keyType').onchange=()=>{$('issuer').disabled=$('keyType').value==='INDIVIDUAL'};
$('finish').onclick=()=>post('/close',{});
$('appleFile').onchange=()=>{const match=$('appleFile').files[0]?.name.match(/AuthKey_([A-Za-z0-9]+)\\.p8$/);if(match)$('keyId').value=match[1]};
$('appleConnect').onclick=async()=>{const f=$('appleFile').files[0];if(!f){$('status').textContent='Choose the Apple .p8 file first.';return}await post('/connect/apple',{key:await f.text(),keyId:$('keyId').value,issuerId:$('issuer').value,keyType:$('keyType').value})};
$('googleConnect').onclick=async()=>{const f=$('googleFile').files[0];if(!f){$('status').textContent='Choose a Google JSON credential file first.';return}await post('/connect/google',{key:await f.text()})};
let appleDirty=false,googleDirty=false;
for(const id of ['appleFile','keyId','keyType','issuer'])$(id).addEventListener('change',()=>appleDirty=true);
$('googleFile').addEventListener('change',()=>googleDirty=true);
$('appleCheck').onclick=()=>{if(appleDirty){$('status').textContent='Save the selected Apple connection first, then check access. Select Replace connection if this profile already has a saved key.';return}post('/check',{platform:'apple'})};
$('googleCheck').onclick=()=>{if(googleDirty){$('status').textContent='Connect the selected Google file first, then check access.';return}post('/check',{platform:'google',packageName:$('packageName').value})};</script></html>`;
