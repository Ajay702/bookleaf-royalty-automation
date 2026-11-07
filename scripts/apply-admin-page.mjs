// Builds the admin page (brief A3) as code: author overview with filters, author detail with
// "Generate & Send Royalty Summary", bulk trigger, notification log, and the page workflows that call
// n8n through the API Connector. Element/expression formats were learned by reading back what the
// Bubble editor writes; see docs/README.md ("How this was built").
//   node scripts/apply-admin-page.mjs
import { editorPage, write, read } from "./bubble-editor.mjs";

const PAGE_KEY = "bTGMT"; // %p3 key of the "admin" page
const PAGE_ID = "admin";
const INDEX_PAGE = "bTGYf";
const DASHBOARD_PAGE = "dashboard";

// ── expression helpers ───────────────────────────────────────────────────────
const M = (nm, extra = {}) => ({ "%x": "Message", "%nm": nm, is_slidable: false, ...extra });
// chain(base, a, b) → base's a's b. Appends after any steps base already has (never overwrites them).
const chain = (base, ...steps) => {
  let node = null;
  for (const s of [...steps].reverse()) { const m = typeof s === "string" ? M(s) : s; node = node ? { ...m, "%n": node } : m; }
  if (!node) return base;
  const attach = (b) => (b["%n"] ? { ...b, "%n": attach(b["%n"]) } : { ...b, "%n": node });
  return attach(base);
};
const eq = (a) => M("equals", { "%a": a });
const neq = (a) => M("not_equals", { "%a": a });
const gt = (a) => M("greater_than", { "%a": a });
const lt = (a) => M("less_than", { "%a": a });
const and = (a) => M("and_", { "%a": a });
const plusMinutes = (n) => ({ "%x": "Message", "%nm": "plus_minutes", "%a": n, is_slidable: true });
const money = { "%x": "Message", "%nm": "format_number", is_slidable: true,
  "%p": { "%ft": "currency", decimal_place: 0, currency_symbol: "₹", thousand_separator: "comma" } };
const jsonSafe = M("format_json_encode");

const parent = () => ({ "%x": "ElementParent", is_slidable: false });
const el = (id) => ({ "%x": "GetElement", "%p": { "%ei": id }, is_slidable: false });
const input = (id) => chain(el(id), "get_data");
const state = (name) => chain(el(PAGE_ID), `custom.${name}`);
const now = () => ({ "%x": "PageData", "%p": { "%nm": "Current Date/Time" }, is_slidable: false });
const me = () => ({ "%x": "CurrentUser", is_slidable: false });
const opt = (set, v) => ({ "%x": "OptionValue", "%p": { option_set: `option.${set}`, option_value: v }, is_slidable: false });
const wfParam = (p) => ({ "%x": "CurrentWorkflowItem", "%p": { param_id: p }, is_slidable: false });
const step = (actionId) => ({ "%x": "PreviousStep", "%p": { "%ai": actionId }, is_slidable: false });
const search = (type, constraints = [], extra = {}) => ({
  "%x": "Search",
  "%p": { "%t5": `custom.${type}`, ...extra,
    ...(constraints.length ? { "%co": Object.fromEntries(constraints.map(([k, c, v], i) => [String(i), { "%k": k, "%c2": c, ...(v === undefined ? {} : { "%v": v }) }])) } : {}) },
});
const sorted = (expr, field, desc = false) => chain(expr, M("sorted", { "%p": { "%d2": desc, "%sf": field } }));
const T = (...parts) => ({ "%x": "TextExpression", "%e": Object.fromEntries(parts.map((p, i) => [String(i), p])) });
const formatAsText = (content, delimiter = ",") => ({ "%x": "Message", "%nm": "format_as_text", is_slidable: true,
  "%p": { "%c1": content, delimiter: T(delimiter) } });

