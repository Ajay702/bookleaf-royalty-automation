# Status: pick up here (updated 7 Nov 2026, day 2)

**Day 2 done:** seed (10 authors, 18 books, 12 payouts), n8n reworked + 10 tests + real emails, pages index/dashboard/admin (0 editor issues), API connector payload, README.
**Blocked on user:** n8n sign-in + 3 credentials, webhook secret in Bubble API connector, DEMO_RECIPIENT, sign up priya.sharma@email.com + admin@bookleaf.test. Then: import workflow, set admin role, initialize API call, end-to-end test, recording.


## Decided
- **Bubble Free plan, no trial.** On Free, inbound calls to the Data API and Workflow API return 401 (tested). The design is therefore:
  - Bubble sends the author's full payload to the n8n webhook (API Connector, outbound works on Free).
  - n8n returns status, email, timestamp and execution id in its webhook response, and Bubble writes the Notification Log itself.
  - Bulk trigger is a page-level recursive custom event that calls the same webhook once per author.
  - Status recalculation runs as page workflows inside a reusable element.
- **Ownership by email.** Book/Payout have `owner_email`; privacy rules compare it (or Author.email) to Current User's email. Accounts are "claimed" by signing up with the dataset email.
- The backend workflows already built (recalc_author, recalc_all_statuses, summary_callback, trigger_summary, bulk_trigger_summaries, provision_login) stay in the app as the paid-plan upgrade path.

## Done
- Data types, option sets, privacy rules (scripts/apply-schema.mjs, apply-privacy.mjs)
- API settings (apply-api-settings.mjs), backend workflows (apply-backend.mjs + Bubble agent)
- API Connector call `n8n.trigger_summary`, header `X-BookLeaf-Key` named (value still to be pasted)
- n8n workflow JSON + royalty logic + prompt, 8 passing tests (`npm test`)
- Demo password in .env (DEMO_PASSWORD)

## Next
1. Seed data: authors via `POST https://bubble.io/appeditor/upload_thing` (editor session). Ids are read from App data search responses: **filter to `custom.author` only**, because responses can include the editor user's account record. Then books (author id, owner_email), then payouts. Delete the probe Author `PROBE` and fix the AppSetting slug `seed-probe`.
2. Rework n8n: input = full payload; remove the Bubble fetch nodes; Respond to Webhook at the end with the result; errors return status Failed (HTTP 200) so Bubble can log them.
3. Pages (Bubble agent + verify): index (login + claim sign-up), author dashboard, admin overview (filters, bulk, recalc, log), admin author detail (Generate & Send). Reusable element "royalty_engine" holds the recalc custom events.
4. With the user: n8n credentials (`BookLeaf webhook key`, `Anthropic account`, `SMTP account`), paste the webhook secret into the Bubble API Connector, fill DEMO_RECIPIENT and ANTHROPIC_API_KEY in .env, sign up priya.sharma@email.com + admin@bookleaf.test, screen recording, collaborator invite.
5. README (docs/README.md), then send docs/email-to-bookleaf.md.

## Environment notes
- Automation Brave: `"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" --remote-debugging-port=9333 --user-data-dir=<workspace>/.brave-profile`
- Helper CLI: `<workspace>/.pw/pw.mjs` (tabs/shot/click/type/eval/goto). The screenshots are 2× CSS pixels, so halve the coordinates before clicking.
- Bubble app id `ajayraghav20047`; n8n instance `bookleaf-ajay.app.n8n.cloud`.
