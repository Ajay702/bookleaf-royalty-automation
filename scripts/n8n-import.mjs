// Imports the two exported workflows into the logged-in n8n Cloud session (internal REST API, same-origin
// fetch from the n8n tab), swapping placeholder credential ids/addresses for this instance's values.
import fs from "node:fs";
import { chromium } from "playwright-core"; // run from the .pw helper folder (it has playwright-core)
const [repo, mail] = process.argv.slice(2);
const b = await chromium.connectOverCDP("http://127.0.0.1:9333");
const page = b.contexts()[0].pages().find((p) => p.url().includes("n8n.cloud"));
const api = (method, path, body) => page.evaluate(async ([method, path, body]) => {
  const r = await fetch("/rest" + path, { method, headers: { "content-type": "application/json", "browser-id": localStorage.getItem("n8n-browserId") || "" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}, [method, path, body]);

const creds = (await api("GET", "/credentials")).body.data;
const byType = Object.fromEntries(creds.map((c) => [c.type, { id: c.id, name: c.name }]));
const fix = (wf) => {
  let s = JSON.stringify(wf)
    .replaceAll("REPLACE-sender@example.com", mail)
    .replaceAll("REPLACE-your-test-inbox@example.com", mail)
    .replaceAll("REPLACE-ops-inbox@example.com", mail);
  const o = JSON.parse(s);
  for (const n of o.nodes) for (const t of Object.keys(n.credentials || {})) n.credentials[t] = byType[t];
  delete o.active; delete o.pinData;
  return o;
};
const existing = (await api("GET", "/workflows")).body.data || [];
async function upsert(wf) {
  const old = existing.find((w) => w.name === wf.name);
  if (old) { const r = await api("PATCH", `/workflows/${old.id}`, { ...wf, versionId: old.versionId }); return r; }
  return api("POST", "/workflows", wf);
}
const err = fix(JSON.parse(fs.readFileSync(`${repo}/n8n/bookleaf-error-alert.workflow.json`, "utf8")));
const e = await upsert(err);
console.log("error wf", e.status, e.body?.data?.id ?? e.body);
const main = fix(JSON.parse(fs.readFileSync(`${repo}/n8n/bookleaf-royalty-summary.workflow.json`, "utf8")));
main.settings.errorWorkflow = e.body.data.id;
const m = await upsert(main);
// n8n runs the *published* version; publishing the saved draft makes the import take effect.
const pub = await api("POST", `/workflows/${m.body.data.id}/activate`, { versionId: m.body.data.versionId });
console.log("published", pub.status, pub.body?.data?.activeVersionId === m.body.data.versionId);
console.log("main wf", m.status, m.body?.data?.id ?? JSON.stringify(m.body).slice(0, 400));
fs.writeFileSync(new URL("./n8n-ids.json", import.meta.url), JSON.stringify({ error: e.body.data?.id, main: m.body.data?.id, mainVersion: m.body.data?.versionId }));
process.exit(0);