const isAdmin = chain(me(), "role_option_role", eq(opt("role", "admin")));
const loggedIn = chain(me(), "logged_in");
const inFlight = (author) => chain(search("notificationlog", [
  ["author_custom_author", "equals", author], ["in_flight_boolean", "equals", true],
  ["requested_at_date", "greater than", chain(now(), plusMinutes(-10))],
]), "count");

// ── element helpers ──────────────────────────────────────────────────────────
const index = {}; // id → path, written to _index.id_to_path
function E(type, id, name, style, p = {}, children = [], states) {
  return { type, id, name, style, p, children, states };
}
// ctxType: the data type of the nearest typed ancestor. Bubble's "Parent group's thing" only reaches the
// immediate parent, so every intermediate group must pass the thing down (%ds = parent, %gt = type).
function build(node, path, order, ctxType = null) {
  const full = `${path}.%el.${node.id}`;
  index[node.id] = full;
  const p = { order, ...node.p };
  if (node.type === "Group" && ctxType && !p["%gt"]) { p["%ds"] = parent(); p["%gt"] = ctxType; }
  const childCtx = p["%gt"] ?? ctxType;
  const out = {
    "%x": node.type, id: node.id, "%nm": node.name, "%dn": `${node.type} ${node.id}`,
    ...(node.style ? { "%s1": node.style } : {}),
    "%p": p,
  };
  if (node.states) out["%s"] = Object.fromEntries(node.states.map((s, i) => [String(i), { "%x": "State", "%c": s.when, "%p": s.set }]));
  if (node.children.length) out["%el"] = Object.fromEntries(node.children.map((c, i) => [c.id, build(c, full, i, childCtx)]));
  return out;
}
const col = (gap = 16, extra = {}) => ({ container_layout: "column", use_gap: true, row_gap: gap, fit_height: true, ...extra });
const row = (gap = 16, extra = {}) => ({ container_layout: "row", use_gap: true, column_gap: gap, row_gap: gap, fit_height: true, ...extra });
const text = (id, name, style, expr, extra = {}) => E("Text", id, name, style, { "%3": expr, fit_height: true, ...extra });
const button = (id, label, style = "Button_navy_primary_", extra = {}) =>
  E("Button", id, `${label} Button`, style, { "%3": T(label), fit_width: true, fit_height: true, ...extra });
const hidden = { "%iv": false, collapse_when_hidden: true };
const spacer = { fit_width: false, fit_height: false, min_width_css: "8px", min_height_css: "1px", container_layout: "column" };
const showWhen = (when) => ({ when, set: { "%iv": true } });
const pill = (id, name, optionExpr) => E("HTML", id, name, "HTML_default_", {
  "%ht": T('<span style="display:inline-block;background:', chain(optionExpr, "color"),
    ';color:#fff;padding:4px 12px;border-radius:999px;font-family:Inter,sans-serif;font-size:13px;font-weight:600;white-space:nowrap">',
    chain(optionExpr, "display"), "</span>"),
  fit_height: true, single_width: true, min_width_css: "120px", min_height_css: "28px", vert_alignment: "center", ...hidden,
}, [], [showWhen(chain(optionExpr, "is_not_empty"))]);
const stat = (id, label, valueExpr) => E("Group", id, `${label} Card`, "Group_card_",
  col(4, { padding_top: 16, padding_bottom: 16, padding_left: 20, padding_right: 20, min_width_css: "180px" }), [
    text(`${id}_l`, `${label} Label`, "Text_label_muted_", T(label)),
    text(`${id}_v`, `${label} Value`, "Text_stat_navy_", valueExpr),
  ]);
const field = (id, label, expr) => E("Group", id, `${label} Field`, "Group_transparent_", col(2, { min_width_css: "110px" }), [
  text(`${id}_l`, `${label} Label`, "Text_label_muted_", T(label)),
  text(`${id}_v`, `${label} Value`, "Text_value_", expr),
]);

