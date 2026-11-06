// Generates the n8n workflow exports from tested source (n8n/src). Run: node scripts/build-workflow.mjs
// Code nodes get the royalty library inlined, so the JSON is self-contained and importable as-is.
import fs from "node:fs";
import { SYSTEM_PROMPT } from "../n8n/src/prompt.js";

import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const lib = fs.readFileSync(`${root}n8n/src/royalty-lib.js`, "utf8").replace(/^export /gm, "");

const CRED = {
  webhook: { httpHeaderAuth: { id: "REPLACE_webhook_key", name: "BookLeaf webhook key" } },
  bubble: { httpHeaderAuth: { id: "REPLACE_bubble_token", name: "Bubble API token" } },
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
// link(a, b) connects a's output `out` (0 = main/success, 1 = error or IF-false) to b.
function link(from, to, out = 0) {
  connections[from] ??= { main: [] };
  while (connections[from].main.length <= out) connections[from].main.push([]);
  connections[from].main[out].push({ node: to, type: "main", index: 0 });
}
const code = (js) => ({ mode: "runOnceForAllItems", language: "javaScript", jsCode: js });
const retry = { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 };
const bubbleHeaders = { authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth" };
const cfg = (k) => `$('Config').first().json.${k}`;

// ── Main workflow ────────────────────────────────────────────────────────────
node("Webhook: royalty summary request", "n8n-nodes-base.webhook", 2, [0, 300], {
  httpMethod: "POST",
  path: "bookleaf-royalty-summary",
  authentication: "headerAuth",
  responseMode: "responseNode",
  options: {},
}, { webhookId: "6f1a1c3e-1b2b-4c55-9a1d-bookleafroyal", credentials: CRED.webhook });

node("Config", "n8n-nodes-base.set", 3.4, [220, 300], {
  mode: "manual",
  includeOtherFields: true,
  assignments: { assignments: [
    ["BUBBLE_API_BASE", "https://REPLACE-APP.bubbleapps.io/version-test/api/1.1"],
    ["MODEL", "claude-haiku-5-5"],
    ["EMAIL_FROM", "BookLeaf Author Relations <REPLACE@example.com>"],
    ["DEMO_RECIPIENT", "REPLACE-your-test-inbox@example.com"],
    ["SEND_TO_REAL_AUTHORS", "false"],
    ["DEDUPE_WINDOW_SECONDS", "120"],
  ].map(([name, value], i) => ({ id: `cfg-${i}`, name, value, type: "string" })) },
  options: {},
});

node("Validate & de-duplicate", "n8n-nodes-base.code", 2, [440, 300], code(`// 1) Validate the request body Bubble sent. 2) Drop duplicates: same author within the window.
// Workflow static data persists between production executions, so it works as a small dedupe store.
const req = $('Webhook: royalty summary request').first().json.body || {};
const windowMs = Number(${cfg("DEDUPE_WINDOW_SECONDS")}) * 1000;
const out = { log_id: req.log_id, author_id: req.author_id, request_id: req.request_id || req.log_id,
  triggered_by: req.triggered_by || 'unknown', mode: req.mode || 'single' };

if (!out.log_id || !out.author_id) {
  return [{ json: { ...out, ok: false, http: 400, reason: 'log_id and author_id are required' } }];
}
const store = $getWorkflowStaticData('global');
store.recent = store.recent || {};
const now = Date.now();
for (const [k, v] of Object.entries(store.recent)) if (now - v.at > windowMs) delete store.recent[k];
const prior = store.recent[out.author_id];
if (prior) {
  return [{ json: { ...out, ok: false, http: 409, duplicate_of: prior.log_id,
    reason: 'A summary for this author is already being generated (log ' + prior.log_id + ')' } }];
}
store.recent[out.author_id] = { at: now, log_id: out.log_id };
return [{ json: { ...out, ok: true, http: 202 } }];`));

node("Request valid?", "n8n-nodes-base.if", 2.2, [660, 300], {
  conditions: {
    options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
    conditions: [{ id: "ok", leftValue: "={{ $json.ok }}", rightValue: true,
      operator: { type: "boolean", operation: "true", singleValue: true } }],
    combinator: "and",
  },
  options: {},
});

node("Respond 400/409 (rejected)", "n8n-nodes-base.respondToWebhook", 1.1, [880, 480], {
  respondWith: "json",
  responseBody: "={{ JSON.stringify({ accepted: false, reason: $json.reason, duplicate_of: $json.duplicate_of || null }) }}",
  options: { responseCode: "={{ $json.http }}" },
});

node("Respond 202 (accepted)", "n8n-nodes-base.respondToWebhook", 1.1, [880, 200], {
  respondWith: "json",
  responseBody: "={{ JSON.stringify({ accepted: true, log_id: $json.log_id, execution_id: $execution.id }) }}",
  options: { responseCode: 202 },
});

const callbackBody = (status) => `={{ JSON.stringify({
  log: $('Validate & de-duplicate').first().json.log_id,
  status: ${status},
  execution_id: String($execution.id)
}) }}`;

node("Bubble: mark Processing", "n8n-nodes-base.httpRequest", 4.2, [1100, 200], {
  method: "POST",
  url: `={{ ${cfg("BUBBLE_API_BASE")} }}/wf/summary_callback`,
  ...bubbleHeaders,
  sendBody: true, specifyBody: "json",
  jsonBody: callbackBody("'Processing'"),
  options: { timeout: 15000 },
}, { credentials: CRED.bubble, onError: "continueRegularOutput", ...retry,
  notes: "Best effort: a failure here must not stop the run, the final callback still lands." });

const fetchNode = (name, x, url) => node(name, "n8n-nodes-base.httpRequest", 4.2, [x, 200], {
  method: "GET", url, ...bubbleHeaders, options: { timeout: 15000 },
}, { credentials: CRED.bubble, onError: "continueErrorOutput", ...retry, alwaysOutputData: false });

fetchNode("Bubble: get author", 1320,
  `={{ ${cfg("BUBBLE_API_BASE")} }}/obj/author/{{ $('Validate & de-duplicate').first().json.author_id }}`);
fetchNode("Bubble: get books", 1540,
  `={{ ${cfg("BUBBLE_API_BASE")} }}/obj/book?constraints={{ encodeURIComponent(JSON.stringify([{ key: 'author', constraint_type: 'equals', value: $('Validate & de-duplicate').first().json.author_id }])) }}&limit=100`);
fetchNode("Bubble: get payouts", 1760,
  `={{ ${cfg("BUBBLE_API_BASE")} }}/obj/payout?constraints={{ encodeURIComponent(JSON.stringify([{ key: 'author', constraint_type: 'equals', value: $('Validate & de-duplicate').first().json.author_id }])) }}&limit=100`);
fetchNode("Bubble: get settings", 1980, `={{ ${cfg("BUBBLE_API_BASE")} }}/obj/appsetting?limit=1`);

node("Build royalty facts", "n8n-nodes-base.code", 2, [2200, 200], code(`${lib}
// ── node logic ──
const SYSTEM_PROMPT = ${JSON.stringify(SYSTEM_PROMPT)};
const author = $('Bubble: get author').first().json.response;
const books = $('Bubble: get books').first().json.response.results;
const bookTitle = Object.fromEntries(books.map((b) => [b._id, b.title]));
const payouts = $('Bubble: get payouts').first().json.response.results
  .map((p) => ({ ...p, book_title: bookTitle[p.book] }))
  .sort((a, b) => String(a.payout_date).localeCompare(String(b.payout_date)));
const settings = ($('Bubble: get settings').first().json.response.results || [])[0] || {};
if (!author || !author.name) throw new Error('Author record missing from Bubble response');

const facts = buildFacts({ author, books, payouts, today: settings.as_of_date || new Date() });
return [{ json: {
  facts,
  recipient: ${cfg("SEND_TO_REAL_AUTHORS")} === 'true' ? author.email : ${cfg("DEMO_RECIPIENT")},
  author_email: author.email,
  author_name: author.name,
  anthropic_request: {
    model: ${cfg("MODEL")},
    max_tokens: 1200,
    temperature: 0.3,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: '<facts>\\n' + facts.text + '\\n</facts>\\n\\nWrite the royalty summary email.' }],
  },
} }];`), { onError: "continueErrorOutput" });

node("Claude: write summary email", "n8n-nodes-base.httpRequest", 4.2, [2420, 200], {
  method: "POST",
  url: "https://api.anthropic.com/v1/messages",
  authentication: "predefinedCredentialType",
  nodeCredentialType: "anthropicApi",
  sendHeaders: true,
  headerParameters: { parameters: [{ name: "anthropic-version", value: "2023-06-01" }] },
  sendBody: true, specifyBody: "json",
  jsonBody: "={{ JSON.stringify($json.anthropic_request) }}",
  options: { timeout: 60000 },
}, { credentials: CRED.anthropic, onError: "continueErrorOutput", retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 });

node("Parse & check email", "n8n-nodes-base.code", 2, [2640, 200], code(`${lib}
// ── node logic ──
// Guardrail: the email must greet by first name, state the real pending total, cover every
// in-production book, and quote no rupee amount that is not in the author's records.
const { facts } = $('Build royalty facts').first().json;
const res = $input.first().json;
const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
const v = parseAndValidate(text, facts);
return [{ json: { ...v, usage: res.usage || null, model: res.model || null, stop_reason: res.stop_reason } }];`),
{ onError: "continueErrorOutput" });

node("Email passes checks?", "n8n-nodes-base.if", 2.2, [2860, 200], {
  conditions: {
    options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
    conditions: [{ id: "valid", leftValue: "={{ $json.ok }}", rightValue: true,
      operator: { type: "boolean", operation: "true", singleValue: true } }],
    combinator: "and",
  },
  options: {},
});

node("Send email (SMTP)", "n8n-nodes-base.emailSend", 2.1, [3080, 100], {
  fromEmail: `={{ ${cfg("EMAIL_FROM")} }}`,
  toEmail: "={{ $('Build royalty facts').first().json.recipient }}",
  subject: "={{ $json.subject }}",
  emailFormat: "text",
  text: "={{ $json.body }}",
  options: { appendAttribution: false },
}, { credentials: CRED.smtp, onError: "continueRegularOutput",
  notes: "Bonus path. If SMTP fails the summary is still delivered to Bubble; email_sent=false records it." });

node("Build success payload", "n8n-nodes-base.code", 2, [3300, 100], code(`const email = $('Parse & check email').first().json;
const smtp = $input.first().json;
const built = $('Build royalty facts').first().json;
return [{ json: {
  log: $('Validate & de-duplicate').first().json.log_id,
  status: 'Success',
  subject: email.subject,
  body: email.body,
  email_sent: !smtp.error,
  email_recipient: built.recipient,
  error_message: smtp.error ? 'Summary generated, but SMTP send failed: ' + (smtp.error.message || smtp.error) : '',
  completed_at: new Date().toISOString(),
  model: email.model,
  tokens_used: email.usage ? (email.usage.input_tokens || 0) + (email.usage.output_tokens || 0) : 0,
  execution_id: String($execution.id),
} }];`));

node("Build failure payload", "n8n-nodes-base.code", 2, [3080, 420], code(`// Every error branch lands here. Turn whatever failed into one readable reason for the admin.
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
return [{ json: {
  log: $('Validate & de-duplicate').first().json.log_id,
  status: 'Failed',
  error_message: reason,
  failed_step: step,
  completed_at: new Date().toISOString(),
  execution_id: String($execution.id),
} }];`));

for (const [name, y] of [["Bubble: report Success", 100], ["Bubble: report Failed", 420]]) {
  node(name, "n8n-nodes-base.httpRequest", 4.2, [3520, y], {
    method: "POST",
    url: `={{ ${cfg("BUBBLE_API_BASE")} }}/wf/summary_callback`,
    ...bubbleHeaders,
    sendBody: true, specifyBody: "json",
    jsonBody: "={{ JSON.stringify($json) }}",
    options: { timeout: 20000 },
  }, { credentials: CRED.bubble, retryOnFail: true, maxTries: 4, waitBetweenTries: 3000,
    notes: "If this still fails after retries the execution errors, which fires the error workflow (admin alert email)." });
}

node("Release dedupe lock", "n8n-nodes-base.code", 2, [3740, 260], code(`// Free the author slot so a deliberate retry after completion is not treated as a duplicate.
const store = $getWorkflowStaticData('global');
const author = $('Validate & de-duplicate').first().json.author_id;
if (store.recent && store.recent[author] && store.recent[author].log_id === $('Validate & de-duplicate').first().json.log_id) delete store.recent[author];
return $input.all();`));

const sticky = (name, content, pos, w, h, color) => node(name, "n8n-nodes-base.stickyNote", 1, pos,
  { content, width: w, height: h, color });
sticky("Note: intake", "## 1 · Intake\nHeader-auth webhook (`X-BookLeaf-Key`). Validates payload, de-duplicates per author (static data, 120 s), answers Bubble **immediately** with 202 / 400 / 409 so the admin UI never waits on the AI.", [-40, 20], 1100, 260, 7);
sticky("Note: fetch", "## 2 · Fetch from Bubble Data API\nBubble is the source of truth, so n8n pulls the author, books, payouts and the as-of date by ID instead of trusting a payload. Each call retries 3× then routes to the failure path.", [1060, 20], 1100, 160, 5);
sticky("Note: ai", "## 3 · AI\nDeterministic facts (totals, payout dates, scenario) are computed in code; Claude only writes. The reply is checked for name, pending total, production updates and invented ₹ amounts.", [2160, 20], 900, 160, 6);
sticky("Note: callback", "## 4 · Output & status callback\nSMTP email (bonus) + POST to Bubble backend workflow `summary_callback` with Success/Failed, content and timestamp. All error branches converge on **Build failure payload**.", [3060, -100], 900, 160, 4);

link("Webhook: royalty summary request", "Config");
link("Config", "Validate & de-duplicate");
link("Validate & de-duplicate", "Request valid?");
link("Request valid?", "Respond 202 (accepted)", 0);
link("Request valid?", "Respond 400/409 (rejected)", 1);
link("Respond 202 (accepted)", "Bubble: mark Processing");
link("Bubble: mark Processing", "Bubble: get author");
link("Bubble: get author", "Bubble: get books");
link("Bubble: get books", "Bubble: get payouts");
link("Bubble: get payouts", "Bubble: get settings");
link("Bubble: get settings", "Build royalty facts");
link("Build royalty facts", "Claude: write summary email");
link("Claude: write summary email", "Parse & check email");
link("Parse & check email", "Email passes checks?");
link("Email passes checks?", "Send email (SMTP)", 0);
link("Email passes checks?", "Build failure payload", 1);
link("Send email (SMTP)", "Build success payload");
link("Build success payload", "Bubble: report Success");
link("Build failure payload", "Bubble: report Failed");
link("Bubble: report Success", "Release dedupe lock");
link("Bubble: report Failed", "Release dedupe lock");
for (const failing of ["Bubble: get author", "Bubble: get books", "Bubble: get payouts", "Bubble: get settings",
  "Build royalty facts", "Claude: write summary email", "Parse & check email"]) {
  link(failing, "Build failure payload", 1);
}

const main = {
  name: "BookLeaf · Royalty summary (Bubble → Claude → Bubble)",
  nodes, connections,
  settings: { executionOrder: "v1", saveManualExecutions: true, saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all", errorWorkflow: "REPLACE_with_error_workflow_id" },
  pinData: {}, active: false, tags: [],
};

// ── Error workflow: catches anything the main flow could not report itself ───────
const errorWf = {
  name: "BookLeaf · Automation error alert",
  nodes: [
    { parameters: {}, id: "e0000000-0000-4000-8000-000000000001", name: "Error Trigger",
      type: "n8n-nodes-base.errorTrigger", typeVersion: 1, position: [0, 0] },
    { parameters: {
      fromEmail: "BookLeaf Automations <REPLACE@example.com>",
      toEmail: "REPLACE-ops-inbox@example.com",
      subject: "=n8n failure: {{ $json.workflow.name }}",
      emailFormat: "text",
      text: "=Workflow: {{ $json.workflow.name }}\nFailed node: {{ $json.execution.lastNodeExecuted }}\nError: {{ $json.execution.error.message }}\nExecution: {{ $json.execution.url }}\n\nAny Notification Log row still 'Processing' for this run will show as 'Timed out' in Bubble after 10 minutes and can be retried.",
      options: { appendAttribution: false },
    }, id: "e0000000-0000-4000-8000-000000000002", name: "Email ops team", type: "n8n-nodes-base.emailSend",
    typeVersion: 2.1, position: [240, 0], credentials: CRED.smtp },
  ],
  connections: { "Error Trigger": { main: [[{ node: "Email ops team", type: "main", index: 0 }]] } },
  settings: { executionOrder: "v1" }, pinData: {}, active: false,
};

// ── Daily status refresh: badges depend on "today", and Bubble's free plan has no recurring workflows ──
const dailyWf = {
  name: "BookLeaf · Daily royalty status refresh",
  nodes: [
    { parameters: { rule: { interval: [{ field: "cronExpression", expression: "30 0 * * *" }] } },
      id: "d0000000-0000-4000-8000-000000000001", name: "Every day 06:00 IST", type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2, position: [0, 0] },
    { parameters: { method: "POST", url: "https://REPLACE-APP.bubbleapps.io/version-test/api/1.1/wf/recalc_all_statuses",
      ...bubbleHeaders, sendBody: true, specifyBody: "json", jsonBody: "{}", options: { timeout: 30000 } },
      id: "d0000000-0000-4000-8000-000000000002", name: "Bubble: recalc all statuses", type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [240, 0], credentials: CRED.bubble, retryOnFail: true, maxTries: 3, waitBetweenTries: 10000 },
  ],
  connections: { "Every day 06:00 IST": { main: [[{ node: "Bubble: recalc all statuses", type: "main", index: 0 }]] } },
  settings: { executionOrder: "v1", errorWorkflow: "REPLACE_with_error_workflow_id" }, pinData: {}, active: false,
};

fs.writeFileSync(`${root}n8n/bookleaf-royalty-summary.workflow.json`, JSON.stringify(main, null, 2));
fs.writeFileSync(`${root}n8n/bookleaf-error-alert.workflow.json`, JSON.stringify(errorWf, null, 2));
fs.writeFileSync(`${root}n8n/bookleaf-daily-status-refresh.workflow.json`, JSON.stringify(dailyWf, null, 2));
console.log(`main: ${nodes.length} nodes; wrote 3 workflow files`);
