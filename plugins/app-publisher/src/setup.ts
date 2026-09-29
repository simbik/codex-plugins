import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
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
import { AppleClient } from "./api.js";
import { GoogleClient } from "./api.js";
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
    throw new Error("Invalid profile name");
  const config = existsSync(path)
    ? loadConfig(path)
    : ({ profiles: {} } as any);
  if (config.profiles[profile]?.[platform] && !replace)
    throw new Error("Profile already connected; choose Replace connection");
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
      if (url.pathname === "/connect/apple") {
        if (
          typeof data.key !== "string" ||
          !data.key.includes("BEGIN PRIVATE KEY")
        )
          return reply(400, { error: "Select an Apple .p8 private key file." });
        saveConnection(
          data.profile,
          "apple",
          data.key,
          {
            keyId: data.keyId,
            issuerId: data.issuerId || undefined,
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
        const p = loadConfig().profiles[data.profile];
        if (!p) throw new Error();
        if (data.platform === "apple" && p.apple) {
          await new AppleClient(p.apple).request("/apps", {
            params: { limit: "1" },
          });
          return reply(200, { message: "Apple API access verified." });
        }
        if (data.platform === "google" && p.google) {
          if (
            !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(
              data.packageName,
            )
          )
            return reply(400, {
              error: "Enter an existing Android package name.",
            });
          const client = new GoogleClient(
            "oauthTokenPath" in p.google
              ? JSON.parse(readFileSync(p.google.oauthTokenPath, "utf8"))
              : p.google,
          );
          await client.listReviews(data.packageName, undefined, 1);
          return reply(200, {
            message:
              "Google Play API access verified for the package (reviews permission). Release permissions are checked when used.",
          });
        }
        throw new Error();
      }
      return reply(404, { error: "Unknown action" });
    } catch {
      reply(400, {
        error:
          "Connection failed. Check the selected file, required fields, profile replacement checkbox and store permissions. No credentials were logged.",
      });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  origin = `http://127.0.0.1:${address.port}`;
  const url = origin + "/?token=" + token;
  console.error(
    "App Publisher setup is open locally for 15 minutes. Close with Ctrl-C.",
  );
  if (open) openBrowser(url);
  const timer = setTimeout(() => server.close(), 15 * 60_000);
  timer.unref();
  server.on("close", () => clearTimeout(timer));
  return { server, url };
}
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect App Publisher</title><style>
*{box-sizing:border-box}body{margin:0;background:#f2f4f7;color:#182233;font:16px system-ui}main{max-width:980px;margin:50px auto;padding:24px}header{margin-bottom:30px}h1{font-size:40px;letter-spacing:-1.4px;margin:10px 0}h2{margin-top:0}p{color:#526174;line-height:1.55}.tag{color:#2563eb;font-weight:700;font-size:13px;letter-spacing:1px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.card{background:white;border:1px solid #dce1e8;border-radius:18px;padding:25px;box-shadow:0 6px 24px #18223308}label{display:block;margin:16px 0 6px;font-size:14px;font-weight:600}input,select{width:100%;padding:11px;border:1px solid #c4ceda;border-radius:8px;background:white}input[type=checkbox]{width:auto}button,.link{display:inline-block;border:0;border-radius:8px;background:#245ee9;color:white;font:600 14px system-ui;padding:12px 16px;margin:12px 5px 0 0;text-decoration:none;cursor:pointer}.secondary{background:#eaf0ff;color:#234db0}.steps{font-size:14px}#status{white-space:pre-wrap;padding:16px;border-radius:10px;background:#e6edfa;margin:24px 0;min-height:55px}small{color:#526174;display:block;margin-top:12px;line-height:1.5}@media(max-width:720px){.grid{grid-template-columns:1fr}main{margin:15px auto}h1{font-size:30px}}</style>
<main><header><span class="tag">APP PUBLISHER / LOCAL SETUP</span><h1>Connect your stores.</h1><p>Choose the downloaded key file. App Publisher saves it privately on this computer.<br>No secrets in chat, no config editing, no app is published during setup.</p></header>
<label for="profile">Account profile</label><input id="profile" value="default" maxlength="64" pattern="[a-zA-Z0-9_-]+"><label><input type="checkbox" id="replace"> Replace an existing connection for this profile</label><p class="steps">Use one profile for multiple apps in the same account. Create another profile for another account.</p>
<div class="grid"><section class="card"><h2>Apple App Store</h2><p>Apple uses API keys rather than a browser OAuth sign-in.</p><a class="link secondary" href="https://appstoreconnect.apple.com/access/integrations/api" target="_blank" rel="noreferrer">Open Apple API keys ↗</a><p class="steps">Create a key with the role your work needs and download the .p8 file. Apple shows the Issuer ID on the same page. Your account may need API access enabled first.</p>
<label for="appleFile">Apple key (.p8)</label><input type="file" id="appleFile" accept=".p8"><label for="keyId">Key ID (filled from the filename when possible)</label><input id="keyId"><label for="keyType">Key type</label><select id="keyType"><option value="TEAM">Team key</option><option value="INDIVIDUAL">Individual key</option></select><label for="issuer">Issuer ID (team keys)</label><input id="issuer"><button id="appleConnect">Save Apple connection</button><button class="secondary" id="appleCheck">Check Apple access</button></section>
<section class="card"><h2>Google Play</h2><p>Select a service account key, or a Desktop OAuth client file to continue with Google sign-in.</p><a class="link secondary" href="https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com" target="_blank" rel="noreferrer">Enable Play API ↗</a><a class="link secondary" href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noreferrer">Service account keys ↗</a><a class="link secondary" href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Desktop OAuth client ↗</a><a class="link secondary" href="https://play.google.com/console/developers/users-and-permissions" target="_blank" rel="noreferrer">Play access permissions ↗</a><p class="steps">For a service account, grant its email access in Play Console and download a JSON key. For OAuth, download a Desktop client JSON; the next step opens Google consent. Choose the correct Cloud project on linked pages.</p>
<label for="googleFile">Google credentials (.json)</label><input type="file" id="googleFile" accept=".json"><button id="googleConnect">Connect Google</button><label for="packageName">Existing Android package for access check</label><input id="packageName" placeholder="com.example.app"><button class="secondary" id="googleCheck">Check Google access</button><small>App Publisher does not yet provide a shared verified Google OAuth client. Your first connection requires a downloaded client or service account file. Later sessions reuse the saved connection.</small></section></div><div id="status" role="status">Ready to connect. Store credentials never leave this computer except to authenticate with Apple or Google.</div><small>Changes are disabled by default. Close this window and stop the setup command when finished. Restart the Codex task after connecting.</small></main>
<script nonce="__TOKEN__">const $=id=>document.getElementById(id);const token='__TOKEN__';history.replaceState(null,'','/');
async function post(path,data){$('status').textContent='Working…';try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','x-setup-token':token},body:JSON.stringify({profile:$('profile').value,replace:$('replace').checked,...data})});const result=await r.json();$('status').textContent=result.message||result.error||'Opening Google sign-in…';if(result.url)window.location.assign(result.url);}catch{$('status').textContent='Could not connect to the local setup server.'}}
$('appleFile').onchange=()=>{const match=$('appleFile').files[0]?.name.match(/AuthKey_([A-Za-z0-9]+)\\.p8$/);if(match)$('keyId').value=match[1]};
$('appleConnect').onclick=async()=>{const f=$('appleFile').files[0];if(!f){$('status').textContent='Choose the Apple .p8 file first.';return}await post('/connect/apple',{key:await f.text(),keyId:$('keyId').value,issuerId:$('issuer').value,keyType:$('keyType').value})};
$('googleConnect').onclick=async()=>{const f=$('googleFile').files[0];if(!f){$('status').textContent='Choose a Google JSON credential file first.';return}await post('/connect/google',{key:await f.text()})};
$('appleCheck').onclick=()=>post('/check',{platform:'apple'});$('googleCheck').onclick=()=>post('/check',{platform:'google',packageName:$('packageName').value});</script></html>`;
