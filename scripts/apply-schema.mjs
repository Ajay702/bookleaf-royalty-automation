// Applies the data model in bubble/schema.md to the Bubble app: option sets, data types, fields.
// Idempotent: writing the same path twice just overwrites it. Run: node scripts/apply-schema.mjs [--dry]
import { pathToFileURL } from "node:url";
import { editorPage, write, read, fieldKey } from "./bubble-editor.mjs";

const OPTION_SETS = {
  role: { name: "Role", attrs: {}, values: [["Author", "author"], ["Admin", "admin"]] },
  book_stage: {
    name: "BookStage",
    attrs: { is_published: "boolean", step: "number" },
    values: ["Manuscript Received", "Editing", "Cover Design", "Typesetting", "Proofreading", "ISBN Assignment",
      "Printing", "Distribution Setup", "Published & Live"].map((d, i) => [d, null, { is_published: d === "Published & Live", step: i + 1 }]),
  },
  royalty_status: {
    name: "RoyaltyStatus",
    attrs: { color: "text", sort: "number" },
    values: [["Overdue", null, { color: "#C62828", sort: 1 }], ["Pending", null, { color: "#B7791F", sort: 2 }],
      ["Paid Up", null, { color: "#2E7D32", sort: 3 }], ["In Production", null, { color: "#6B7280", sort: 4 }]],
  },
  payout_status: {
    name: "PayoutStatus",
    attrs: { color: "text", sort: "number" },
    values: [["Overdue", null, { color: "#C62828", sort: 1 }], ["Pending", null, { color: "#B7791F", sort: 2 }],
      ["Fully Paid", null, { color: "#2E7D32", sort: 3 }]],
  },
  print_partner: { name: "PrintPartner", attrs: {}, values: [["In-House"], ["Repro India"], ["Epitome Books"]] },
  platform: { name: "Platform", attrs: {}, values: [["Amazon India"], ["Flipkart"], ["Amazon US"], ["Amazon UK"], ["BookLeaf Store"]] },
  notify_status: {
    name: "NotifyStatus",
    attrs: { color: "text", is_final: "boolean" },
    values: [["Queued", null, { color: "#6B7280", is_final: false }], ["Processing", null, { color: "#1D4ED8", is_final: false }],
      ["Success", null, { color: "#2E7D32", is_final: true }], ["Failed", null, { color: "#C62828", is_final: true }],
      ["Duplicate", null, { color: "#B7791F", is_final: true }]],
  },
};

const T = { text: "text", num: "number", date: "date", bool: "boolean" };
const TYPES = {
  user: { name: "User", fields: [["role", "option.role"], ["author", "custom.author"], ["display_name", T.text]] },
  author: {
    name: "Author",
    fields: [
      ["author_code", T.text], ["name", T.text], ["email", T.text], ["phone", T.text], ["city", T.text],
      ["joined_date", T.date], ["user", "user"],
      ["total_books", T.num], ["published_books", T.num], ["total_copies", T.num],
      ["total_earned", T.num], ["total_paid", T.num], ["total_pending", T.num],
      ["last_payout_date", T.date], ["payout_status", "option.payout_status"], ["has_pending", T.bool],
    ],
  },
  book: {
    name: "Book",
    fields: [
      ["book_code", T.text], ["author", "custom.author"], ["owner", "user"], ["title", T.text], ["isbn", T.text],
      ["genre", T.text], ["stage", "option.book_stage"], ["status_text", T.text], ["is_published", T.bool],
      ["publication_date", T.date], ["mrp", T.num], ["royalty_per_copy", T.num],
      ["print_partner", "option.print_partner"], ["available_on", "list.option.platform"],
      ["copies_sold", T.num], ["royalty_earned", T.num], ["royalty_paid", T.num], ["royalty_pending", T.num],
      ["last_payout_date", T.date], ["royalty_status", "option.royalty_status"],
    ],
  },
  payout: {
    name: "Payout",
    fields: [["author", "custom.author"], ["owner", "user"], ["book", "custom.book"], ["amount", T.num],
      ["payout_date", T.date], ["note", T.text], ["is_backfill", T.bool]],
  },
  notificationlog: {
    name: "NotificationLog",
    fields: [
      ["author", "custom.author"], ["triggered_by", "user"], ["mode", T.text], ["status", "option.notify_status"],
      ["requested_at", T.date], ["completed_at", T.date], ["email_subject", T.text], ["email_body", T.text],
      ["email_sent", T.bool], ["email_recipient", T.text], ["error_message", T.text],
      ["n8n_execution_id", T.text], ["model", T.text], ["tokens_used", T.num],
    ],
  },
  appsetting: { name: "AppSetting", fields: [["as_of_date", T.date], ["last_recalc_at", T.date]] },
};

const slug = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function schemaChanges() {
  const changes = [];
  for (const [setKey, set] of Object.entries(OPTION_SETS)) {
    changes.push([["option_sets", setKey], { "%d": set.name, creation_source: "editor" }, "WriteOptionSet"]);
    for (const [attr, type] of Object.entries(set.attrs)) {
      changes.push([["option_sets", setKey, "attributes", attr], { "%d": attr, "%v": type, creation_source: "editor" }, "WriteOptionAttribute"]);
    }
    set.values.forEach(([display, db, attrs = {}], i) => {
      const dbValue = db ?? slug(display);
      // Stable, readable value keys ("bkl" prefix avoids clashing with editor-generated ids).
      changes.push([["option_sets", setKey, "values", `bkl${setKey.slice(0, 3)}${i}`],
        { "%d": display, db_value: dbValue, sort_factor: i + 1, ...attrs }, "WriteOptionValue"]);
    });
  }
  for (const [typeKey, type] of Object.entries(TYPES)) {
    if (typeKey !== "user") changes.push([["user_types", typeKey, "%d"], type.name]);
    for (const [name, vtype] of type.fields) {
      changes.push([["user_types", typeKey, "%f3", fieldKey(name, vtype)], { "%d": name, "%v": vtype }, "WriteCustomField"]);
    }
  }
  return changes;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const changes = schemaChanges();
  if (process.argv.includes("--dry")) {
    console.log(JSON.stringify(changes, null, 1));
    process.exit(0);
  }
  const { page } = await editorPage();
  // The scratch "name" field created while learning the editor format is superseded.
  // Remove the probe option value/attribute created by hand while learning the editor's format.
  await write(page, [[["option_sets", "role", "values", "bTGLo"], null], [["option_sets", "role", "attributes", "is_admin"], null]]);
  await write(page, changes);
  const [types, sets] = await read(page, [["user_types"], ["option_sets"]]);
  for (const [k, t] of Object.entries(TYPES)) {
    const have = Object.keys(types[k]?.["%f3"] ?? {});
    const missing = t.fields.map(([n, v]) => fieldKey(n, v)).filter((f) => !have.includes(f));
    console.log(`${t.name}: ${have.length} fields${missing.length ? `, MISSING ${missing}` : ""}`);
  }
  for (const [k, s] of Object.entries(OPTION_SETS)) console.log(`${s.name}: ${Object.keys(sets[k]?.values ?? {}).length} values`);
  process.exit(0);
}
