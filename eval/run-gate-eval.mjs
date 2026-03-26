#!/usr/bin/env node
/**
 * Gate prompt eval harness.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-... node eval/run-gate-eval.mjs [runs=10] [model=anthropic/claude-haiku-4-5]
 *
 * Reads every *.txt file in eval/ (except gate-prompt.txt) as a test message.
 * Files whose name contains "not-funnel" are expected to return isFunnelMessage: false.
 * All other files are expected to return isFunnelMessage: true.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────
const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error("ERROR: Set OPENROUTER_API_KEY env var");
  process.exit(1);
}

const RUNS = parseInt(process.argv[2] || "10", 10);
const MODEL = process.argv[3] || "anthropic/claude-haiku-4-5";

// ── Read the gate prompt from src/config.ts ───────────────────────────────
function extractPrompt() {
  const configPath = path.resolve(__dirname, "../src/config.ts");
  const src = fs.readFileSync(configPath, "utf-8");
  // Extract the template literal content between haikusSystemPrompt: ` ... `.trim()
  const match = src.match(/haikusSystemPrompt:\s*`\n([\s\S]*?)\n\s*`\.trim\(\)/);
  if (!match) {
    console.error("ERROR: Could not extract haikusSystemPrompt from src/config.ts");
    process.exit(1);
  }
  return match[1].trim();
}

const SYSTEM_PROMPT = extractPrompt();

// ── Collect test messages ─────────────────────────────────────────────────
const evalDir = __dirname;
const testFiles = fs
  .readdirSync(evalDir)
  .filter((f) => f.endsWith(".txt") && f !== "gate-prompt.txt")
  .sort();

if (testFiles.length === 0) {
  console.error("No test .txt files found in eval/");
  process.exit(1);
}

const testCases = testFiles.map((f) => ({
  name: f.replace(/\.txt$/, ""),
  text: fs.readFileSync(path.join(evalDir, f), "utf-8").trim(),
  expectFunnel: !f.includes("not-funnel"),
}));

// ── API call ──────────────────────────────────────────────────────────────
async function callGate(messageText) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 100,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: messageText },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "";
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return { _parseError: true, raw: raw.slice(0, 200) };
  }
}

// ── Run eval ──────────────────────────────────────────────────────────────
console.log(`\nGate Eval — model: ${MODEL}, runs per message: ${RUNS}`);
console.log(`System prompt (${SYSTEM_PROMPT.length} chars):\n---\n${SYSTEM_PROMPT}\n---\n`);

let totalCorrect = 0;
let totalRuns = 0;

for (const tc of testCases) {
  const label = tc.expectFunnel ? "SHOULD PASS (true)" : "SHOULD REJECT (false)";
  console.log(`▸ ${tc.name}  [${label}]`);
  console.log(`  "${tc.text.slice(0, 80)}${tc.text.length > 80 ? "..." : ""}"`);

  let trueCount = 0;
  let falseCount = 0;
  let parseErrors = 0;
  const confidences = { high: 0, medium: 0, low: 0 };

  for (let i = 0; i < RUNS; i++) {
    try {
      const result = await callGate(tc.text);
      if (result._parseError) {
        parseErrors++;
        continue;
      }
      if (result.isFunnelMessage) trueCount++;
      else falseCount++;
      if (result.confidence in confidences) confidences[result.confidence]++;
    } catch (err) {
      console.error(`  [run ${i + 1}] Error: ${err.message}`);
      parseErrors++;
    }
  }

  const correctCount = tc.expectFunnel ? trueCount : falseCount;
  const pct = ((correctCount / RUNS) * 100).toFixed(0);
  const status = correctCount === RUNS ? "PASS" : correctCount >= RUNS * 0.8 ? "WEAK" : "FAIL";

  console.log(
    `  Results: true=${trueCount} false=${falseCount} parseErr=${parseErrors}` +
      `  confidence: H=${confidences.high} M=${confidences.medium} L=${confidences.low}`
  );
  console.log(`  Accuracy: ${pct}% (${correctCount}/${RUNS})  ${status}`);
  console.log();

  totalCorrect += correctCount;
  totalRuns += RUNS;
}

const overallPct = ((totalCorrect / totalRuns) * 100).toFixed(1);
console.log(`═══ Overall: ${overallPct}% correct (${totalCorrect}/${totalRuns}) ═══\n`);

process.exit(totalCorrect === totalRuns ? 0 : 1);
