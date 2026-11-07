// API Connector call Bubble → n8n (Free-plan design): sends the author's full royalty payload and
// declares the fields n8n returns. String params are sent pre-encoded with :formatted as JSON-safe,
// so the template leaves them unquoted. The header value (shared secret) is pasted by hand, never here.
import { editorPage, write, read } from "./bubble-editor.mjs";
const base = ["settings", "client_safe", "apiconnector2", "n8n", "calls", "trigger_summary"];
const template = JSON.stringify({
  log_id: "<log_id>", author_id: "<author_id>", mode: "<mode>", triggered_by: "<triggered_by>", as_of: "<as_of>",
  author: { name: "<author_name>", email: "<author_email>", city: "<author_city>", joined_date: "<joined_date>" },
  books: "<books>", payouts: "<payouts>",
}).replace(/"<(author_name|author_email|author_city|books|payouts)>"/g, "<$1>");
// Sample values used when the call is (re)initialized in the editor: one real book, so n8n answers with a
// full Success reply and Bubble learns every response field.
const SAMPLE_BOOK = { title: "Whispers of the Ganges", genre: "Literary Fiction", status: "Published & Live",
  publication_date: "2023-06-20", mrp: 399, royalty_per_copy: 35, copies_sold: 342, royalty_earned: 11970,
  royalty_paid: 8400, royalty_pending: 3570, last_payout_date: "2025-10-15", available_on: ["Amazon India", "Flipkart"] };
const params = [
  ["log_id", "init-call"], ["author_id", "init-call"], ["mode", "single"], ["triggered_by", "admin@bookleaf.test"],
  ["as_of", "2026-11-07"], ["author_name", '"Priya Sharma"'], ["author_email", '"priya.sharma@email.com"'],
  ["author_city", '"Mumbai"'], ["joined_date", "2023-03-15"], ["books", JSON.stringify(JSON.stringify([SAMPLE_BOOK]))], ["payouts", '"[]"'],
];
// "Include errors in response" makes Bubble nest the reply under body.* (keys as the editor's Initialize writes them).
const field = (name, type) => [`_api_c2_body.${name}`, { ret_btype: type, caption: `body ${name}`, path: ["body", name] }];
const fields = Object.fromEntries([
  field("status", "text"), field("subject", "text"), field("body", "text"), field("email_sent", "boolean"),
  field("email_recipient", "text"), field("error_message", "text"), field("completed_at", "text"), field("model", "text"),
  field("tokens_used", "number"), field("execution_id", "text"), field("failed_step", "text"), field("duplicate_of", "text"),
  ["_api_c2_returned_an_error", { ret_btype: "boolean", caption: "returned_an_error", path: ["returned_an_error"] }],
  ["_api_c2_error.status_code", { ret_btype: "number", caption: "error status_code", path: ["error", "status_code"] }],
  ["_api_c2_error.status_message", { ret_btype: "text", caption: "error status_message", path: ["error", "status_message"] }],
  ["_api_c2_error.body", { ret_btype: "text", caption: "error body", path: ["error", "body"] }],
]);
const { page } = await editorPage();
await write(page, [
  [[...base, "%b3"], template, "ChangeAppSetting"],
  [[...base, "body_params"], Object.fromEntries(params.map(([k, v], i) => [`b${i}`, { "%k": k, "%v": v, private: false }])), "ChangeAppSetting"],
  [[...base, "types"], JSON.stringify({ "n8n.trigger_summary": { caption: "trigger_summary", fields } }), "ChangeAppSetting"],
]);
const [call] = await read(page, [base]);
console.log(call["%b3"]);
console.log(Object.values(call.body_params).map((p) => p["%k"]).join(", "));
process.exit(0);