// ── page layout ──────────────────────────────────────────────────────────────
const authorsSearch = sorted(search("author", [
  ["name_text", "text contains", input("adm_name_search")],
  ["city_text", "equals", input("adm_city")],
  ["payout_status_option_payout_status", "equals", input("adm_status")],
], { ignore_empty_constraints: true }), "name_text");
const logs = (constraints = []) => sorted(search("notificationlog", constraints), "requested_at_date", true);
const stale = (log) => chain(log, "status_option_notify_status", eq(opt("notify_status", "processing")),
  and(chain(log, "requested_at_date", lt(chain(now(), plusMinutes(-3))))));

const logRow = (prefix, withAuthor) => E("Group", `${prefix}_card`, "Log Row", "Group_card_",
  { ...col(8, { padding_top: 14, padding_bottom: 14, padding_left: 18, padding_right: 18 }), "%ds": parent(), "%gt": "custom.notificationlog" }, [
    E("Group", `${prefix}_top`, "Log Top", "Group_transparent_", row(14, { vert_alignment: "center" }), [
      text(`${prefix}_when`, "Log When", "Text_value_", T(chain(parent(), "requested_at_date"))),
      ...(withAuthor ? [text(`${prefix}_author`, "Log Author", "Text_book_title_", T(chain(parent(), "author_custom_author", "name_text")))] : []),
      text(`${prefix}_mode`, "Log Mode", "Text_body_muted_", T(chain(parent(), "mode_text"))),
      pill(`${prefix}_status`, "Log Status", chain(parent(), "status_option_notify_status")),
      text(`${prefix}_stale`, "Log Stale", "Text_body_muted_", T("Timed out: no answer from n8n after 3 minutes. You can retry."), hidden),
      button(`${prefix}_toggle`, "View email", "Button_tab_", hidden),
    ].map((x) => (x.id === `${prefix}_toggle` ? { ...x, states: [showWhen(chain(parent(), "email_body_text", "is_not_empty"))] } : x))),
    text(`${prefix}_subject`, "Log Subject", "Text_body_16_", T(chain(parent(), "email_subject_text")), hidden),
    text(`${prefix}_error`, "Log Error", "Text_body_muted_", T("⚠ ", chain(parent(), "error_message_text")), hidden),
    text(`${prefix}_body`, "Log Body", "Text_body_14_", T(chain(parent(), "email_body_text"),
      "\n\n— sent to ", chain(parent(), "email_recipient_text"), " · ", chain(parent(), "model_text"), " · n8n execution ", chain(parent(), "n8n_execution_id_text")), hidden),
  ]);
// conditional visibility for subject/error/body
function withLogStates(group, prefix) {
  const set = (id, when) => { const c = findChild(group, id); c.states = [showWhen(when)]; };
  set(`${prefix}_subject`, chain(parent(), "email_subject_text", "is_not_empty"));
  set(`${prefix}_error`, chain(parent(), "error_message_text", "is_not_empty"));
  set(`${prefix}_body`, chain(state("expanded_log"), eq(parent())));
  set(`${prefix}_stale`, stale(parent()));
  return group;
}
function findChild(node, id) {
  if (node.id === id) return node;
  for (const c of node.children) { const r = findChild(c, id); if (r) return r; }
  return null;
}

