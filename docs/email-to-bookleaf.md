Reply in the existing HR thread (as asked: "Kindly follow this email thread for all future communication").

---

Hi Saloni,

Please find my submission for Technical Assignment 2: an Author Royalty Dashboard in Bubble, with automated AI-written royalty emails through n8n and Claude.

**Walkthrough video (2½ min):** https://drive.google.com/file/d/1GAYcoIoBAnwX6md-0yidbc_eti__T0RE/view?usp=sharing

**Live app:** https://ajayraghav20047.bubbleapps.io/version-test/
- Admin login: admin@bookleaf.test / Leaf-TdCKOvja-7
- Author login: priya.sharma@email.com / Leaf-TdCKOvja-7

**Bubble editor:** https://bubble.io/page?id=ajayraghav20047 (set to "Everyone can view", so no invite is needed; happy to add a reviewer as a collaborator too)

**Source, n8n workflow JSON and documentation (public repo):** https://github.com/Ajay702/bookleaf-royalty-automation
- n8n workflow export: `n8n/bookleaf-royalty-summary.workflow.json` (plus the error-alert workflow)
- README: database schema, Bubble ↔ n8n integration, prompt strategy, error handling, and what I learned

A few notes:
- **Bubble Free plan:** Bubble can't expose its Data or Workflow API on Free (calls return 401), so n8n can't call back into Bubble. Instead, Bubble sends the full author payload to the n8n webhook, and n8n returns the result (status, email, timestamp, execution ID) in its response, which Bubble writes to the Notification Log. The README explains this in section 1.
- **Tested live:** single send, double click (one email only), repeat within 2 minutes (blocked as a duplicate), a forced AI failure (logged as Failed with the reason), a bulk send to the 9 authors with pending royalties, and the privacy rules (an author's browser only receives their own records).
- **Email:** real emails are sent over SMTP (the bonus), to a test inbox rather than the sample authors' addresses.
- **AI tools:** I used an AI coding agent (Claude Code) and Bubble's own AI Agent while building this; section 6 of the README describes the process, including the bugs I hit and how I fixed them. The video narration uses an AI clone of my own voice (ElevenLabs); the screen recording is the live app.

Happy to walk through any part of it.

Thanks,
Ajay Raghav
