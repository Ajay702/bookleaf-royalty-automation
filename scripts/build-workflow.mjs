// Generates the n8n workflow exports from tested source (n8n/src). Run: node scripts/build-workflow.mjs
// Code nodes get the royalty library inlined, so the JSON is self-contained and importable as-is.
//
// Design (Bubble Free plan): Bubble cannot expose an API on Free, so n8n can neither query Bubble's
// Data API nor POST a callback into it. Bubble therefore sends the author's full payload in the webhook
// (option 2 of the brief's "Fetch Data" step) and n8n answers that same request with the final
// Success/Failed status, the generated email and a timestamp. Bubble writes that into the log.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { SYSTEM_PROMPT } from "../n8n/src/prompt.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const lib = fs.readFileSync(`${root}n8n/src/royalty-lib.js`, "utf8").replace(/^export /gm, "");

const CRED = {
  webhook: { httpHeaderAuth: { id: "REPLACE_webhook_key", name: "BookLeaf webhook key" } },
  anthropic: { anthropicApi: { id: "REPLACE_anthropic", name: "Anthropic account" } },
  smtp: { smtp: { id: "REPLACE_smtp", name: "SMTP account" } },
};

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const nodes = [];
const connections = {};
function node(name, type, typeVersion, position, parameters, extra = {}) {
  nodes.push({ parameters, id: id(), name, type, typeVersion, position, ...extra });
  return name;
}
// link(a, b, out): connect output `out` of a (0 = main/true, 1 = error output or IF-false) to b.
function link(from, to, out = 0) {
  connections[from] ??= { main: [] };
  while (connections[from].main.length <= out) connections[from].main.push([]);
  connections[from].main[out].push({ node: to, type: "main", index: 0 });
}
const code = (js) => ({ mode: "runOnceForAllItems", language: "javaScript", jsCode: js });
const cfg = (k) => `$('Config').first().json.${k}`;
const ifTrue = (expr) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
    conditions: [{ id: "c1", leftValue: `={{ ${expr} }}`, rightValue: true,
      operator: { type: "boolean", operation: "true", singleValue: true } }],
    combinator: "and",
  },
  options: {},
});
// Every reply carries the same 12 keys (blank when unused). Bubble's API Connector learns the response
// shape from one sample call, so a key missing from that sample could never be read later.
export const RESPONSE_SHAPE = { status: "", subject: "", body: "", email_sent: false, email_recipient: "", error_message: "",
  completed_at: "", model: "", tokens_used: 0, execution_id: "", failed_step: "", duplicate_of: "" };
const respond = (name, pos, codeExpr) => node(name, "n8n-nodes-base.respondToWebhook", 1.1, pos, {
  respondWith: "json",
  responseBody: `={{ JSON.stringify(Object.assign(${JSON.stringify(RESPONSE_SHAPE)}, $json.response)) }}`,
  options: { responseCode: `={{ $json.http }}` },
});

// ── Main workflow ────────────────────────────────────────────────────────────
node("Webhook: royalty summary request", "n8n-nodes-base.webhook", 2, [0, 300], {
  httpMethod: "POST", path: "bookleaf-royalty-summary", authentication: "headerAuth",
  responseMode: "responseNode", options: {},
}, { webhookId: "6f1a1c3e-1b2b-4c55-9a1d-b00c1eafr0ya", credentials: CRED.webhook,
  notes: "Header auth: requests without the shared X-BookLeaf-Key are rejected with 403 before any node runs." });

node("Config", "n8n-nodes-base.set", 3.4, [220, 300], {
  mode: "manual", includeOtherFields: true,
  assignments: { assignments: [
    ["MODEL", "claude-haiku-5-5"],
    ["EMAIL_FROM", "BookLeaf Author Relations <REPLACE-sender@example.com>"],
    ["DEMO_RECIPIENT", "REPLACE-your-test-inbox@example.com"],
    ["SEND_TO_REAL_AUTHORS", "false"],
    ["DEDUPE_WINDOW_SECONDS", "120"],
  ].map(([name, value], i) => ({ id: `cfg-${i}`, name, value, type: "string" })) },
  options: {},
}, { notes: "Non-secret settings. Secrets live in credentials, never here." });