const layout = [
  E("Group", "adm_header", "Header", "Group_header_bar_", row(16, { padding_top: 14, padding_bottom: 14, padding_left: 32, padding_right: 32, vert_alignment: "center" }), [
    text("adm_brand", "Brand", "Text_brand_navy_", T("BookLeaf · Operations")),
    E("Group", "adm_hdr_sp", "Header Spacer", "Group_transparent_", spacer),
    button("adm_logout", "Log out"),
  ]),
  E("Group", "adm_main", "Main", "Group_transparent_", col(20, { padding_top: 24, padding_bottom: 48, padding_left: 32, padding_right: 32, max_width_css: "1200px", horiz_alignment: "center" }), [
    text("adm_title", "Title", "Text_heading_navy_", T("Author royalties")),
    E("Group", "adm_stats", "Stats", "Group_transparent_", row(16), [
      stat("adm_stat_authors", "Authors", T(chain(search("author"), "count"))),
      stat("adm_stat_pending", "Total pending", T(chain(search("author"), "total_pending_number", "sum", money))),
      stat("adm_stat_overdue", "Authors overdue", T(chain(search("author", [["payout_status_option_payout_status", "equals", opt("payout_status", "overdue")]]), "count"))),
    ]),
    E("Group", "adm_toolbar", "Toolbar", "Group_transparent_", row(12, { vert_alignment: "center" }), [
      E("Input", "adm_name_search", "Name Search", "Input_standard_input_", { "%cf": "text", "%ps": T("Search author name"), min_width_css: "220px", single_height: true, min_height_css: "46px" }),
      E("Dropdown", "adm_city", "City Filter", "Dropdown_standard_dropdown_", {
        "%ds": chain(search("author"), "city_text", "unique"), "%ps": T("All cities"), dynamic_type: "text", choices_style: "dynamic",
        option_display_expression: T({ "%x": "InjectedValue", is_slidable: false }), min_width_css: "170px", single_height: true, min_height_css: "46px" }),
      E("Dropdown", "adm_status", "Status Filter", "Dropdown_standard_dropdown_", {
        "%ds": { "%x": "AllOptionValue", "%p": { option_set: "option.payout_status" }, is_slidable: false }, "%ps": T("All statuses"),
        dynamic_type: "option.payout_status", choices_style: "dynamic",
        option_display_expression: T(chain({ "%x": "InjectedValue", is_slidable: false }, "display")), min_width_css: "170px", single_height: true, min_height_css: "46px" }),
      button("adm_clear", "Clear filters", "Button_tab_"),
      E("Group", "adm_tb_sp", "Toolbar Spacer", "Group_transparent_", spacer),
      button("adm_recalc", "Recalculate statuses", "Button_tab_"),
      button("adm_bulk", "Send summaries to all with pending royalties"),
    ]),
    text("adm_bulk_status", "Bulk Status", "Text_body_muted_", T("Sending summaries… ", chain(state("bulk_queue"), "count"), " author(s) left in the queue."), hidden),
    text("adm_asof", "As Of", "Text_body_muted_", T("Statuses recalculated ", chain(search("appsetting"), "first_element", "last_recalc_at_date"),
      ". Red = pending and no payout for 90+ days; yellow = pending within the cycle (or under the ₹1,000 payout minimum); green = fully paid.")),
    E("RepeatingGroup", "adm_authors", "Authors List", "RepeatingGroup_transparent_", {
      "%ds": authorsSearch, "%gt": "custom.author", fit_height: true, fixed_rows: false, show_all_items: true,
      container_layout: "column", cell_min_height_css: "0px", "%sw": 12, "%ss": "solid", "%sc": "rgba(0,0,0,0)" }, [
      E("Group", "adm_a_card", "Author Row", "Group_card_", { ...row(18, { padding_top: 16, padding_bottom: 16, padding_left: 20, padding_right: 20, vert_alignment: "center" }), "%ds": parent(), "%gt": "custom.author" }, [
        E("Group", "adm_a_who", "Who", "Group_transparent_", col(2, { min_width_css: "200px" }), [
          text("adm_a_name", "Author Name", "Text_book_title_", T(chain(parent(), "name_text"))),
          text("adm_a_city", "Author City", "Text_body_muted_", T(chain(parent(), "city_text"), " · ", chain(parent(), "author_code_text"))),
        ]),
        field("adm_a_books", "Books", T(chain(parent(), "total_books_number"))),
        field("adm_a_earned", "Earned", T(chain(parent(), "total_earned_number", money))),
        field("adm_a_pending", "Pending", T(chain(parent(), "total_pending_number", money))),
        pill("adm_a_status", "Payout Status", chain(parent(), "payout_status_option_payout_status")),
        button("adm_a_view", "View"),
      ]),
    ]),
    E("Group", "adm_detail", "Author Detail", "Group_card_", {
      ...col(18, { padding_top: 24, padding_bottom: 24, padding_left: 24, padding_right: 24 }), ...hidden,
      "%ds": state("selected_author"), "%gt": "custom.author" }, [
      E("Group", "adm_d_head", "Detail Head", "Group_transparent_", row(16, { vert_alignment: "center" }), [
        E("Group", "adm_d_who", "Detail Who", "Group_transparent_", col(2), [
          text("adm_d_name", "Detail Name", "Text_heading_navy_", T(chain(parent(), "name_text"))),
          text("adm_d_meta", "Detail Meta", "Text_body_muted_", T(chain(parent(), "email_text"), " · ", chain(parent(), "city_text"), " · ", chain(parent(), "author_code_text"))),
        ]),
        E("Group", "adm_d_sp", "Detail Spacer", "Group_transparent_", spacer),
        button("adm_send", "Generate & Send Royalty Summary"),
        button("adm_d_close", "Close", "Button_tab_"),
      ]),
      text("adm_d_inflight", "In Flight", "Text_body_muted_", T("⏳ Generating the summary with n8n + Claude… this usually takes 5–15 seconds."), hidden),
      E("CustomElement", "adm_d_view", "author_royalty_view", null, { "%ci": "author_royalty_view", "%ds": parent(), fit_height: true }),
      text("adm_d_logs_t", "Detail Logs Title", "Text_heading_navy_", T("Summaries sent to this author")),
      E("RepeatingGroup", "adm_d_logs", "Author Logs", "RepeatingGroup_transparent_", {
        "%ds": logs([["author_custom_author", "equals", parent()]]), "%gt": "custom.notificationlog", fit_height: true,
        fixed_rows: false, show_all_items: true, container_layout: "column", cell_min_height_css: "0px", "%sw": 10, "%ss": "solid", "%sc": "rgba(0,0,0,0)" },
      [withLogStates(logRow("adm_dl", false), "adm_dl")]),
    ]),
    text("adm_log_t", "Log Title", "Text_heading_navy_", T("Notification log")),
    E("RepeatingGroup", "adm_logs", "Notification Log", "RepeatingGroup_transparent_", {
      "%ds": logs(), "%gt": "custom.notificationlog", fit_height: true, fixed_rows: false, show_all_items: true,
      container_layout: "column", cell_min_height_css: "0px", "%sw": 10, "%ss": "solid", "%sc": "rgba(0,0,0,0)" },
    [withLogStates(logRow("adm_l", true), "adm_l")]),
    E("CustomElement", "adm_engine", "royalty_engine", null, { "%ci": "royalty_engine", ...hidden }),
  ]),
];
// conditional visibility that depends on page state
findChild(layout[1], "adm_bulk_status").states = [showWhen(state("bulk_running"))]; // a yes/no is itself a condition
findChild(layout[1], "adm_detail").states = [showWhen(chain(state("selected_author"), "is_not_empty"))];
findChild(layout[1], "adm_d_inflight").states = [showWhen(chain(inFlight(parent()), gt(0)))];
findChild(layout[1], "adm_send").states = [{ when: chain(inFlight(parent()), gt(0)), set: { "%iv": false } }];

