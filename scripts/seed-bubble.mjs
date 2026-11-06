// Imports bookleaf_sample_data.json into Bubble through the Data API + Workflow API, then creates
// one login per author plus an admin, and computes every royalty status.
//
//   cp .env.example .env   # fill BUBBLE_API_TOKEN (Settings → API → generate) and DEMO_PASSWORD
//   node --env-file=.env scripts/seed-bubble.mjs [--reset]
//
// Idempotent by design: records are matched on author_code / book_code, so re-running updates
// instead of duplicating. --reset deletes Authors, Books, Payouts and NotificationLogs first.
import fs from "node:fs";

const BASE = process.env.BUBBLE_API_BASE ?? "https://ajayraghav20047.bubbleapps.io/version-test/api/1.1";
const TOKEN = process.env.BUBBLE_API_TOKEN;
const PASSWORD = process.env.DEMO_PASSWORD;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@bookleaf.test";
if (!TOKEN || !PASSWORD) {
  console.error("Set BUBBLE_API_TOKEN and DEMO_PASSWORD (see .env.example)");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(new URL("../bubble/bookleaf_sample_data.json", import.meta.url)));
const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function api(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : {};
    if (res.status >= 500 && attempt < 4) { await new Promise((r) => setTimeout(r, 1000 * attempt)); continue; }
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
}
const find = async (type, key, value) => {
  const c = encodeURIComponent(JSON.stringify([{ key, constraint_type: "equals", value }]));
  return (await api("GET", `/obj/${type}?constraints=${c}`)).response.results[0] ?? null;
};
const upsert = async (type, key, value, fields) => {
  const existing = await find(type, key, value);
  if (existing) { await api("PATCH", `/obj/${type}/${existing._id}`, fields); return existing._id; }
  return (await api("POST", `/obj/${type}`, fields)).id;
};
async function listAll(type) {
  const out = [];
  for (let cursor = 0; ; cursor += 100) {
    const r = (await api("GET", `/obj/${type}?cursor=${cursor}&limit=100`)).response;
    out.push(...r.results);
    if (r.remaining === 0) return out;
  }
}

// Dataset status → BookStage option ("In Production - Cover Design" → "Cover Design").
const stageOf = (status) => status.replace(/^In Production\s*-\s*/i, "").trim();

if (process.argv.includes("--reset")) {
  for (const type of ["notificationlog", "payout", "book", "author"]) {
    for (const r of await listAll(type)) await api("DELETE", `/obj/${type}/${r._id}`);
    console.log(`reset ${type}`);
  }
}

const settingId = (await listAll("appsetting"))[0]?._id ?? (await api("POST", "/obj/appsetting", {})).id;

for (const a of data.authors) {
  const authorId = await upsert("author", "author_code", a.author_id, {
    author_code: a.author_id, name: a.name, email: a.email, phone: a.phone, city: a.city, joined_date: a.joined_date,
  });
  for (const b of a.books) {
    const published = /published/i.test(b.status);
    const bookId = await upsert("book", "book_code", b.book_id, {
      book_code: b.book_id, author: authorId, title: b.title, isbn: b.isbn, genre: b.genre,
      stage: stageOf(b.status), status_text: b.status, is_published: published,
      publication_date: b.publication_date, mrp: b.mrp, royalty_per_copy: b.author_royalty_per_copy,
      print_partner: b.print_partner, available_on: b.available_on,
      copies_sold: b.total_copies_sold, royalty_earned: b.total_royalty_earned,
      royalty_paid: b.royalty_paid, royalty_pending: b.royalty_pending,
      last_payout_date: b.last_royalty_payout_date,
    });
    // Payout history: the dataset only has the cumulative amount paid and the last payout date, so we
    // record one backfill row per paid book and label it honestly. New payouts append real rows.
    if (b.royalty_paid > 0 && b.last_royalty_payout_date) {
      await upsert("payout", "note", `backfill:${b.book_id}`, {
        author: authorId, book: bookId, amount: b.royalty_paid, payout_date: b.last_royalty_payout_date,
        note: `backfill:${b.book_id}`, is_backfill: true,
      });
    }
  }
  // Login for this author (Workflow API; requires the admin token). Re-running on an existing
  // account just re-links it.
  await api("POST", "/wf/provision_login", { email: a.email, password: PASSWORD, role: "Author", author: authorId })
    .catch((e) => console.warn(`  login ${a.email}: ${e.message}`));
  console.log(`✓ ${a.author_id} ${a.name} (${a.books.length} books)`);
}
await api("POST", "/wf/provision_login", { email: ADMIN_EMAIL, password: PASSWORD, role: "Admin" })
  .catch((e) => console.warn(`  admin login: ${e.message}`));

await api("POST", "/wf/recalc_all_statuses", { as_of: new Date().toISOString() });
console.log(`Seeded ${data.authors.length} authors. AppSetting ${settingId}. Status recalculation scheduled.`);