node("Validate & de-duplicate", "n8n-nodes-base.code", 2, [440, 300], code(`// 1) Validate the payload Bubble sent. 2) Drop duplicates: same author already being processed.
// Workflow static data persists between production executions, so it serves as a small lock store.
const req = $('Webhook: royalty summary request').first().json.body || {};
const parse = (v) => (typeof v === 'string' ? JSON.parse(v || '[]') : (v || []));
const meta = { log_id: req.log_id, author_id: req.author_id, mode: req.mode || 'single', triggered_by: req.triggered_by || 'unknown' };
const reject = (http, status, error_message, extra = {}) => [{ json: { ok: false, http, ...meta,
  response: { status, error_message, failed_step: 'Validate & de-duplicate', completed_at: new Date().toISOString(), execution_id: String($execution.id), ...extra } } }];

let books, payouts;
try { books = parse(req.books); payouts = parse(req.payouts); }
catch (e) { return reject(400, 'Failed', 'books/payouts are not valid JSON: ' + e.message); }
const author = req.author || {};
const missing = ['log_id', 'author_id'].filter((k) => !req[k]);
if (!author.name) missing.push('author.name');
if (!Array.isArray(books) || books.length === 0) missing.push('books');
if (missing.length) return reject(400, 'Failed', 'Missing or empty: ' + missing.join(', '));

const store = $getWorkflowStaticData('global');
store.locks = store.locks || {};
const now = Date.now();
const windowMs = Number(${cfg("DEDUPE_WINDOW_SECONDS")}) * 1000;
for (const [k, v] of Object.entries(store.locks)) if (now - v.at > windowMs) delete store.locks[k];
const held = store.locks[meta.author_id];
if (held && held.log_id !== meta.log_id) {
  const why = held.sent ? 'was already sent ' + Math.round((now - held.at) / 1000) + ' s ago' : 'is already being generated';
  return reject(409, 'Duplicate', 'A summary for this author ' + why + ' (log ' + held.log_id + ')', { duplicate_of: held.log_id });
}
store.locks[meta.author_id] = { at: now, log_id: meta.log_id };
return [{ json: { ok: true, ...meta, author, books, payouts, as_of: req.as_of || null } }];`));

node("Request valid?", "n8n-nodes-base.if", 2.2, [660, 300], ifTrue("$json.ok"));
respond("Respond: rejected (400/409)", [880, 520]);

node("Build royalty facts", "n8n-nodes-base.code", 2, [880, 200], code(`${lib}
// ── node logic ──
const SYSTEM_PROMPT = ${JSON.stringify(SYSTEM_PROMPT)};
const req = $('Validate & de-duplicate').first().json;
const facts = buildFacts({ author: req.author, books: req.books, payouts: req.payouts, today: req.as_of || undefined });
return [{ json: {
  facts,
  recipient: ${cfg("SEND_TO_REAL_AUTHORS")} === 'true' ? req.author.email : ${cfg("DEMO_RECIPIENT")},
  anthropic_request: {
    model: ${cfg("MODEL")},
    max_tokens: 1500,
    thinking: { type: "disabled" }, // facts are precomputed; the model only writes
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: '<facts>\\n' + facts.text + '\\n</facts>\\n\\nWrite the royalty summary email.' }],
  },
} }];`), { onError: "continueErrorOutput" });

node("Claude: write summary email", "n8n-nodes-base.httpRequest", 4.2, [1100, 200], {
  method: "POST", url: "https://api.anthropic.com/v1/messages",
  authentication: "predefinedCredentialType", nodeCredentialType: "anthropicApi",
  sendHeaders: true, headerParameters: { parameters: [{ name: "anthropic-version", value: "2023-06-01" }] },
  sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify($json.anthropic_request) }}",
  options: { timeout: 25000 },
}, { credentials: CRED.anthropic, onError: "continueErrorOutput", retryOnFail: true, maxTries: 2, waitBetweenTries: 2000,
  notes: "25 s timeout × 2 tries keeps the whole run well inside Bubble's API Connector timeout." });