// ── workflows ────────────────────────────────────────────────────────────────
const wfs = {};
const wf = (id, name, type, p, actions) => {
  wfs[id] = { "%x": type, id, "%nm": name, "%p": p, actions: Object.fromEntries(actions.map((a, i) => [String(i), { id: `${id}_a${i}`, ...a }])) };
  index[id] = `%p3.${PAGE_KEY}.%wf.${id}`;
};
const setState = (name, value, when) => ({ "%x": "SetCustomState", "%p": { "%ei": PAGE_ID, custom_state: `custom.${name}`, ...(value === undefined ? {} : { "%v": value }), ...(when ? { "%c": when } : {}) } });
const go = (page, when) => ({ "%x": "ChangePage", "%p": { "%ei": page, ...(when ? { "%c": when } : {}) } });
const trigger = (event, args, when, delay) => ({
  "%x": delay ? "ScheduleCustom" : "TriggerCustomEvent",
  "%p": { custom_event: event, ...(delay ? { delay } : {}), ...(when ? { "%c": when } : {}),
    arguments: Object.fromEntries(Object.entries(args).map(([k, v], i) => [String(i), { param_id: k, arg_value: v }])) },
});
const recalcAll = { "%x": "TriggerCustomEventFromReusable", "%p": { "%ei": "adm_engine", custom_event: "re_wf_recalc_all",
  arguments: { 0: { param_id: "as_of", arg_value: now() } } } };
