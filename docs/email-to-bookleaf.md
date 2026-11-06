Subject: Re: Technical Assignment 2 – quick question on Bubble plan

Hi team,

A quick heads-up while building Assignment 2. On Bubble's current Free plan the app can't expose an API: calls to both the Data API and the Workflow API return 401 ("This application does not expose an API. Please upgrade your Bubble subscription"), even on the development version. So n8n can't fetch author data or post the status callback into Bubble on Free.

Since the brief says Free is sufficient, I'm staying on Free: Bubble sends the author's full payload in the webhook (one of the two options in the brief), and n8n returns the Success/Failed status, generated email and timestamp in its webhook response, which Bubble writes to the Notification Log. I've also built the separate HTTP-callback version (Bubble backend workflows), which only works on a paid plan. Let me know if you'd prefer that one and I'll switch it on.

Thanks,
Ajay