node("Parse & check email", "n8n-nodes-base.code", 2, [1320, 200], code(`${lib}
// ── node logic ──
// Guardrail: the email must greet by first name, state the real pending total, cover every
// in-production book, and quote no rupee amount that is not in the author's records.
const { facts } = $('Build royalty facts').first().json;
const res = $input.first().json;
const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
const v = parseAndValidate(text, facts);
return [{ json: { ...v, usage: res.usage || null, model: res.model || null } }];`), { onError: "continueErrorOutput" });

node("Email passes checks?", "n8n-nodes-base.if", 2.2, [1540, 200], ifTrue("$json.ok"));

node("Send email (SMTP)", "n8n-nodes-base.emailSend", 2.1, [1760, 100], {
  fromEmail: `={{ ${cfg("EMAIL_FROM")} }}`,
  toEmail: "={{ $('Build royalty facts').first().json.recipient }}",
  subject: "={{ $json.subject }}", emailFormat: "text", text: "={{ $json.body }}",
  options: { appendAttribution: false },
}, { credentials: CRED.smtp, onError: "continueRegularOutput",
  notes: "Bonus path. If SMTP fails the summary is still returned to Bubble and email_sent=false records it." });

node("Build success response", "n8n-nodes-base.code", 2, [1980, 100], code(`const email = $('Parse & check email').first().json;
const smtp = $input.first().json;
return [{ json: { http: 200, response: {
  status: 'Success',
  subject: email.subject,
  body: email.body,
  email_sent: !smtp.error,
  email_recipient: $('Build royalty facts').first().json.recipient,
  error_message: smtp.error ? 'Summary generated, but the SMTP send failed: ' + (smtp.error.message || smtp.error) : '',
  completed_at: new Date().toISOString(),
  model: email.model,
  tokens_used: email.usage ? (email.usage.input_tokens || 0) + (email.usage.output_tokens || 0) : 0,
  execution_id: String($execution.id),
} } }];`));

node("Build failure response", "n8n-nodes-base.code", 2, [1760, 420], code(`// Every error branch lands here, so nothing fails silently: one readable reason goes back to Bubble.
const item = $input.first().json;
const step = $prevNode.name;
let reason;
if (step === 'Email passes checks?') reason = 'AI email failed quality checks: ' + (item.problems || []).join('; ');
else if (item.error) {
  const e = item.error;
  const msg = typeof e === 'string' ? e : (e.message || JSON.stringify(e));
  const http = e.httpCode || e.status || (e.cause && e.cause.status) || '';
  reason = step + ' failed' + (http ? ' (HTTP ' + http + ')' : '') + ': ' + String(msg).slice(0, 300);
} else reason = step + ' failed for an unknown reason';
// HTTP 200 on purpose: the request itself was valid; the *outcome* is Failed, which Bubble logs.
return [{ json: { http: 200, response: {
  status: 'Failed', error_message: reason, failed_step: step, email_sent: false,
  completed_at: new Date().toISOString(), execution_id: String($execution.id),
} } }];`));

node("Release author lock", "n8n-nodes-base.code", 2, [2200, 260], code(`// After a successful send, keep the author's slot for the dedupe window so a double click or a client
// retry within it gets 409 instead of a second email. After a failure, free it so a deliberate retry works.
// n8n writes static data back when an execution ends, so two requests arriving in the same instant can both
// pass; Bubble's in-flight log guard covers that case.
const store = $getWorkflowStaticData('global');
store.locks = store.locks || {};
const { author_id, log_id } = $('Validate & de-duplicate').first().json;
const r = $input.first().json.response || {};
const ok = r.status === 'Success' && r.email_sent;
const mine = store.locks[author_id] && store.locks[author_id].log_id === log_id;
if (ok) store.locks[author_id] = { at: Date.now(), log_id, sent: true };
else if (mine) delete store.locks[author_id];
return $input.all();`));
respond("Respond: result", [2420, 260]);