const fieldsOf = (pairs) => Object.fromEntries(pairs.map(([k, v], i) => [String(i), { "%k": k, "%v": v, "%ak": "=" }]));
const change = (thing, pairs, when) => ({ "%x": "ChangeThing", "%p": { "%tc": thing, "%cs": fieldsOf(pairs), ...(when ? { "%c": when } : {}) } });
const create = (type, pairs, when) => ({ "%x": "NewThing", "%p": { "%tt": `custom.${type}`, "%i2": Object.fromEntries(pairs.map(([k, v], i) => [String(i), { "%k": k, "%v": v }])), ...(when ? { "%c": when } : {}) } });

wf("adm_wf_guard_out", "Signed-out visitor goes to Index", "PageLoaded", { "%c": chain(me(), "not_logged_in") }, [go(INDEX_PAGE)]);
wf("adm_wf_guard_author", "Authors go to their dashboard", "PageLoaded",
  { "%c": chain(loggedIn, and(chain(me(), "role_option_role", neq(opt("role", "admin"))))) }, [go(DASHBOARD_PAGE)]);
wf("adm_wf_load_recalc", "Recalculate statuses on load", "PageLoaded", { "%c": isAdmin }, [recalcAll]);
wf("adm_wf_recalc", "Recalculate button", "ButtonClicked", { "%ei": "adm_recalc" }, [recalcAll]);
wf("adm_wf_logout", "Log out", "ButtonClicked", { "%ei": "adm_logout" }, [{ "%x": "LogOut" }, go(INDEX_PAGE)]);
wf("adm_wf_clear", "Clear filters (reload page)", "ButtonClicked", { "%ei": "adm_clear" }, [go(PAGE_ID)]);
wf("adm_wf_view", "Open author detail", "ButtonClicked", { "%ei": "adm_a_view" }, [setState("selected_author", parent())]);
wf("adm_wf_close", "Close author detail", "ButtonClicked", { "%ei": "adm_d_close" }, [setState("selected_author")]);
for (const p of ["adm_l", "adm_dl"]) {
  wf(`${p}_wf_toggle`, "Show / hide email", "ButtonClicked", { "%ei": `${p}_toggle` }, [
    setState("expanded_log", parent(), chain(state("expanded_log"), neq(parent()))),
    setState("expanded_log", undefined, chain(state("expanded_log"), eq(parent()))),
  ]);
}
wf("adm_wf_send", "Generate & Send (single author)", "ButtonClicked", { "%ei": "adm_send" },
  [trigger("adm_wf_send_summary", { author: parent(), mode: T("single") })]);

