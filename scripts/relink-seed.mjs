// One-off repair: the first seeding wrote link fields as bare record ids, which Bubble stores as plain
// strings, so "Search for Books where author = X" matched nothing. Rewrites them as real links.
import { editorPage } from "./bubble-editor.mjs";
import { listThings, modifyThing, ref } from "./bubble-data.mjs";

const { page } = await editorPage();
const plan = { book: ["author_custom_author"], payout: ["author_custom_author", "book_custom_book"] };
for (const [type, fields] of Object.entries(plan)) {
  const rows = await listThings(page, type, fields);
  let fixed = 0;
  for (const row of rows) {
    const changes = Object.fromEntries(fields.filter((f) => row[f] && !String(row[f]).includes("__LOOKUP__")).map((f) => [f, ref(row[f])]));
    if (Object.keys(changes).length) { await modifyThing(page, row._id, changes); fixed++; }
  }
  console.log(`${type}: ${rows.length} records, ${fixed} relinked`);
}
process.exit(0);
