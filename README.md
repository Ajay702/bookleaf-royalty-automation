# BookLeaf: Author Royalty Dashboard & Automated Notification System

Assignment 2 of 2 (Bubble.io + n8n + Claude).

| | |
|---|---|
| **Live app (Bubble, development version)** | https://ajayraghav20047.bubbleapps.io/version-test |
| **n8n workflow export** | [`n8n/bookleaf-royalty-summary.workflow.json`](n8n/bookleaf-royalty-summary.workflow.json) (+ [`bookleaf-error-alert.workflow.json`](n8n/bookleaf-error-alert.workflow.json)) |
| **Sample AI emails** | [`docs/sample-emails.md`](docs/sample-emails.md): real Claude output for the edge-case authors |
| **Test logins** | Author `priya.sharma@email.com`, Admin `admin@bookleaf.test` (password shared in the submission email) |

> **Testing other authors:** open *Activate account* on the login page and sign up with any author email from the dataset (e.g. `ananya.reddy@email.com`). You will see only that author's books and royalties. That is the data isolation the brief asks you to test.

---

## 1. The one constraint that shaped the design: Bubble's Free plan

The brief says the Free plan is enough, so I stayed on it. Early on I verified what Free actually allows ([`scripts/probe-plan.mjs`](scripts/probe-plan.mjs)): with an admin token, both the **Data API** and the **Workflow API** return `401 "This application does not expose an API. Please upgrade your Bubble subscription"`, even on the development version. Backend workflows also do not run.

So on Free, **nothing can call *into* Bubble**: n8n cannot query Bubble's Data API, and it cannot POST a callback to a backend workflow. Calls *out* of Bubble (API Connector) work fine.

The design follows from that:

| Brief step | How it's done on Free | Why |
|---|---|---|
| 1. Webhook | Bubble's API Connector POSTs to the n8n webhook with a shared-secret header | Outbound calls work on Free |
| 2. Fetch data | **Bubble sends the author's full payload** (author, every book with sales/royalty figures) | One of the two options the brief allows; the Data API is not available |
| 3. AI | n8n computes the facts in code, Claude writes the email | See §4 |
| 4. Output | Email sent via SMTP **and** returned to Bubble, which stores it in the Notification Log | Visible and verifiable in the admin UI |
| 5. Status update | n8n's **webhook response** carries `Success` / `Failed` / `Duplicate`, the timestamp and the execution id. Bubble writes them to the log | An inbound callback isn't possible on Free; the response is the callback channel |

I also built the paid-plan version, kept in the app as the upgrade path: backend workflows `summary_callback` (the true HTTP callback n8n would call), `trigger_summary`, `bulk_trigger_summaries` and `recalc_all_statuses` (see [`scripts/apply-backend.mjs`](scripts/apply-backend.mjs)). On a Starter plan, switching is a configuration change: n8n swaps its final Respond node for an HTTP Request to `/wf/summary_callback`.

---

## 2. Bubble database schema

Designed relationally ([`bubble/schema.md`](bubble/schema.md) has every field):

```
User ──(email)── Author 1───* Book 1───* Payout
                   │                        
                   └──────* NotificationLog *── User (triggered_by)
AppSetting (singleton: last status recalculation)
```

- **Author** is separate from **User**. Authors exist as business records before anyone logs in, and admins are users with no author record. Author also holds **cached roll-ups** (`total_earned/paid/pending`, `payout_status`, `has_pending`, …). The admin overview filters by payout status and shows totals per author; computing those with nested searches on every row would be slow and costly in workload units. The `royalty_engine` reusable element recomputes them.
- **Book** holds its catalogue data plus its royalty snapshot (copies sold, earned, paid, pending, last payout). The dataset has exactly one aggregate per book, a 1:1 relationship, so splitting it into a separate type would only add a search per row.
- **Payout** is the 1-to-many payout history. The dataset only has the cumulative amount paid and the last payout date per book, so each paid book gets one row clearly marked `is_backfill` ("Cumulative royalty paid to date"); future payouts would append real rows.
- **NotificationLog** records every summary request: who triggered it, mode (single/bulk), status, the generated subject and body, recipient, error, model, tokens and n8n execution id. `in_flight` supports idempotency.
- **Option sets** for every fixed vocabulary code depends on: `Role`, `BookStage` (+`is_published`, `step`), `RoyaltyStatus` and `PayoutStatus` (+`color` used by the badges), `PrintPartner`, `Platform`, `NotifyStatus`. Typos can't break filters, and the colours live in one place.

**Royalty status badge** (per book), the brief's rule plus the Knowledge Base threshold:

