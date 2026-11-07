// Reads and writes app *data* (not the app definition) through the Bubble editor's own data tools.
// Used because the Free plan has no Data API. Only records of the requested type are kept: the
// editor's search responses also carry unrelated records (including the editor user's own account),
// which are dropped immediately and never logged.
import { APP } from "./bubble-editor.mjs";

export async function createThing(page, type, fields) {
  const res = await page.evaluate(async ({ app, type, fields }) => {
    const r = await fetch("https://bubble.io/appeditor/upload_thing", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ appname: app, app_version: "test", thing_type: `custom.${type}`, to_create: fields }),
    });
    return r.status;
  }, { app: APP, type, fields });
  if (res !== 200) throw new Error(`upload_thing ${type} → ${res}`);
}

/** Opens App data for `type` in the editor and returns its records ({_id, ...fields}) from the search responses. */
export async function listThings(page, type, keep = []) {
  const wanted = `custom.${type}`;
  const found = new Map();
  const collect = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(collect);
    const src = node._source ?? node;
    if ((node._type === wanted || src._type === wanted) && src._id) {
      found.set(src._id, Object.fromEntries([["_id", src._id], ...keep.map((k) => [k, src[k]])]));
      return;
    }
    Object.values(node).forEach(collect);
  };
  const onResponse = async (r) => {
    if (!r.url().includes("/elasticsearch/")) return;
    try { collect(JSON.parse(await r.text())); } catch { /* not JSON */ }
  };
  page.on("response", onResponse);
  await page.goto(`https://bubble.io/page?id=${APP}&tab=Data&subtab=App+Data&type_id=${type}&name=index`, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 12000));
  page.off("response", onResponse);
  return [...found.values()];
}

// Bubble's database stores a link to another record as "<app db id>__LOOKUP__<record id>". upload_thing
// accepts a bare id without complaint but then stores a string no search will ever match, so links
// must be written in this form.
export const APP_DB_ID = "1348695171700984260";
export const ref = (id) => (String(id).includes("__LOOKUP__") ? id : `${APP_DB_ID}__LOOKUP__${id}`);

/** Updates fields of one existing record (same endpoint as the editor's "Modify" dialog). */
export async function modifyThing(page, id, newValues) {
  const res = await page.evaluate(async ({ app, thing, newValues }) => {
    const r = await fetch("https://bubble.io/appeditor/modify_thing", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ appname: app, app_version: "test", thing, new_values: newValues }),
    });
    return r.status;
  }, { app: APP, thing: ref(id), newValues });
  if (res !== 200) throw new Error(`modify_thing ${id} → ${res}`);
}
