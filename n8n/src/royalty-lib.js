// Pure royalty logic shared by the n8n Code nodes. Kept in one file so it can be unit-tested with
// plain Node (see n8n/test) and then inlined into the workflow JSON by scripts/build-workflow.mjs.
// No imports, no I/O: n8n Code nodes run in a sandbox, so everything here is self-contained.

export const PAYOUT_WINDOW_DAYS = 45;
export const PAYOUT_THRESHOLD = 1000; // ₹ — below this, pending royalties roll over
export const OVERDUE_DAYS = 90; // brief: red if pending and last payout (or publication) > 90 days ago
export const PRODUCTION_STAGES = [
  "Manuscript Received", "Editing", "Cover Design", "Typesetting", "Proofreading",
  "ISBN Assignment", "Printing", "Distribution Setup", "Published & Live",
];

const DAY_MS = 86400000;

export function toDay(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export const isoDay = (d) => (d ? d.toISOString().slice(0, 10) : null);

export function longDate(d) {
  if (!d) return null;
  const day = typeof d === "string" ? toDay(d) : d;
  const months = ["January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December"];
  return `${day.getUTCDate()} ${months[day.getUTCMonth()]} ${day.getUTCFullYear()}`;
}

// Indian digit grouping (₹1,23,456) without relying on Intl locale data in the sandbox.
export function rupees(n) {
  const num = Math.round(Number(n) || 0);
  const s = String(Math.abs(num));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${num < 0 ? "-" : ""}₹${rest ? `${rest},${last3}` : last3}`;
}

function quarterOf(date) {
  const q = Math.floor(date.getUTCMonth() / 3);
  const start = new Date(Date.UTC(date.getUTCFullYear(), q * 3, 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), q * 3 + 3, 0));
  return { label: `Q${q + 1} ${date.getUTCFullYear()}`, start, end,
    payoutBy: new Date(end.getTime() + PAYOUT_WINDOW_DAYS * DAY_MS) };
}

/** Where `today` sits in the quarterly cycle: the last deadline that passed and the next one ahead. */
export function payoutSchedule(today) {
  const current = quarterOf(today);
  const previous = quarterOf(new Date(current.start.getTime() - DAY_MS));
  const beforePrevious = quarterOf(new Date(previous.start.getTime() - DAY_MS));
  const inPreviousWindow = today <= previous.payoutBy;
  return {
    lastDue: inPreviousWindow ? beforePrevious : previous,
    nextDue: inPreviousWindow ? previous : current,
  };
}

/** Accepts either a Bubble Data API record or the raw sample-data shape and returns one shape. */
export function normaliseBook(raw) {
  const status = String(raw.status ?? raw.status_text ?? "");
  const published = raw.is_published === true || /published/i.test(status);
  return {
    id: raw.book_id ?? raw._id,
    title: raw.title,
    isbn: raw.isbn ?? null,
    genre: raw.genre ?? null,
    status,
    isPublished: published,
    publicationDate: toDay(raw.publication_date),
    mrp: raw.mrp ?? null,
    royaltyPerCopy: raw.royalty_per_copy ?? raw.author_royalty_per_copy ?? null,
    copiesSold: Number(raw.copies_sold ?? raw.total_copies_sold ?? 0),
    earned: Number(raw.royalty_earned ?? raw.total_royalty_earned ?? 0),
    paid: Number(raw.royalty_paid ?? 0),
    pending: Number(raw.royalty_pending ?? 0),
    lastPayout: toDay(raw.last_payout_date ?? raw.last_royalty_payout_date),
    printPartner: raw.print_partner ?? null,
    availableOn: Array.isArray(raw.available_on) ? raw.available_on : [],
  };
}

/** Green / Yellow / Red / Grey badge — the same rule the Bubble app applies (see docs/README.md). */
// authorPending: the author's total pending across books. Below the ₹1,000 threshold the money
// legitimately rolls over (Knowledge Base), so it is never shown as overdue.
export function bookRoyaltyStatus(book, today, authorPending = Infinity) {
  if (!book.isPublished) return "In Production";
  if (book.pending <= 0) return "Paid Up";
  if (authorPending < PAYOUT_THRESHOLD) return "Pending";
  const cutoff = new Date(today.getTime() - OVERDUE_DAYS * DAY_MS);
  const reference = book.lastPayout ?? book.publicationDate;
  if (reference && reference < cutoff) return "Overdue";
  return "Pending";
}

export function authorPayoutStatus(statuses) {
  if (statuses.includes("Overdue")) return "Overdue";
  if (statuses.includes("Pending")) return "Pending";
  return "Fully Paid";
}

function productionLine(book) {
  const stage = book.status.replace(/^In Production\s*-\s*/i, "").trim();
  const idx = PRODUCTION_STAGES.findIndex((s) => s.toLowerCase() === stage.toLowerCase());
  if (idx < 0) return `"${book.title}" is in production (${book.status}).`;
  return `"${book.title}" is in production: stage ${idx + 1} of ${PRODUCTION_STAGES.length} ` +
    `(${stage}); the next stage is ${PRODUCTION_STAGES[idx + 1]}. No sales or royalties yet.`;
}

/**
 * Turns an author + their books into (a) a compact plain-text fact sheet for the model and
 * (b) structured numbers used afterwards to validate the model's output. All arithmetic and
 * calendar logic lives here, never in the prompt — LLMs are unreliable at date maths.
 */
export function buildFacts({ author, books: rawBooks, payouts = [], today: todayIn }) {
  const today = toDay(todayIn) ?? toDay(new Date(Date.now() + 5.5 * 3600000)); // BookLeaf runs on IST
  const books = rawBooks.map(normaliseBook);
  const live = books.filter((b) => b.isPublished);
  const inProduction = books.filter((b) => !b.isPublished);
  const totals = live.reduce((t, b) => ({
    earned: t.earned + b.earned, paid: t.paid + b.paid, pending: t.pending + b.pending,
    copies: t.copies + b.copiesSold,
  }), { earned: 0, paid: 0, pending: 0, copies: 0 });
  const statuses = live.map((b) => bookRoyaltyStatus(b, today, totals.pending));
  const lastPayout = live.map((b) => b.lastPayout).filter(Boolean).sort((a, b) => a - b).at(-1) ?? null;
  const schedule = payoutSchedule(today);
  const neverPaid = live.filter((b) => b.pending > 0 && !b.lastPayout);

  const scenario =
    live.length === 0 ? "no_published_books"
      : totals.pending === 0 ? "all_paid"
        : totals.pending < PAYOUT_THRESHOLD ? "below_threshold"
          : statuses.includes("Overdue") ? "overdue"
            : "pending_in_cycle";

  const firstName = String(author.name ?? "").trim().split(/\s+/)[0] || "there";
  const lines = [
    `Today: ${longDate(today)}`,
    `Author: ${author.name} (first name ${firstName}), ${author.city ?? "city unknown"}, with BookLeaf since ${longDate(toDay(author.joined_date)) ?? "unknown"}`,
    `Published books: ${live.length}; books in production: ${inProduction.length}`,
  ];
  live.forEach((b, i) => {
    lines.push(
      `Published book: "${b.title}" — ${b.genre}, published ${longDate(b.publicationDate)}, MRP ${rupees(b.mrp)}, ${rupees(b.royaltyPerCopy)} royalty per copy`,
      `  ${b.copiesSold} copies sold; royalty earned ${rupees(b.earned)}, paid ${rupees(b.paid)}, pending ${rupees(b.pending)}; ` +
      `last payout ${b.lastPayout ? longDate(b.lastPayout) : "none yet"}; status: ${statuses[i]}`,
      `  Available on: ${b.availableOn.join(", ") || "not listed"}`,
    );
  });
  inProduction.forEach((b) => lines.push(`In production: ${productionLine(b)}`));
  lines.push(
    `Account totals (published books): earned ${rupees(totals.earned)}, paid ${rupees(totals.paid)}, pending ${rupees(totals.pending)}`,
    `Most recent payout on any book: ${lastPayout ? longDate(lastPayout) : "no payout has ever been made"}`,
    `Royalty cycle: royalties are calculated quarterly and paid within ${PAYOUT_WINDOW_DAYS} days of quarter end. ` +
    `The next payout deadline is ${longDate(schedule.nextDue.payoutBy)} (for ${schedule.nextDue.label}, which ends ${longDate(schedule.nextDue.end)}). ` +
    `The most recent deadline that has already passed was ${longDate(schedule.lastDue.payoutBy)} (for ${schedule.lastDue.label}).`,
  );
  if (payouts.length) {
    lines.push("Payout history: " + payouts
      .map((p) => `${rupees(p.amount)} on ${longDate(toDay(p.payout_date))}${p.book_title ? ` for "${p.book_title}"` : ""}`)
      .join("; "));
  }
  const scenarioNote = {
    no_published_books: "SCENARIO: no published books yet — there are no royalties to report; focus on the production update.",
    all_paid: "SCENARIO: every published book is fully paid up — acknowledge this positively.",
    below_threshold: `SCENARIO: pending total is below the ${rupees(PAYOUT_THRESHOLD)} minimum payout threshold, so it rolls over to a later quarter until it crosses the threshold. Do not suggest it will be paid at the next payout deadline.`,
    pending_in_cycle: `SCENARIO: pending royalties are within the normal cycle — they are expected with the payout due by ${longDate(schedule.nextDue.payoutBy)}.`,
    overdue: `SCENARIO: OVERDUE — royalties are pending and the last payout (or, for never-paid books, the publication date) is more than ${OVERDUE_DAYS} days ago` +
      (neverPaid.length ? ` (${neverPaid.map((b) => `"${b.title}"`).join(", ")} ${neverPaid.length === 1 ? "has" : "have"} never had a payout)` : "") +
      `. This is late on BookLeaf's side: own it, apologise, and commit that the finance team will review and confirm the payout within 48 hours. ` +
      `Ask the author to confirm their bank account is linked in the dashboard.`,
  }[scenario];
  lines.push(scenarioNote);

  return {
    text: lines.join("\n"),
    firstName,
    scenario,
    totals,
    payoutStatus: authorPayoutStatus(statuses),
    nextPayoutBy: isoDay(schedule.nextDue.payoutBy),
    // Every rupee figure the model is allowed to quote; used to catch invented numbers.
    allowedAmounts: [...new Set([
      totals.earned, totals.paid, totals.pending, PAYOUT_THRESHOLD,
      ...live.flatMap((b) => [b.earned, b.paid, b.pending, b.mrp, b.royaltyPerCopy]),
      ...payouts.map((p) => Number(p.amount)),
    ].filter((n) => n != null).map(Number))],
    inProductionTitles: inProduction.map((b) => b.title),
  };
}

/** Pull <subject> and <body> out of the model reply and check it against the facts. */
export function parseAndValidate(text, facts) {
  const grab = (tag) => (String(text).match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i")) || [])[1]?.trim();
  const subject = grab("subject");
  const body = grab("body");
  const problems = [];
  if (!subject) problems.push("missing <subject>");
  if (!body) problems.push("missing <body>");
  if (body) {
    if (!body.includes(facts.firstName)) problems.push(`greeting does not use the author's first name (${facts.firstName})`);
    if (facts.scenario !== "no_published_books" && !body.includes(rupees(facts.totals.pending))) {
      problems.push(`total pending ${rupees(facts.totals.pending)} not stated`);
    }
    const quoted = [...body.matchAll(/₹\s?([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
    const invented = quoted.filter((n) => !facts.allowedAmounts.includes(n));
    if (invented.length) problems.push(`amounts not in the author's records: ${invented.map(rupees).join(", ")}`);
    for (const title of facts.inProductionTitles) {
      if (!body.includes(title)) problems.push(`no production update for "${title}"`);
    }
    if (body.length > 4000) problems.push("body too long");
  }
  return { ok: problems.length === 0, subject, body, problems };
}
