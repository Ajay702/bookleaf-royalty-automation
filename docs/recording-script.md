# Recording script (about 4 minutes)

**Before you hit record**
- Brave tab 1: app at /version-test/, logged **out**.
- Tab 2: n8n workflow "BookLeaf · Royalty summary" open on the canvas.
- Tab 3: Gmail inbox (ajayraghav20047@gmail.com).
- Tab 4: GitHub repo README.
- Record with QuickTime (File → New Screen Recording) or Loom. Speak at a normal pace; it's fine to cut pauses.

---

**0:00–0:20 · Intro** (on the app login page)
> "Hi, I'm Ajay. This is Assignment 2: a royalty dashboard in Bubble, and n8n with Claude writing and emailing royalty summaries. I'll show the admin side, the automation, the author side, and how errors are handled."

**0:20–1:00 · Admin dashboard** (log in as admin@bookleaf.test)
- Point at the stats: 10 authors, ₹40,839 pending, 8 overdue.
> "Statuses are calculated from the knowledge base rules: red means pending with no payout in 90+ days; yellow means pending within the cycle or under the ₹1,000 minimum; green means fully paid."
- Type "Kavita" in the search: she's yellow because ₹850 is under the minimum. Clear it, pick a city in the dropdown, then clear filters.

**1:00–2:00 · Generate & Send** (click View on an author not sent in the last 2 minutes, for example Ananya Reddy)
- Show the detail: books, payouts, totals.
- Click **Generate & Send Royalty Summary** and point at "Generating…".
> "Bubble sends the author's data to an n8n webhook, protected with a shared key. n8n calculates the facts, Claude writes the email, a guardrail checks it, and it's sent over SMTP. The result comes back to Bubble and goes into the Notification Log."
- When it says **Success**, click **View email**, then switch to Gmail and open the new email.

**2:00–2:40 · n8n** (tab 2)
- Scroll the canvas left to right: webhook, validate and de-duplicate, facts, Claude, check email, SMTP, respond. Then open **Executions** and click the latest successful run.
> "Every error branch ends in one 'failure response', so Bubble always gets a readable reason. There's also an error workflow that emails me if n8n itself breaks."

**2:40–3:10 · Reliability** (back to the admin page)
- Click Generate & Send on the same author again.
> "Clicking again for the same author within 2 minutes is blocked as a duplicate, so authors never get two emails."
- Scroll the Notification Log to **Arjun Malhotra · Failed**.
> "Here I made Claude fail on purpose; the log shows why, and the admin can retry."
- Point at **Send summaries to all with pending royalties**.
> "Bulk sends go to everyone with pending royalties, one at a time through a queue. I tested it with all 9."

**3:10–3:45 · Author view** (Log out, then log in as priya.sharma@email.com)
- Show her totals, both books with their own statuses, and the payout history.
> "Privacy rules run on the server: Priya only receives her own records. I checked the actual network data, not just the screen."
- Type /admin in the address bar: it redirects her back to her dashboard.

**3:45–4:10 · Wrap-up** (GitHub README)
> "One thing that shaped the design: on Bubble's Free plan, Bubble can't receive API calls, so n8n returns its result in the webhook response instead of calling back. The README covers the schema, the prompt approach, error handling, and what I learned, including the bugs I hit. Thanks for watching."
