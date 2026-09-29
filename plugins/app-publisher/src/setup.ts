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
*{box-sizing:border-box}body{margin:0;background:#f2f4f7;color:#182233;font:16px system-ui}main{max-width:980px;margin:50px auto;padding:24px}header{margin-bottom:30px}h1{font-size:40px;letter-spacing:-1.4px;margin:10px 0}h2{margin-top:0}p{color:#526174;line-height:1.55}.tag{color:#2563eb;font-weight:700;font-size:13px;letter-spacing:1px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.card{background:white;border:1px solid #dce1e8;border-radius:18px;padding:25px;box-shadow:0 6px 24px #18223308}label{display:block;margin:16px 0 6px;font-size:14px;font-weight:600}input,select{width:100%;padding:11px;border:1px solid #c4ceda;border-radius:8px;background:white}input[type=checkbox]{width:auto}button,.link{display:inline-block;border:0;border-radius:8px;background:#245ee9;color:white;font:600 14px system-ui;padding:12px 16px;margin:12px 5px 0 0;text-decoration:none;cursor:pointer}.secondary{background:#eaf0ff;color:#234db0}.steps{font-size:14px}#status{white-space:pre-wrap;padding:16px;border-radius:10px;background:#e6edfa;margin:24px 0;min-height:55px}small{color:#526174;display:block;margin-top:12px;line-height:1.5}@media(max-width:720px){.grid{grid-template-columns:1fr}main{margin:15px auto}h1{font-size:30px}}</style>
<main><header><span class="tag">APP PUBLISHER / LOCAL SETUP</span><h1>Connect your stores.</h1><p>Choose the downloaded key file. App Publisher saves it privately on this computer.<br>No secrets in chat, no config editing, no app is published during setup.</p></header>
<label for="profile">Account profile</label><input id="profile" value="default" maxlength="64" pattern="[a-zA-Z0-9_-]+"><label><input type="checkbox" id="replace"> Replace an existing connection for this profile</label><p class="steps">Use one profile for multiple apps in the same account. Create another profile for another account.</p>
<div class="grid"><section class="card"><h2>Apple App Store</h2><p>Apple uses API keys rather than a browser OAuth sign-in.</p><a class="link secondary" href="https://appstoreconnect.apple.com/access/integrations/api" target="_blank" rel="noreferrer">Open Apple API keys ↗</a><p class="steps">Users and Access → Integrations → Team Keys → “+”. Choose App Manager for metadata, screenshots, build uploads, TestFlight, review submissions and releases. An existing Admin key also works. Download the .p8 file; the Issuer ID appears above the key list. If API access is unavailable, the Account Holder must use Request Access on this page first.</p>
<label for="appleFile">Apple key (.p8)</label><input type="file" id="appleFile" accept=".p8"><label for="keyId">Key ID (filled from the filename when possible)</label><input id="keyId"><label for="keyType">Key type</label><select id="keyType"><option value="TEAM">Team key</option><option value="INDIVIDUAL">Individual key</option></select><small>Team keys come from Users and Access → Integrations → Team Keys and require Issuer ID, even for an individual developer account. Individual keys come from your user profile and inherit that user’s permissions and app access. API key type is separate from developer account type.</small><small>Team keys apply to every app on the team within the selected role. To limit access to specific apps, use an Individual API key from an App Manager user with the required app access. Upload an already signed .ipa; an API key does not sign builds. <a href="https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api" target="_blank" rel="noreferrer">Apple setup guide ↗</a></small><label for="issuer">Issuer ID (team keys)</label><input id="issuer"><button id="appleConnect">Verify and save Apple</button><button class="secondary" id="appleCheck">Check Apple access</button></section>
<section class="card"><h2>Google Play</h2><p>Connect with a service account. Complete these steps once; the plugin reuses the saved key afterwards.</p>
<ol class="steps"><li>Choose one Google Cloud project and enable <b>both APIs</b>:<br><a id="publisherLink" class="link secondary" href="https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com" target="_blank" rel="noreferrer">1. Android Publisher API ↗</a><a id="reportingLink" class="link secondary" href="https://console.cloud.google.com/apis/library/playdeveloperreporting.googleapis.com" target="_blank" rel="noreferrer">2. Play Developer Reporting API ↗</a><p>Publisher handles metadata, builds and releases. Reporting lists accessible apps without a package name. Click Enable on each page.</p></li>
<li><a id="serviceLink" class="link secondary" href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noreferrer">3. Create a service account ↗</a><p>Create service account → enter a name → Done. Cloud Owner/Editor roles are not required for Play access. Open the new account → Keys → Add key → Create new key → JSON. Download the file and select it below.</p></li>
<li><a class="link secondary" href="https://play.google.com/console/" target="_blank" rel="noreferrer">4. Open Play Console ↗</a><p>Select your developer account → Users and permissions → Invite new users. Enter the service account email from the JSON file. Under App permissions, select your apps and the permissions below, then choose Invite user.</p>
<details open><summary>Required Play Console permissions</summary><ul>
<li><b>View app information (read-only)</b> — read and discover selected apps. For all apps: Account permissions → <b>View app information and download bulk reports (read-only)</b>.</li>
<li><b>Manage store presence</b> — descriptions, localizations and screenshots.</li>
<li><b>Release apps to testing tracks</b> / <b>Release to testing tracks</b> — build uploads and test releases.</li>
<li><b>Manage testing tracks and edit tester lists</b> — testing track configuration and tester lists.</li>
<li><b>Release to production, exclude devices, and use Play App Signing</b> — production publishing and staged rollouts.</li>
<li><b>Edit and delete draft apps</b> — required when working with draft apps.</li>
</ul><p>For all current publishing workflows, grant the listed permissions on your target apps. These tools do not require financial, order, subscription, review or user-management permissions. <a href="https://developers.google.com/android-publisher/api-ref/rest/v3/grants" target="_blank" rel="noreferrer">Google permission reference ↗</a></p></details></li>
<li>Select the JSON file and click <b>Verify and save Google</b>. The wizard verifies the key and reads the app list before saving. If recent access changes are still propagating, wait a few minutes and retry.</li></ol>
<label for="googleFile">Service account key (.json)</label><input type="file" id="googleFile" accept=".json"><p id="googleIdentity" class="steps"></p><button id="googleConnect">Verify and save Google</button><button class="secondary" id="googleCheck">Check saved Google connection</button><small>App discovery verifies Reporting API access. Publisher API and release permissions are checked when those operations are used; setup does not create test releases.</small></section></div><div id="status" role="status">Ready to connect. Store credentials never leave this computer except to authenticate with Apple or Google.</div><ul id="apps"></ul><small>Changes are disabled by default. This window stays available while you create keys. Choose Finish setup when done. Restart the Codex task after connecting.</small><button class="secondary" id="finish">Finish setup</button></main>
<script nonce="__TOKEN__">const $=id=>document.getElementById(id);const token='__TOKEN__';history.replaceState(null,'','/');
async function post(path,data){$('status').textContent='Checking with the store…';$('apps').replaceChildren();for(const button of document.querySelectorAll('button'))button.disabled=true;try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','x-setup-token':token},body:JSON.stringify({profile:$('profile').value,replace:$('replace').checked,...data})});const result=await r.json();if(path.includes("google")||data.platform==="google")setGoogleProject(result.projectId,result.serviceEmail);if(r.ok&&path==='/connect/apple')appleDirty=false;if(r.ok&&path==='/connect/google')googleDirty=false;$('status').textContent=result.message||result.error||'Opening Google sign-in…';for(const app of result.apps||[]){const li=document.createElement('li');li.textContent=app.displayName+' — '+app.name.slice(5);$('apps').appendChild(li);}}catch{$('status').textContent='The local setup server is no longer running. Ask Codex to reopen App Publisher setup; your saved connections are preserved.'}finally{for(const button of document.querySelectorAll('button'))button.disabled=false}}
$('keyType').onchange=()=>{$('issuer').disabled=$('keyType').value==='INDIVIDUAL'};
$('finish').onclick=()=>post('/close',{});
$('appleFile').onchange=()=>{const match=$('appleFile').files[0]?.name.match(/AuthKey_([A-Za-z0-9]+)\\.p8$/);if(match)$('keyId').value=match[1]};
$('appleConnect').onclick=async()=>{const f=$('appleFile').files[0];if(!f){$('status').textContent='Choose the Apple .p8 file first.';return}await post('/connect/apple',{key:await f.text(),keyId:$('keyId').value,issuerId:$('issuer').value,keyType:$('keyType').value})};
$('googleConnect').onclick=async()=>{const f=$('googleFile').files[0];if(!f){$('status').textContent='Choose a Google JSON credential file first.';return}await post('/connect/google',{key:await f.text()})};
let appleDirty=false,googleDirty=false;
for(const id of ['appleFile','keyId','keyType','issuer'])$(id).addEventListener('change',()=>appleDirty=true);
function setGoogleProject(projectId,email){$('googleIdentity').textContent=email?'Email to invite in Play Console: '+email:'';for(const id of ['publisherLink','reportingLink','serviceLink']){const url=new URL($(id).href);url.search='';if(typeof projectId==='string'&&/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId))url.searchParams.set('project',projectId);$(id).href=url.href}}
$('googleFile').addEventListener('change',async()=>{googleDirty=true;const f=$('googleFile').files[0];$('googleIdentity').textContent='';if(!f)return;try{const key=JSON.parse(await f.text());if(key.type!=='service_account'){$('googleIdentity').textContent='Choose a service account JSON, not an OAuth client.';return}setGoogleProject(key.project_id,key.client_email)}catch{$('googleIdentity').textContent='Could not read the JSON file.'}});
$('appleCheck').onclick=()=>{if(appleDirty){$('status').textContent='Use Verify and save Apple for the selected key first. Select Replace connection if this profile already has a saved key.';return}post('/check',{platform:'apple'})};
$('googleCheck').onclick=()=>{if(googleDirty){$('status').textContent='Use Verify and save Google for the selected key first.';return}post('/check',{platform:'google'})};</script></html>`;
