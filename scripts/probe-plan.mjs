// Answers one question: on this plan, do the Data API and backend workflows actually run?
//   node --env-file=.env scripts/probe-plan.mjs
const { BUBBLE_API_BASE: base, BUBBLE_API_TOKEN: token } = process.env;
const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const show = async (label, res) => console.log(label, res.status, (await res.text()).slice(0, 200));
await show("Data API  GET /obj/appsetting:", await fetch(`${base}/obj/appsetting`, { headers: h }));
await show("Workflow  POST /wf/recalc_all_statuses:", await fetch(`${base}/wf/recalc_all_statuses`, { method: "POST", headers: h, body: JSON.stringify({ as_of: new Date().toISOString() }) }));
