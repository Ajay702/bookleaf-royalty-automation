# Bubble data model

Plan for the Bubble database. Field names are snake_case so the Data API keys n8n reads are predictable.

## Option sets
| Option set | Options | Attributes |
|---|---|---|
| **Role** | Author, Admin | — |
| **BookStage** | Manuscript Received, Editing, Cover Design, Typesetting, Proofreading, ISBN Assignment, Printing, Distribution Setup, Published & Live | `is_published` (yes/no), `step` (number) |
| **RoyaltyStatus** (per book) | Paid Up, Pending, Overdue, In Production | `color` (text hex), `sort` (number) |
| **PayoutStatus** (per author) | Fully Paid, Pending, Overdue | `color` |
| **PrintPartner** | In-House, Repro India, Epitome Books | — |
| **Platform** | Amazon India, Flipkart, Amazon US, Amazon UK, BookLeaf Store | — |
| **NotifyStatus** | Queued, Processing, Success, Failed, Duplicate | `color`, `is_final` (yes/no) |

Option sets are used for fixed values that code depends on, because they are fast, free to read, and safe to change in one place. Free text would let typos break filters.

## Data types
**User** (built-in): `role` Role · `author` Author (empty for admins) · `display_name` text

**Author**: `author_code` text (AUTH001) · `name` · `email` · `phone` · `city` text · `joined_date` date · `user` User
 Cached rollups, refreshed by the backend workflow `recalc_author`: `total_books` number · `published_books` number · `total_copies` number · `total_earned` · `total_paid` · `total_pending` number · `last_payout_date` date · `payout_status` PayoutStatus · `has_pending` yes/no

**Book**: `book_code` text (BK001) · `author` Author · `owner` User (denormalised for privacy rules) · `title` · `isbn` · `genre` · `stage` BookStage · `status_text` text (raw dataset status, e.g. "In Production - Cover Design") · `is_published` yes/no · `publication_date` date · `mrp` number · `royalty_per_copy` number · `print_partner` PrintPartner · `available_on` list of Platform
 Royalty snapshot: `copies_sold` · `royalty_earned` · `royalty_paid` · `royalty_pending` number · `last_payout_date` date · `royalty_status` RoyaltyStatus

**Payout** (payout history): `author` Author · `owner` User · `book` Book · `amount` number · `payout_date` date · `note` text · `is_backfill` yes/no

**NotificationLog**: `author` Author · `triggered_by` User · `mode` text (single / bulk) · `status` NotifyStatus · `requested_at` date · `completed_at` date · `email_subject` text · `email_body` text · `email_sent` yes/no · `email_recipient` text · `error_message` text · `n8n_execution_id` text · `model` text · `tokens_used` number

**AppSetting** (single row): `as_of_date` date (empty means today; used to view the data "as at" a date) · `last_recalc_at` date

## Why this shape
- **Author ≠ User.** Authors exist as business records before they ever log in, and admins are users without an author record. Linking `User.author` keeps authentication separate from domain data.
- **Book holds its royalty snapshot.** The dataset gives one aggregate per book, a strict 1:1 relationship. Splitting it into another type would mean an extra search per row in every repeating group. **Payout** is the 1:many history: it is seeded with the last known payout per book, flagged `is_backfill`, and new payouts append rows.
- **Cached rollups on Author.** The admin overview filters by payout status and sorts by pending amount. Computing those per row with nested searches is slow and expensive in workload units on Bubble. `recalc_author` recomputes them whenever royalty data changes, and n8n's daily job calls `recalc_all_statuses` because status depends on today's date (Bubble's free plan has no recurring workflows).
- **`owner` on Book and Payout.** Privacy rules compare `This Book's owner is Current User`, a single-hop check that is cheap and unambiguous.

## Privacy rules
| Type | Rule (when) | Grants |
|---|---|---|
| User | `This User is Current User` | view all fields |
| User | `Current User's role is Admin` | view all, find in searches |
| Author | `This Author's user is Current User` | view all, find in searches |
| Author | `Current User's role is Admin` | view all, find in searches |
| Book / Payout | `This Book's owner is Current User` | view all, find in searches |
| Book / Payout | `Current User's role is Admin` | view all, find in searches |
| NotificationLog | `Current User's role is Admin` | view all, find in searches |
| AppSetting | `Current User's role is Admin` | view all, find in searches |
| (everyone else) | — | nothing, auto-binding off |

The n8n integration uses an admin API token, which bypasses privacy rules by design and is never exposed to the browser.

## Royalty status rule (per book, computed in `recalc_author`)
1. Not published → **In Production** (grey)
2. `royalty_pending = 0` → **Paid Up** (green)
3. Author's total pending < ₹1,000 → **Pending** (yellow): it rolls over under the Knowledge Base threshold, so it is not overdue
4. Last payout (or publication date if never paid) more than 90 days before the as-of date → **Overdue** (red)
5. otherwise → **Pending** (yellow)

Author `payout_status`: Overdue if any book is Overdue; else Pending if any book is Pending; else Fully Paid.