1. Not published → **In Production** (grey)
2. Nothing pending → **Paid Up** (green)
3. Pending, and the last payout (or the publication date if never paid) is more than **90 days** ago → **Overdue** (red)…
4. …unless the author's total pending is **below ₹1,000**: the KB says that rolls over to the next quarter, so it's **Pending** (yellow), not overdue. (Kavita Deshmukh, ₹850, is the dataset's example.)
5. Otherwise → **Pending** (yellow)

The author's payout status is Overdue if any book is overdue, else Pending if any book is pending, else Fully Paid.

### Privacy rules (brief A4)
| Type | Authors can see | Admins | Logged out |
|---|---|---|---|
| Author | where `email = Current User's email` | all | nothing |
| Book, Payout | where `owner_email = Current User's email` | all | nothing |
| NotificationLog, AppSetting | nothing | all | nothing |
| User | own record | all | nothing |

Ownership is by email because on Free there's no server-side step to link a new User to an Author record. Authors "claim" their account by signing up with the email BookLeaf has on file. In production I'd add email confirmation before the link takes effect (Bubble's *send confirmation email*); the dataset emails aren't real, so it's off for the demo.

---

## 3. Bubble app

| Page | What it does |
|---|---|
| `index` | Log in / Activate account. Logged-in users are routed by role. |
| `dashboard` (author) | Welcome, summary cards (earned / paid / pending), last payout and payout-status pill, **My Books** with every field from the brief and a coloured status badge, payout history. Recalculates the author's statuses on load. |
| `admin` | Stats (authors, total pending, authors overdue); **filters** by name (contains), city (dropdown of distinct cities) and payout status; author list with totals and status pill → **author detail** (same `author_royalty_view` the author sees, plus **Generate & Send Royalty Summary** and that author's summary history); **bulk send** to everyone with pending royalties; **Notification Log** with status, subject, error, and the full email on demand. |

Reusable elements: **`author_royalty_view`** (one component for both the author dashboard and the admin detail, so the two can never disagree) and **`royalty_engine`** (custom events `recalc_author` / `recalc_all` / `recalc_next`). Because backend workflows don't run on Free, the "recalculate every author" loop is a page-side queue: a list custom state, process the first item, remove it, re-schedule itself.

### Generate & Send (page workflow `send_summary`)
1. **Idempotency guard:** only if no log for this author is `in_flight` in the last 10 minutes, create a log `Processing`, `in_flight = yes`; otherwise create a `Duplicate` log saying it was skipped. The button is also hidden while a run is in flight, replaced by "Generating…".
2. Call **API Connector → n8n `trigger_summary`** with the full payload. Books are built with `:format as text` into JSON, and every string is passed through `:formatted as JSON-safe`.
3. Write the result: `Success` (subject, body, recipient, email_sent, model, tokens, execution id) or `Failed` (n8n's reason). If the HTTP call itself fails (n8n down, 401/403 bad key, timeout), the connector's *include errors in response* lets the workflow continue and log `Failed: n8n request failed (HTTP …)`. A 409 from n8n is logged as `Duplicate`.
4. A log still `Processing` after 3 minutes shows **"Timed out: no answer from n8n"**, so the admin is never left with a spinner.

**Bulk:** the same `send_summary`, once per author with `has_pending = yes`, through a page-side queue (1.5 s apart), with a "Sending… N left" indicator.

---

## 4. n8n workflow

![flow](docs/n8n-flow.png)

`Webhook (header auth) → Config → Validate & de-duplicate → [IF valid] → Build royalty facts → Claude → Parse & check email → [IF passes] → Send email (SMTP) → Build success response → Release lock → Respond`

- **Webhook security:** n8n *Header Auth* credential; requests without the correct `X-BookLeaf-Key` get **403** before any node runs. The secret is a private header in Bubble's API Connector (never sent to the browser) and an n8n credential; it is not in this repo.
- **Validation:** missing `log_id` / `author_id` / author name / books, or malformed JSON → **400** with a readable reason.
- **De-duplication (n8n side):** workflow static data holds a per-author lock for 120 s; a second request for the same author while one is running gets **409 Duplicate**. Bubble guards too (above), so double clicks are handled on both sides.
- **Error handling:** every node that can fail (fact building, Claude, parsing) uses n8n's *error output*, and so does a failed quality check. All of them converge on **Build failure response**, which names the failing step and the HTTP status, so nothing fails silently. Claude calls retry once (25 s timeout) so the whole run stays well inside Bubble's API timeout. SMTP failure doesn't fail the run: the summary is still returned and `email_sent = false` is recorded. An **error workflow** emails the ops inbox if an execution crashes outright.
- **Demo safety:** `SEND_TO_REAL_AUTHORS = false` routes all emails to a demo inbox (the dataset's addresses are fake); the intended recipient is still logged.

Tested offline: [`n8n/test`](n8n/test) runs the generated Code-node source from the exported JSON with mocked n8n globals (10 tests: validation, 409 dedupe, full chain with a mocked Claude reply, failure naming, date/number parsing).

---

## 5. AI prompt strategy

Same principle as Assignment 1: **the model writes, code decides.**

- **Facts are computed in code** ([`n8n/src/royalty-lib.js`](n8n/src/royalty-lib.js)): totals, per-book status, the quarterly payout schedule and the next 45-day deadline, production stage "4 of 9", and the **scenario** (`all_paid`, `pending_in_cycle`, `below_threshold`, `overdue`, `no_published_books`). LLMs are unreliable at date maths, and a royalty email must never invent a date or an amount.
- **The system prompt** ([`n8n/src/prompt.js`](n8n/src/prompt.js)) carries BookLeaf's Knowledge Base (80/20 split, quarterly + 45-day window, ₹1,000 threshold, production stages) and the tone guidelines from Assignment 1 (partners not customers, be specific, own BookLeaf's mistakes, give timelines, end with a next step). It also lays down a fixed email structure, and each scenario maps to the required content: positive acknowledgement when fully paid, an apology plus a 48-hour finance commitment when overdue, a threshold explanation, and production updates.
- **Fact sheet as data:** the author facts are sent in `<facts>` tags and the prompt says they are data, not instructions.
- **Guardrail after the model:** the reply must greet by first name, state the exact pending total, mention every book in production, and quote **no rupee amount that isn't in the author's records**. If it fails, the run is marked Failed with the reason instead of sending a wrong email.
- **Model:** `claude-haiku-5-5` with extended thinking **disabled**: every fact is precomputed, so thinking only added latency and once ran into the token cap mid-email (found while testing, [`scripts/preview-emails.mjs`](scripts/preview-emails.mjs)). The system prompt is marked for prompt caching.

---

## 6. How I built it, and what I learned

Bubble was new to me. Here's the honest process:

1. **Read the manual, then the data.** I started from the data model (the brief says database first), then privacy rules.
2. **Learned what the editor actually stores.** Clicking through hundreds of editor steps is slow and hard to review, so I watched what the Bubble editor saves when you make a change by hand: each change is a small JSON write (data types, option sets, privacy rules, expressions). Once I could read that format, I wrote the schema, privacy rules, backend workflows and the admin page as scripts ([`scripts/`](scripts)) and verified every result in the editor (issue checker at **0**). Expressions like *"Search for Books (author = …):each item's royalty_pending:sum ≥ 1000"* are nested message chains; I wrote small helpers for them.
3. **Used Bubble's own AI Agent for parts of the UI**: the login page, the `author_royalty_view` reusable and author dashboard, and the `royalty_engine` loop. I gave it precise specs and then reviewed and corrected its output; for example its API Connector call was marked "initialized" with invented response fields, which I replaced. That's how BookLeaf would likely work day to day too.
4. **Found the Free-plan wall by testing, not assuming.** The settings page says "test this feature for free", and the Agent claimed backend workflows don't run. A 2-line probe settled it (both APIs 401). I re-designed rather than ask anyone to pay for a trial.
5. **Bugs I hit and fixed:**
   - "Parent group's thing" only reaches the *immediate* parent: every nested group must pass its data down. That caused 89 → 29 issues.
   - My expression helper overwrote existing steps instead of appending ("page's bulk_running = yes" became "page = yes"): 29 → 3.
   - Bubble rejects `yes/no = yes` literals in conditions; the yes/no value is itself the condition: 3 → 0.
   - Claude Haiku 5.5 rejects `temperature` and thinks by default.
   - Bubble renders numbers and dates as text in `:format as text` ("1,203", "5/22/2024 12:00 am"), so the n8n parser accepts those, and a timezone off-by-one was caught by running the tests in IST and UTC.

### Repo map
```
bubble/        schema.md, dataset
n8n/           workflow exports, src/ (royalty logic + prompt), test/
scripts/       apply-*.mjs  (schema, privacy, backend, admin page, API connector),
               seed-editor.mjs (seeds the dataset), build-workflow.mjs (generates the n8n JSON),
               preview-emails.mjs (real Claude output for edge cases)
docs/          sample-emails.md, STATUS.md
```

### Reproduce
```bash
npm install
npm test                                        # 10 tests
node scripts/build-workflow.mjs                 # regenerate n8n JSON from src
node --env-file=.env scripts/preview-emails.mjs # needs ANTHROPIC_API_KEY
```
Import both workflow JSON files into n8n, create the credentials `BookLeaf webhook key` (Header Auth, `X-BookLeaf-Key`), `Anthropic account` and `SMTP account`, set the error workflow, and fill the **Config** node (sender, demo inbox).
