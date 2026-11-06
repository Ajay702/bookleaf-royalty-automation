// Turns on the Workflow API + Data API and exposes only the types n8n reads (brief B step 2).
// NotificationLog and User stay unexposed: n8n writes logs through a backend workflow, never raw.
import { editorPage, write, read } from "./bubble-editor.mjs";
const { page } = await editorPage();
await write(page, [
  [["settings", "client_safe", "exposes_wf_api"], true, "ChangeAppSetting"],
  [["settings", "client_safe", "exposes_get_api"], true, "ChangeAppSetting"],
  ...["author", "book", "payout", "appsetting"].map((t) => [["user_types", t, "exposed_api"], true]),
  ...["user", "notificationlog"].map((t) => [["user_types", t, "exposed_api"], false]),
]);
const [types] = await read(page, [["user_types"]]);
console.log(Object.fromEntries(Object.entries(types).map(([k, v]) => [k, !!v.exposed_api])));
process.exit(0);
