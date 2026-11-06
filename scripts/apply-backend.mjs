// Backend (API) workflows, generated as code. See docs/README.md for what each one does and why.
import { pathToFileURL } from "node:url";
import { editorPage, write, read } from "./bubble-editor.mjs";
import { A, E, apiEvent, chain, op } from "./bubble-expr.mjs";

const B = { // Book field keys
  author: "author_custom_author", published: "is_published_boolean", pending: "royalty_pending_number",
  paid: "royalty_paid_number", earned: "royalty_earned_number", copies: "copies_sold_number",
  lastPayout: "last_payout_date_date", pubDate: "publication_date_date", status: "royalty_status_option_royalty_status",
};
const AU = { // Author field keys
  totalBooks: "total_books_number", published: "published_books_number", copies: "total_copies_number",
  earned: "total_earned_number", paid: "total_paid_number", pending: "total_pending_number",
  lastPayout: "last_payout_date_date", payout: "payout_status_option_payout_status", hasPending: "has_pending_boolean",
};
const L = { // NotificationLog field keys
  author: "author_custom_author", by: "triggered_by_user", mode: "mode_text", status: "status_option_notify_status",
  requested: "requested_at_date", completed: "completed_at_date", subject: "email_subject_text", body: "email_body_text",
  sent: "email_sent_boolean", recipient: "email_recipient_text", error: "error_message_text",
  exec: "n8n_execution_id_text", model: "model_text", tokens: "tokens_used_number", inFlight: "in_flight_boolean",
};

const author = E.param("author");
const books = (...extra) => E.search("book", [[B.author, "equals", author], ...extra]);
const published = [B.published, "equals", true];
const hasPending = [B.pending, "greater than", 0];
const cutoff = chain(E.param("as_of"), op.plusDays(-90)); // brief: overdue after 90 days without a payout
const sumOf = (field, ...extra) => chain(books(...extra), field, op.sum());
// Knowledge Base: balances under ₹1,000 roll over to the next quarter, so they are never "overdue".
const aboveThreshold = chain(books(hasPending), B.pending, op.sum(), op.gte(1000));

export const WORKFLOWS = [
  apiEvent({
    id: "bk_recalc_author", name: "recalc_author",
    params: [["author", "custom.author"], ["as_of", "date"]],
    actions: [
      A.changeThing("bk_ra_rollups", author, [
        [AU.totalBooks, chain(books(), op.count())],
        [AU.published, chain(books(published), op.count())],
        [AU.copies, sumOf(B.copies, published)],
        [AU.earned, sumOf(B.earned, published)],
        [AU.paid, sumOf(B.paid, published)],
        [AU.pending, sumOf(B.pending, published)],
        [AU.lastPayout, chain(books(published), B.lastPayout, op.max())],
        [AU.hasPending, chain(books(published, hasPending), op.count(), op.gt(0))],
      ]),
      A.changeList("bk_ra_inprod", "book", books([B.published, "equals", false]), [[B.status, E.option("royalty_status", "in_production")]]),
      A.changeList("bk_ra_paid", "book", books(published, [B.pending, "equals", 0]), [[B.status, E.option("royalty_status", "paid_up")]]),
      A.changeList("bk_ra_pending", "book", books(published, hasPending), [[B.status, E.option("royalty_status", "pending")]]),
      A.changeList("bk_ra_overdue_paid", "book", books(published, hasPending, [B.lastPayout, "less than", cutoff]),
        [[B.status, E.option("royalty_status", "overdue")]], aboveThreshold),
      A.changeList("bk_ra_overdue_never", "book",
        books(published, hasPending, [B.lastPayout, "is_empty"], [B.pubDate, "less than", cutoff]),
        [[B.status, E.option("royalty_status", "overdue")]], aboveThreshold),
      A.changeThing("bk_ra_status_paid", author, [[AU.payout, E.option("payout_status", "fully_paid")]]),
      A.changeThing("bk_ra_status_pending", author, [[AU.payout, E.option("payout_status", "pending")]],
        chain(books([B.status, "equals", E.option("royalty_status", "pending")]), op.count(), op.gt(0))),
      A.changeThing("bk_ra_status_overdue", author, [[AU.payout, E.option("payout_status", "overdue")]],
        chain(books([B.status, "equals", E.option("royalty_status", "overdue")]), op.count(), op.gt(0))),
    ],
  }),
  apiEvent({
    id: "bk_recalc_all", name: "recalc_all_statuses", expose: true,
    params: [["as_of", "date"]],
    actions: [
      A.changeThing("bk_rall_setting", chain(E.search("appsetting"), op.first()), [
        ["as_of_date_date", E.param("as_of")], ["last_recalc_at_date", E.now()],
      ]),
      A.scheduleOnList("bk_rall_schedule", "bk_recalc_author", "author", E.search("author"), {
        author: E.thisItem(), as_of: E.param("as_of"),
      }),
    ],
  }),
  apiEvent({
    // Called by n8n: once with status=Processing, then once with Success/Failed and the email content.
    id: "bk_summary_callback", name: "summary_callback", expose: true,
    params: [
      ["log", "custom.notificationlog"], ["status", "option.notify_status"],
      ["subject", "text", true], ["body", "text", true], ["email_sent", "boolean", true],
      ["email_recipient", "text", true], ["error_message", "text", true], ["completed_at", "date", true],
      ["execution_id", "text", true], ["model", "text", true], ["tokens_used", "number", true],
    ],
    actions: [
      // Never let a late/duplicate "Processing" overwrite a final Success/Failed.
      A.changeThing("bk_cb_update", E.param("log"), [
        [L.status, E.param("status")], [L.exec, E.param("execution_id")],
        [L.subject, E.param("subject")], [L.body, E.param("body")], [L.sent, E.param("email_sent")],
        [L.recipient, E.param("email_recipient")], [L.error, E.param("error_message")],
        [L.completed, E.param("completed_at")], [L.model, E.param("model")], [L.tokens, E.param("tokens_used")],
        [L.inFlight, chain(E.param("status"), op.equals(E.option("notify_status", "processing")))],
      ], chain(E.param("log"), L.inFlight, op.equals(true))),
    ],
  }),
  apiEvent({
    id: "bk_bulk_trigger", name: "bulk_trigger_summaries",
    params: [["triggered_by", "user"]],
    actions: [
      A.scheduleOnList("bk_bulk_schedule", "bk_trigger_summary", "author",
        E.search("author", [[AU.hasPending, "equals", true]]),
        { author: E.thisItem(), triggered_by: E.param("triggered_by"), mode: E.text("bulk") }),
    ],
  }),
];

export async function applyBackend(page, { remove = [] } = {}) {
  const changes = [];
  for (const key of remove) changes.push([["api", key], null]);
  for (const wf of WORKFLOWS) {
    changes.push([["api", wf.id], wf, "CreateEvent"]);
    changes.push([["_index", "id_to_path", wf.id], `api.${wf.id}`, "Update index"]);
  }
  await write(page, changes);
  const [api] = await read(page, [["api"]]);
  console.log(Object.values(api).map((w) => `${w["%p"].wf_name}: ${Object.keys(w.actions ?? {}).length} actions`).join("\n"));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { page } = await editorPage();
  // NotificationLog gets an in_flight flag used for idempotency (see trigger_summary).
  await write(page, [[["user_types", "notificationlog", "%f3", "in_flight_boolean"], { "%d": "in_flight", "%v": "boolean" }, "WriteCustomField"]]);
  await applyBackend(page, { remove: process.argv.slice(2) });
  process.exit(0);
}