// Bulk: page-side queue (Free plan has no backend workflows). Same webhook, once per eligible author.
const queue = state("bulk_queue");
wf("adm_wf_bulk", "Bulk: queue every author with pending royalties", "ButtonClicked", { "%ei": "adm_bulk" }, [
  setState("bulk_queue", sorted(search("author", [["has_pending_boolean", "equals", true]]), "name_text")),
  setState("bulk_running", true),
  trigger("adm_wf_bulk_next", {}),
]);
wf("adm_wf_bulk_next", "Bulk: next author", "CustomEvent", { "%en": "bulk_next" }, [
  trigger("adm_wf_send_summary", { author: chain(queue, "first_element"), mode: T("bulk") }, chain(queue, "count", gt(0))),
  trigger("adm_wf_bulk_next", {}, chain(queue, "count", gt(1)), 1.5),
  setState("bulk_running", false, chain(queue, "count", lt(2))),
  setState("bulk_queue", chain(queue, M("minus_element", { "%a": chain(queue, "first_element") })), chain(queue, "count", gt(0))),
]);

// The single place that talks to n8n. Idempotent: refuses a second run for an author already in flight.
const author = wfParam("author");
const book = { "%x": "InjectedValue", is_slidable: false };
const bookJson = T(
  '{"title":', chain(book, "title_text", jsonSafe), ',"genre":', chain(book, "genre_text", jsonSafe),
  ',"status":', chain(book, "status_text_text", jsonSafe),
  ',"publication_date":"', chain(book, "publication_date_date"), '","mrp":"', chain(book, "mrp_number"),
  '","royalty_per_copy":"', chain(book, "royalty_per_copy_number"), '","copies_sold":"', chain(book, "copies_sold_number"),
  '","royalty_earned":"', chain(book, "royalty_earned_number"), '","royalty_paid":"', chain(book, "royalty_paid_number"),
  '","royalty_pending":"', chain(book, "royalty_pending_number"), '","last_payout_date":"', chain(book, "last_payout_date_date"), '"}');
const booksPayload = chain({ "%x": "ArbitraryText", is_slidable: false,
  "%p": { arbitrary_text: T("[", chain(search("book", [["author_custom_author", "equals", author]]), formatAsText(bookJson)), "]") } }, jsonSafe);
