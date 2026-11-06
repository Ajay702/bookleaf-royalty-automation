// Runs the generated Code-node source with mocked n8n globals, so the exported JSON is tested, not just the lib.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const wf = JSON.parse(fs.readFileSync(new URL("../bookleaf-royalty-summary.workflow.json", import.meta.url)));
const data = JSON.parse(fs.readFileSync(new URL("../../bubble/bookleaf_sample_data.json", import.meta.url)));
const src = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;
function run(name, nodesOut, input = {}, prevNode = "") {
  const $ = (n) => ({ first: () => ({ json: nodesOut[n] }) });
  const fn = new Function("$", "$input", "$getWorkflowStaticData", "$execution", "$prevNode", src(name));
  return fn($, { first: () => ({ json: input }), all: () => [{ json: input }] }, () => ({}), { id: 42 }, { name: prevNode });
}
const config = { BUBBLE_API_BASE: "x", MODEL: "claude-haiku-5-5", DEMO_RECIPIENT: "demo@x.com", SEND_TO_REAL_AUTHORS: "false", DEDUPE_WINDOW_SECONDS: "120" };

test("validate node rejects missing fields and dedupes", () => {
  const fn = new Function("$", "$getWorkflowStaticData", src("Validate & de-duplicate"));
  const store = {};
  const call = (body) => fn((n) => ({ first: () => ({ json: n === "Config" ? config : { body } }) }), () => store)[0].json;
  assert.equal(call({}).http, 400);
  assert.equal(call({ log_id: "L1", author_id: "A1" }).http, 202);
  const dup = call({ log_id: "L2", author_id: "A1" });
  assert.equal(dup.http, 409); assert.equal(dup.duplicate_of, "L1");
});

test("facts node builds a Claude request from Bubble-shaped records", () => {
  const a = data.authors.find((x) => x.author_id === "AUTH007");
  const books = a.books.map((b, i) => ({ ...b, _id: "b" + i, author: "A7", copies_sold: b.total_copies_sold,
    royalty_earned: b.total_royalty_earned, royalty_per_copy: b.author_royalty_per_copy, last_payout_date: b.last_royalty_payout_date }));
  const out = run("Build royalty facts", {
    Config: config,
    "Bubble: get author": { response: { ...a, books: undefined } },
    "Bubble: get books": { response: { results: books } },
    "Bubble: get payouts": { response: { results: [{ amount: 35000, payout_date: "2025-11-15", book: "b0" }] } },
    "Bubble: get settings": { response: { results: [] } },
  })[0].json;
  assert.equal(out.recipient, "demo@x.com");
  assert.equal(out.anthropic_request.model, "claude-haiku-5-5");
  assert.match(out.facts.text, /Midnight in Mysore/);
  assert.match(out.facts.text, /₹35,000 on 15 November 2025 for "The Algorithm of Love"/);
  fs.writeFileSync(new URL("./sample-facts-AUTH007.txt", import.meta.url), out.facts.text);
});

test("failure node explains the failing step", () => {
  const out = run("Build failure payload", { "Validate & de-duplicate": { log_id: "L9" } },
    { error: { message: "timeout", httpCode: 503 } }, "Claude: write summary email")[0].json;
  assert.equal(out.status, "Failed");
  assert.match(out.error_message, /Claude: write summary email failed \(HTTP 503\)/);
});
