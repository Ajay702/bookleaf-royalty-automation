// Privacy rules (brief A4): authors see only their own records, admins see everything, anonymous
// visitors see nothing. Each rule is a Bubble expression evaluated server-side on every read,
// so the isolation holds for searches, the Data API (non-admin tokens) and direct URL access.
import { pathToFileURL } from "node:url";
import { editorPage, write, read, X } from "./bubble-editor.mjs";

const isAdmin = X.currentUser(X.field("role_option_role", X.equals(X.option("role", "admin"))));
// Ownership by email: "This Book's owner_email is Current User's email".
const thisFieldIsMyEmail = (field) => X.thisThing(X.field(field, X.equals(X.currentUser(X.field("email")))));
const full = { view_all: true, search_for: true, view_attachments: true, auto_binding: false };

const RULES = {
  user: [["users_own_data", "User's own data", X.thisThing(X.equals(X.currentUser()))]],
  author: [["author_own_profile", "Author sees own profile", thisFieldIsMyEmail("email_text")]],
  book: [["author_own_books", "Author sees own books", thisFieldIsMyEmail("owner_email_text")]],
  payout: [["author_own_payouts", "Author sees own payouts", thisFieldIsMyEmail("owner_email_text")]],
  notificationlog: [],
  appsetting: [],
};

export async function applyPrivacy(page) {
  const [types] = await read(page, [["user_types"]]);
  const changes = [];
  for (const [type, own] of Object.entries(RULES)) {
    const fields = Object.keys(types[type]["%f3"] ?? {});
    const role = {
      everyone: {
        "%d": "everyone",
        permissions: {
          view_all: false, search_for: false, view_attachments: false, auto_binding: false,
          non_filterable_fields: Object.fromEntries([...fields, "Created Date", "Modified Date", "Slug", "Created By"].map((f) => [f, true])),
        },
      },
      admin_full_access: { "%d": "Admins see everything", "%c": isAdmin, permissions: full },
    };
    for (const [key, label, cond] of own) role[key] = { "%d": label, "%c": cond, permissions: full };
    changes.push([["user_types", type, "privacy_role"], role, "ChangeAppSetting"]);
  }
  await write(page, changes);
  const [after] = await read(page, [["user_types"]]);
  for (const t of Object.keys(RULES)) console.log(t, "→", Object.values(after[t].privacy_role).map((r) => r["%d"]).join(" | "));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { page } = await editorPage();
  await applyPrivacy(page);
  process.exit(0);
}
