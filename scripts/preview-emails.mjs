// Generates real royalty emails for the edge-case authors with the exact prompt the n8n workflow uses,
// and runs the same guardrail check. Output goes to docs/sample-emails.md.
//   node --env-file=.env scripts/preview-emails.mjs [AUTH003 AUTH008 ...]
import fs from "node:fs";
import { buildFacts, parseAndValidate } from "../n8n/src/royalty-lib.js";
import { SYSTEM_PROMPT, userMessage } from "../n8n/src/prompt.js";

const MODEL = process.env.MODEL ?? "claude-haiku-5-5";
const AS_OF = process.env.AS_OF ?? "2026-11-07";
const codes = process.argv.slice(2).length ? process.argv.slice(2) : ["AUTH003", "AUTH007", "AUTH008", "AUTH009"];
const data = JSON.parse(fs.readFileSync(new URL("../bubble/bookleaf_sample_data.json", import.meta.url)));

const out = [`# Sample royalty emails\n\nGenerated with \`${MODEL}\`, as of ${AS_OF}, using the n8n prompt and guardrails.\n`];
for (const code of codes) {
  const a = data.authors.find((x) => x.author_id === code);
  const facts = buildFacts({ author: a, books: a.books, today: AS_OF });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, thinking: { type: "disabled" }, system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage(facts.text) }] }),
  });
  const json = await res.json();
  if (!res.ok) { console.error(code, res.status, JSON.stringify(json).slice(0, 300)); process.exit(1); }
  const v = parseAndValidate(json.content.map((c) => c.text ?? "").join(""), facts);
  console.log(`${code} ${a.name} [${facts.scenario}] checks: ${v.ok ? "PASS" : "FAIL — " + v.problems.join("; ")}`);
  out.push(`## ${a.name} (${code}), scenario: ${facts.scenario}\n\nGuardrail: **${v.ok ? "pass" : "fail: " + v.problems.join("; ")}** · tokens ${json.usage.input_tokens}+${json.usage.output_tokens}\n\n**Subject:** ${v.subject}\n\n\`\`\`text\n${v.body}\n\`\`\`\n`);
}
fs.writeFileSync(new URL("../docs/sample-emails.md", import.meta.url), out.join("\n"));
