// Thin client for the Bubble editor's own save/load endpoints, driven through the signed-in
// automation browser (Playwright over CDP). Every write is what the editor itself would send when
// you make the same change by hand; we read the definition back afterwards to verify it.
import { chromium } from "playwright-core";

export const APP = process.env.BUBBLE_APP ?? "ajayraghav20047";
const CDP = process.env.CDP_URL ?? "http://127.0.0.1:9333";

export async function editorPage() {
  const browser = await chromium.connectOverCDP(CDP);
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("bubble.io/page"));
  if (!page) throw new Error("Open the Bubble editor in the automation Brave window first");
  return { browser, page };
}

const SESSION = `${Date.now()}x77`;

export async function write(page, changes, { dryRun = false } = {}) {
  const body = {
    v: 1, appname: APP, app_version: "test",
    changes: changes.map(([path_array, value, intent = "WriteCustom"]) => ({
      body: value, path_array, intent: { name: intent },
      version_control_api_version: 4, changelog_data: [], session_id: SESSION,
    })),
  };
  if (dryRun) return body;
  const res = await page.evaluate(async (b) => {
    const r = await fetch("https://bubble.io/appeditor/write", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
    });
    return { status: r.status, text: (await r.text()).slice(0, 2000) };
  }, body);
  if (res.status !== 200) throw new Error(`write failed ${res.status}: ${res.text}`);
  return res;
}

export async function read(page, pathArrays) {
  return page.evaluate(async ({ app, paths }) => {
    const r = await fetch(`https://bubble.io/appeditor/load_multiple_paths/${app}/test`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path_arrays: paths, no_chunking: true }),
    });
    const j = await r.json();
    return j.data.map((d) => d.data);
  }, { app: APP, paths: pathArrays });
}

// ── Expression helpers (Bubble's JSON expression grammar) ─────────────────────
// {"%x":"CurrentUser"} = Current User; {"%n": next} chains a message (field access / operator).
export const X = {
  currentUser: (next) => ({ "%x": "CurrentUser", ...(next ? { "%n": next } : {}) }),
  thisThing: (next) => ({ "%x": "InjectedValue", ...(next ? { "%n": next } : {}) }),
  field: (key, next) => ({ "%x": "Message", "%nm": key, ...(next ? { "%n": next } : {}) }),
  equals: (arg) => ({ "%x": "Message", "%nm": "equals", "%a": arg }),
  or: (arg) => ({ "%x": "Message", "%nm": "or_", "%a": arg }),
  option: (set, value) => ({ "%x": "OptionValue", "%p": { "option_set": set, "option_value": value } }),
};

// Field key the editor derives from a display name and type, e.g. ("author","custom.author") → author_custom_author
export function fieldKey(name, type) {
  return `${name}_${type.replace(/\./g, "_")}`;
}