const sticky = (name, content, pos, w, h, color) => node(name, "n8n-nodes-base.stickyNote", 1, pos, { content, width: w, height: h, color });
sticky("Note: intake", "## 1 · Intake\nHeader-auth webhook (`X-BookLeaf-Key`). Bubble sends the author's **full payload** (Bubble Free plan cannot expose a Data API). Payload is validated and de-duplicated per author; bad requests get 400, duplicates 409.", [-40, 0], 860, 240, 7);
sticky("Note: ai", "## 2 · AI\nDeterministic facts (totals, payout dates, overdue/threshold scenario) are computed in code; Claude only writes. Output is checked for name, pending total, production updates and invented ₹ amounts.", [840, 0], 880, 160, 6);
sticky("Note: output", "## 3 · Output & status\nSMTP email (bonus), then the **response to Bubble's request** carries status Success/Failed, the email, timestamp and execution id. Every error output converges on **Build failure response**.", [1740, -120], 900, 180, 4);

link("Webhook: royalty summary request", "Config");
link("Config", "Validate & de-duplicate");
link("Validate & de-duplicate", "Request valid?");
link("Request valid?", "Build royalty facts", 0);
link("Request valid?", "Respond: rejected (400/409)", 1);
link("Build royalty facts", "Claude: write summary email");
link("Claude: write summary email", "Parse & check email");
link("Parse & check email", "Email passes checks?");
link("Email passes checks?", "Send email (SMTP)", 0);
link("Email passes checks?", "Build failure response", 1);
link("Send email (SMTP)", "Build success response");
link("Build success response", "Release author lock");
link("Build failure response", "Release author lock");
link("Release author lock", "Respond: result");
for (const failing of ["Build royalty facts", "Claude: write summary email", "Parse & check email"]) link(failing, "Build failure response", 1);

const main = {
  name: "BookLeaf · Royalty summary (Bubble → Claude → Bubble)",
  nodes, connections,
  settings: { executionOrder: "v1", saveManualExecutions: true, saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all", errorWorkflow: "REPLACE_with_error_workflow_id" },
  pinData: {}, active: false, tags: [],
};

// ── Error workflow: catches anything the main flow could not answer itself ─────
const errorWf = {
  name: "BookLeaf · Automation error alert",
  nodes: [
    { parameters: {}, id: "e0000000-0000-4000-8000-000000000001", name: "Error Trigger",
      type: "n8n-nodes-base.errorTrigger", typeVersion: 1, position: [0, 0] },
    { parameters: {
      fromEmail: "BookLeaf Automations <REPLACE-sender@example.com>",
      toEmail: "REPLACE-ops-inbox@example.com",
      subject: "=n8n failure: {{ $json.workflow.name }}",
      emailFormat: "text",
      text: "=Workflow: {{ $json.workflow.name }}\nFailed node: {{ $json.execution.lastNodeExecuted }}\nError: {{ $json.execution.error.message }}\nExecution: {{ $json.execution.url }}\n\nBubble marks the matching Notification Log row Failed when its request errors or times out.",
      options: { appendAttribution: false },
    }, id: "e0000000-0000-4000-8000-000000000002", name: "Email ops team", type: "n8n-nodes-base.emailSend",
    typeVersion: 2.1, position: [240, 0], credentials: CRED.smtp },
  ],
  connections: { "Error Trigger": { main: [[{ node: "Email ops team", type: "main", index: 0 }]] } },
  settings: { executionOrder: "v1" }, pinData: {}, active: false,
};

fs.writeFileSync(`${root}n8n/bookleaf-royalty-summary.workflow.json`, JSON.stringify(main, null, 2));
fs.writeFileSync(`${root}n8n/bookleaf-error-alert.workflow.json`, JSON.stringify(errorWf, null, 2));
fs.rmSync(`${root}n8n/bookleaf-daily-status-refresh.workflow.json`, { force: true }); // needed Bubble's API (paid plans)
console.log(`main: ${nodes.length} nodes; wrote 2 workflow files`);
