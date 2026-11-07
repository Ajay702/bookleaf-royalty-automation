// Builders for Bubble's JSON expression grammar, learned by reading back what the editor writes.
// Kept tiny and explicit so generated workflows stay readable in code review.

const msg = (nm, extra = {}) => ({ "%x": "Message", "%nm": nm, is_slidable: false, ...extra });

/** Chain: chain(base, "royalty_earned_number", "sum") → base's royalty_earned:sum */
export function chain(base, ...steps) {
  let node = null;
  for (const s of [...steps].reverse()) {
    const m = typeof s === "string" ? msg(s) : s;
    node = node ? { ...m, "%n": node } : m;
  }
  if (!node) return base;
  const attach = (b) => (b["%n"] ? { ...b, "%n": attach(b["%n"]) } : { ...b, "%n": node });
  return attach(base); // append after existing steps, never overwrite them
}

export const op = {
  equals: (a) => msg("equals", { "%a": a }),
  notEquals: (a) => msg("not_equals", { "%a": a }),
  gt: (a) => msg("greater_than", { "%a": a }),
  gte: (a) => msg("greater_or_equal_than", { "%a": a }),
  lt: (a) => msg("less_than", { "%a": a }),
  and: (a) => msg("and_", { "%a": a }),
  or: (a) => msg("or_", { "%a": a }),
  plusDays: (n) => ({ "%x": "Message", "%nm": "plus_days", "%a": n, is_slidable: true }),
  plusMinutes: (n) => ({ "%x": "Message", "%nm": "plus_minutes", "%a": n, is_slidable: true }),
  isEmpty: () => msg("is_empty"),
  isNotEmpty: () => msg("is_not_empty"),
  count: () => msg("count"),
  sum: () => msg("sum"),
  max: () => msg("max"),
  first: () => msg("first_element"),
};

export const E = {
  param: (name) => ({ "%x": "APIEventParameter", "%p": { "%k": name }, is_slidable: false }),
  now: () => ({ "%x": "PageData", "%p": { "%nm": "Current Date/Time" }, is_slidable: false }),
  currentUser: () => ({ "%x": "CurrentUser" }),
  thisItem: () => ({ "%x": "InjectedValue", is_slidable: false }),
  option: (set, value) => ({ "%x": "OptionValue", "%p": { option_set: `option.${set}`, option_value: value }, is_slidable: false }),
  text: (...parts) => ({ "%x": "TextExpression", "%e": Object.fromEntries(parts.map((p, i) => [String(i), p])) }),
  /** constraints: [[fieldKey, "equals"|"not equal"|"greater than"|"less than"|"is_empty"|"is_not_empty", value?], ...] */
  search: (type, constraints = []) => ({
    "%x": "Search",
    "%p": {
      "%t5": `custom.${type}`,
      ...(constraints.length ? {
        "%co": Object.fromEntries(constraints.map(([k, c, v], i) => [String(i), { "%k": k, "%c2": c, ...(v === undefined ? {} : { "%v": v }) }])),
      } : {}),
    },
  }),
};

// ── Actions ──────────────────────────────────────────────────────────────────
const fields = (pairs, withOp) => Object.fromEntries(pairs.map(([k, v], i) => [String(i), { "%k": k, "%v": v, ...(withOp ? { "%ak": "=" } : {}) }]));
const withCond = (a, when) => (when ? { ...a, "%p": { ...a["%p"], "%c": when } } : a); // "Only when" lives in %p.%c

export const A = {
  changeThing: (id, thing, changes, when) => withCond({ "%x": "ChangeThing", id, "%p": { "%tc": thing, "%cs": fields(changes, true) } }, when),
  changeList: (id, type, list, changes, when) => withCond({ "%x": "ChangeListOfThings", id, "%p": { "%tc": list, type_to_change: `custom.${type}`, "%cs": fields(changes, true) } }, when),
  newThing: (id, type, values, when) => withCond({ "%x": "NewThing", id, "%p": { "%tt": `custom.${type}`, "%i2": fields(values, false) } }, when),
  scheduleOnList: (id, apiEventId, type, list, params, when) => withCond({
    "%x": "ScheduleAPIEventOnList", id,
    "%p": { "%ds": list, api_event: apiEventId, type_of_list: `custom.${type}`, date: E.now(),
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [`_wf_param_${k}`, v])) },
  }, when),
};

// Expand short parameter refs ({"%k": name}) into the full form the editor writes.
function expandParams(node, eventId, types) {
  if (Array.isArray(node) || node === null || typeof node !== "object") return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, expandParams(v, eventId, types)]));
  if (out["%x"] === "APIEventParameter" && out["%p"]?.["%k"]) {
    const name = out["%p"]["%k"];
    out["%p"] = { event_id: eventId, param_id: name, param_name: name, btype_id: types[name] };
  }
  return out;
}

export function apiEvent({ id, name, params = [], actions, expose = false, ignorePrivacy = true }) {
  const types = Object.fromEntries(params.map(([k, v]) => [k, v]));
  actions = actions.map((a) => expandParams(a, id, types));
  return {
    "%x": "APIEvent", id,
    "%p": {
      wf_name: name, expose, parameter_def: "manual", response_type: "json", trigger_option: "post",
      auth_unecessary: false, ignore_privacy_rules: ignorePrivacy,
      ...(params.length ? { parameters: Object.fromEntries(params.map(([k, v, optional], i) => [String(i), { "%k": k, "%v": v, ...(optional ? { optional: true } : {}) }])) } : {}),
    },
    actions: Object.fromEntries(actions.map((a, i) => [String(i), a])),
  };
}
