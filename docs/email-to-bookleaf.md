Reply in the existing HR thread (as asked: "Kindly follow this email thread for all future communication").

---

Hi Saloni,

I've completed Technical Assignment 2: the Author Royalty Dashboard in Bubble, with automated AI royalty emails through n8n and Claude.

**Live app:** https://ajayraghav20047.bubbleapps.io/version-test/
- Admin login: admin@bookleaf.test / Leaf-TdCKOvja-7
- Author login: priya.sharma@email.com / Leaf-TdCKOvja-7

**Bubble editor:** https://bubble.io/page?id=ajayraghav20047 (set to "Everyone can view", so you can open the editor without an invite; happy to add a reviewer as a collaborator too)

**Source, n8n workflow JSON and documentation (public repo):** https://github.com/Ajay702/bookleaf-royalty-automation
- n8n workflow export: `n8n/bookleaf-royalty-summary.workflow.json` (plus the error-alert workflow)
- README: schema, Bubble ↔ n8n integration, prompt strategy, error handling, and what I learned

**Screen recording (4 min):** VIDEO_URL

A few notes:
- **Bubble Free plan:** Bubble can't expose its Data or Workflow API on Free (calls return 401), so n8n can't call back into Bubble. Instead, Bubble sends the full author payload to the n8n webhook, and n8n returns the result (status, email, timestamp, execution ID) in its response, which Bubble writes to the Notification Log. The README covers this in section 1.
- **Verified live:** single send, double click (one email only), duplicate within 2 minutes (blocked), forced AI failure (logged as Failed with the reason), bulk send to the 9 authors with pending royalties, and the privacy rules (authors only receive their own records).
- **Email:** real emails are sent over SMTP (the bonus), to a test inbox rather than the authors' sample addresses.
- **AI tools:** I used an AI coding agent (Claude Code) and Bubble's own AI Agent to build this. The README's section 6 describes the process honestly, including the bugs I hit and how I fixed them.

Happy to walk through any part of it.

Thanks,
Ajay Raghav
