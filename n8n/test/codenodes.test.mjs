// Runs the generated Code-node source with mocked n8n globals, so the exported JSON is what's tested.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const wf = JSON.parse(fs.readFileSync(new URL("../bookleaf-royalty-summary.workflow.json", import.meta.url)));
const data = JSON.parse(fs.readFileSync(new URL("../../bubble/bookleaf_sample_data.json", import.meta.url)));
const src = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;
const config = { MODEL: "claude-haiku-5-5", DEMO_RECIPIENT: "demo@x.com", SEND_TO_REAL_AUTHORS: "false", DEDUPE_WINDOW_SECONDS: "120" };

function run(name, outputs, { input = {}, prevNode = "", store = {} } = {}) {
  const $ = (n) => ({ first: () => ({ json: outputs[n] }) });
  const fn = new Function("$", "$input", "$getWorkflowStaticData", "$execution", "$prevNode", src(name));
  return fn($, { first: () => ({ json: input }), all: () => [{ json: input }] }, () => store, { id: 42 }, { name: prevNode })[0].json;
}

// What Bubble's API Connector sends (books/payouts arrive as JSON text built with :format as text).
function bubblePayload(code, logId = "L1") {
  const a = data.authors.find((x) => x.author_id === code);
  return {
    log_id: logId, author_id: `bubble-${code}`, mode: "single", triggered_by: "admin@bookleaf.test",
    as_of: "2026-11-07",
    author: { name: a.name, email: a.email, city: a.city, joined_date: a.joined_date },
    books: JSON.stringify(a.books.map((b) => ({
      title: b.title, genre: b.genre, status: b.status, publication_date: b.publication_date, mrp: b.mrp,
      royalty_per_copy: b.author_royalty_per_copy, copies_sold: b.total_copies_sold, royalty_earned: b.total_royalty_earned,
      royalty_paid: b.royalty_paid, royalty_pending: b.royalty_pending, last_payout_date: b.last_royalty_payout_date,
      available_on: b.available_on,
    }))),
    payouts: "[]",
  };
}
const validate = (body, store = {}) => run("Validate & de-duplicate", { Config: config, "Webhook: royalty summary request": { body } }, { store });

test("validate: rejects incomplete payloads with 400", () => {
  const out = validate({ log_id: "L1" });
  assert.equal(out.http, 400);
  assert.match(out.response.error_message, /author_id/);
  assert.equal(validate({ ...bubblePayload("AUTH001"), books: "{not json" }).http, 400);
});

test("validate: second request for the same author is a 409 duplicate", () => {
  const store = {};
  assert.equal(validate(bubblePayload("AUTH001", "L1"), store).ok, true);
  const dup = validate(bubblePayload("AUTH001", "L2"), store);
  assert.equal(dup.http, 409);
  assert.equal(dup.response.status, "Duplicate");
  assert.equal(dup.response.duplicate_of, "L1");
});

test("release: success keeps the author blocked for the window, failure frees it", () => {
  const release = (store, logId, response) => run("Release author lock",
    { "Validate & de-duplicate": { author_id: "bubble-AUTH001", log_id: logId } }, { input: { response }, store });
  const sent = {};
  validate(bubblePayload("AUTH001", "L1"), sent);
  release(sent, "L1", { status: "Success", email_sent: true });
  const again = validate(bubblePayload("AUTH001", "L2"), sent);
  assert.equal(again.http, 409);
  assert.match(again.response.error_message, /already sent/);

  const failed = {};
  validate(bubblePayload("AUTH001", "L1"), failed);
  release(failed, "L1", { status: "Failed" });
  assert.equal(validate(bubblePayload("AUTH001", "L2"), failed).ok, true);
});

test("full chain with a mocked Claude reply returns Success to Bubble", () => {
  const v = validate(bubblePayload("AUTH007"));
  const built = run("Build royalty facts", { Config: config, "Validate & de-duplicate": v });
  assert.equal(built.anthropic_request.model, "claude-haiku-5-5");
  assert.match(built.facts.text, /Midnight in Mysore/);
  assert.equal(built.recipient, "demo@x.com");

  const reply = { model: "claude-haiku-5-5", usage: { input_tokens: 900, output_tokens: 300 }, content: [{ type: "text",
    text: "<subject>Your royalty summary</subject><body>Dear Sneha,\nTotal pending: ₹7,865. Midnight in Mysore is in cover design.\nWarm regards,\nBookLeaf Author Relations</body>" }] };
  const checked = run("Parse & check email", { "Build royalty facts": built }, { input: reply });
  assert.equal(checked.ok, true, checked.problems?.join("; "));

  const ok = run("Build success response", { "Parse & check email": checked, "Build royalty facts": built }, { input: {} });
  assert.equal(ok.response.status, "Success");
  assert.equal(ok.response.email_sent, true);
  assert.equal(ok.response.tokens_used, 1200);
});

test("failure response names the failing step", () => {
  const out = run("Build failure response", {}, { input: { error: { message: "timeout", httpCode: 529 } }, prevNode: "Claude: write summary email" });
  assert.equal(out.http, 200);
  assert.equal(out.response.status, "Failed");
  assert.match(out.response.error_message, /Claude: write summary email failed \(HTTP 529\)/);
});