const call = "adm_wf_send_summary_a2";
const res = (f) => chain(step(call), `_api_c2_${f}`);
wf("adm_wf_send_summary", "Send summary via n8n", "CustomEvent", {
  "%en": "send_summary",
  parameters: { 0: { param_id: "author", param_name: "author", btype_id: "custom.author", is_list: false, optional: false },
    1: { param_id: "mode", param_name: "mode", btype_id: "text", is_list: false, optional: false } },
}, [
  create("notificationlog", [["author_custom_author", author], ["triggered_by_user", me()], ["mode_text", T(wfParam("mode"))],
    ["status_option_notify_status", opt("notify_status", "processing")], ["requested_at_date", now()], ["in_flight_boolean", true]],
  chain(inFlight(author), eq(0))),
  create("notificationlog", [["author_custom_author", author], ["triggered_by_user", me()], ["mode_text", T(wfParam("mode"))],
    ["status_option_notify_status", opt("notify_status", "duplicate")], ["requested_at_date", now()], ["completed_at_date", now()],
    ["in_flight_boolean", false], ["error_message_text", T("Skipped: a summary for this author is already being generated.")]],
  chain(inFlight(author), gt(0))),
  { "%x": "apiconnector2-n8n.trigger_summary", "%p": {
    "%c": chain(step("adm_wf_send_summary_a0"), "is_not_empty"),
    "headers_Content-Type": T("application/json"),
    body_params_log_id: T(chain(step("adm_wf_send_summary_a0"), "_id")),
    body_params_author_id: T(chain(author, "_id")),
    body_params_mode: T(wfParam("mode")),
    body_params_triggered_by: T(chain(me(), "email")),
    body_params_as_of: T(""),
    body_params_author_name: T(chain(author, "name_text", jsonSafe)),
    body_params_author_email: T(chain(author, "email_text", jsonSafe)),
    body_params_author_city: T(chain(author, "city_text", jsonSafe)),
    body_params_joined_date: T(chain(author, "joined_date_date")),
    body_params_books: T(booksPayload),
    body_params_payouts: T('"[]"'),
  } },
  change(step("adm_wf_send_summary_a0"), [
    ["status_option_notify_status", opt("notify_status", "success")], ["email_subject_text", T(res("subject"))],
    ["email_body_text", T(res("body"))], ["email_sent_boolean", res("email_sent")], ["email_recipient_text", T(res("email_recipient"))],
    ["error_message_text", T(res("error_message"))], ["completed_at_date", now()], ["model_text", T(res("model"))],
    ["tokens_used_number", res("tokens_used")], ["n8n_execution_id_text", T(res("execution_id"))], ["in_flight_boolean", false],
  ], chain(step("adm_wf_send_summary_a0"), "is_not_empty", and(chain(res("status"), eq(T("Success")))))), // an HTTP error leaves status empty
  change(step("adm_wf_send_summary_a0"), [
    ["status_option_notify_status", opt("notify_status", "failed")], ["error_message_text", T(res("failed_step"), ": ", res("error_message"))],
    ["completed_at_date", now()], ["n8n_execution_id_text", T(res("execution_id"))], ["in_flight_boolean", false],
  ], chain(step("adm_wf_send_summary_a0"), "is_not_empty", and(chain(res("status"), "is_not_empty", and(chain(res("status"), neq(T("Success")))))))),
  change(step("adm_wf_send_summary_a0"), [
    ["status_option_notify_status", opt("notify_status", "failed")],
    ["error_message_text", T("n8n request failed (HTTP ", res("error.status_code"), "): ", res("error.body"))],
    ["completed_at_date", now()], ["in_flight_boolean", false],
  ], chain(step("adm_wf_send_summary_a0"), "is_not_empty", and(res("returned_an_error")))),
  change(step("adm_wf_send_summary_a0"), [["status_option_notify_status", opt("notify_status", "duplicate")]],
    chain(step("adm_wf_send_summary_a0"), "is_not_empty", and(chain(res("error.status_code"), eq(409))))),
]);

// ── write ────────────────────────────────────────────────────────────────────
const { page } = await editorPage();
const [old] = await read(page, [["%p3", PAGE_KEY]]);
const oldIds = new Set();
(function collect(n) { if (n && typeof n === "object") { if (n.id) oldIds.add(n.id); Object.values(n).forEach(collect); } })(old);

const pageObj = {
  ...old,
  "%p": { ...old["%p"], "%t1": T("BookLeaf · Admin"), backdrop_bgcolor: "rgba(244, 246, 248, 1)", backdrop_background_style: "bgcolor", row_gap: 0 },
  custom_states: {
    selected_author: { "%d": "selected_author", "%v": "custom.author", rank: 0, make_static: true },
    expanded_log: { "%d": "expanded_log", "%v": "custom.notificationlog", rank: 1, make_static: true },
    bulk_queue: { "%d": "bulk_queue", "%v": "list.custom.author", rank: 2, make_static: true },
    bulk_running: { "%d": "bulk_running", "%v": "boolean", rank: 3, make_static: true },
  },
  "%el": Object.fromEntries(layout.map((n, i) => [n.id, build(n, `%p3.${PAGE_KEY}`, i)])),
  "%wf": wfs,
};
const stale_ids = [...oldIds].filter((id) => id !== PAGE_ID && !index[id]);
await write(page, [
  [["%p3", PAGE_KEY], pageObj, "ChangeAppSetting"],
  ...stale_ids.map((id) => [["_index", "id_to_path", id], null, "Update index"]),
  ...Object.entries(index).map(([id, path]) => [["_index", "id_to_path", id], path, "Update index"]),
]);
console.log(`admin page: ${Object.keys(index).length} elements+workflows written, ${stale_ids.length} stale index entries removed`);
process.exit(0);
