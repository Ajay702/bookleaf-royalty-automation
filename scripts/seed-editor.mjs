// Seeds bookleaf_sample_data.json into the Bubble development database through the editor's data tools
// (the Free plan has no Data API). Re-runnable: it clears Authors, Books and Payouts first.
//   node scripts/seed-editor.mjs
import fs from "node:fs";
import { editorPage } from "./bubble-editor.mjs";
import { createThing, listThings, ref } from "./bubble-data.mjs";

const APP_UID = "1348695171700984260"; // editor-internal app id used in delete_thing references
const data = JSON.parse(fs.readFileSync(new URL("../bubble/bookleaf_sample_data.json", import.meta.url)));
const slug = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const day = (d) => (d ? `${d}T00:00:00.000Z` : null);

const { page } = await editorPage();

async function deleteAll(type) {
  const ids = (await listThings(page, type)).map((t) => t._id);
  if (!ids.length) return;
  const status = await page.evaluate(async (body) => (await fetch("https://bubble.io/appeditor/delete_thing", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  })).status, { appname: "ajayraghav20047", app_version: "test", things: ids.map((id) => `${APP_UID}__LOOKUP__${id}`) });
  console.log(`deleted ${ids.length} ${type} (${status})`);
}

for (const t of ["payout", "book", "author"]) await deleteAll(t);

for (const a of data.authors) {
  await createThing(page, "author", {
    author_code_text: a.author_id, name_text: a.name, email_text: a.email, phone_text: a.phone,
    city_text: a.city, joined_date_date: day(a.joined_date),
  });
}
const authorIds = Object.fromEntries((await listThings(page, "author", ["author_code_text"])).map((r) => [r.author_code_text, r._id]));
console.log(`authors: ${Object.keys(authorIds).length}`);

for (const a of data.authors) {
  for (const b of a.books) {
    const published = /published/i.test(b.status);
    await createThing(page, "book", {
      book_code_text: b.book_id, author_custom_author: ref(authorIds[a.author_id]), owner_email_text: a.email,
      title_text: b.title, isbn_text: b.isbn, genre_text: b.genre,
      stage_option_book_stage: slug(b.status.replace(/^In Production\s*-\s*/i, "")),
      status_text_text: b.status, is_published_boolean: published,
      publication_date_date: day(b.publication_date), mrp_number: b.mrp, royalty_per_copy_number: b.author_royalty_per_copy,
      print_partner_option_print_partner: b.print_partner ? slug(b.print_partner) : null,
      available_on_list_option_platform: b.available_on.map(slug),
      copies_sold_number: b.total_copies_sold, royalty_earned_number: b.total_royalty_earned,
      royalty_paid_number: b.royalty_paid, royalty_pending_number: b.royalty_pending,
      last_payout_date_date: day(b.last_royalty_payout_date),
    });
  }
}
const bookIds = Object.fromEntries((await listThings(page, "book", ["book_code_text"])).map((r) => [r.book_code_text, r._id]));
console.log(`books: ${Object.keys(bookIds).length}`);

// Payout history: the dataset has only the cumulative amount paid and the last payout date per book,
// so each paid book gets one clearly labelled backfill row. New payouts would append real rows.
let payouts = 0;
for (const a of data.authors) {
  for (const b of a.books.filter((x) => x.royalty_paid > 0 && x.last_royalty_payout_date)) {
    await createThing(page, "payout", {
      author_custom_author: ref(authorIds[a.author_id]), book_custom_book: ref(bookIds[b.book_id]), owner_email_text: a.email,
      amount_number: b.royalty_paid, payout_date_date: day(b.last_royalty_payout_date),
      note_text: "Cumulative royalty paid to date (backfilled from dataset)", is_backfill_boolean: true,
    });
    payouts++;
  }
}
console.log(`payouts: ${payouts}`);
process.exit(0);
