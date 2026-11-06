import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildFacts, parseAndValidate, rupees, bookRoyaltyStatus, normaliseBook } from "../src/royalty-lib.js";

const data = JSON.parse(fs.readFileSync(new URL("../../bubble/bookleaf_sample_data.json", import.meta.url)));
const byId = Object.fromEntries(data.authors.map((a) => [a.author_id, a]));
const facts = (id, today = "2026-11-07") => buildFacts({ author: byId[id], books: byId[id].books, today });

test("rupees uses Indian grouping", () => {
  assert.equal(rupees(57744), "₹57,744");
  assert.equal(rupees(1234567), "₹12,34,567");
  assert.equal(rupees(850), "₹850");
});

test("scenarios across the dataset", () => {
  assert.equal(facts("AUTH008").scenario, "all_paid");          // Farhan: fully paid
  assert.equal(facts("AUTH009").scenario, "below_threshold");   // Kavita: ₹850 pending
  assert.equal(facts("AUTH003").scenario, "overdue");           // Ananya: never paid
  assert.equal(facts("AUTH001", "2026-01-10").scenario, "pending_in_cycle"); // paid 15 Oct 2025
});

test("Kavita's production book and threshold rollover", () => {
  const f = facts("AUTH009");
  assert.deepEqual(f.inProductionTitles, ["Raising Roots"]);
  assert.match(f.text, /stage 4 of 9 \(Typesetting\)/);
  assert.equal(f.payoutStatus, "Pending");
});

test("badge rule", () => {
  const b = normaliseBook(byId.AUTH003.books[0]);
  assert.equal(bookRoyaltyStatus(b, new Date("2024-08-01")), "Pending");
  assert.equal(bookRoyaltyStatus(b, new Date("2026-11-07")), "Overdue");
  assert.equal(bookRoyaltyStatus(normaliseBook(byId.AUTH007.books[2]), new Date()), "In Production");
});

test("validation catches invented amounts and missing name", () => {
  const f = facts("AUTH003");
  const good = parseAndValidate(`<subject>Your royalties</subject><body>Dear Ananya, pending ₹2,546 of ₹2,546.</body>`, f);
  assert.ok(good.ok, good.problems.join());
  const bad = parseAndValidate(`<subject>x</subject><body>Hi there, you are owed ₹9,999.</body>`, f);
  assert.equal(bad.ok, false);
  assert.equal(bad.problems.length, 3);
});
