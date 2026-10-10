import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { parseNumbers, countNumbers, analyzeGlobalOutputs } from "../src/fingerprint.js";
import { generateChallenges, fingerprintSuite } from "../src/challenge-suite.js";
import { getBuiltinBanks } from "../src/banks.js";

test("Builtin banks load and contain all 18 models", async () => {
  const banks = await getBuiltinBanks();
  assert.ok(banks.unified, "unified bank exists");
  assert.ok(banks.gpt, "gpt bank exists");
  assert.ok(banks.claude, "claude bank exists");

  assert.equal(banks.unified.models.length, 18, "unified has 18 models");
  assert.equal(banks.gpt.models.length, 8, "gpt has 8 models");
  assert.equal(banks.claude.models.length, 10, "claude has 10 models");

  const expectedGptModels = [
    "gpt-5.4", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra",
    "gpt-5.6-luna", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna",
  ];
  for (const id of expectedGptModels) {
    assert.ok(banks.gpt.models.some((m) => m.id === id), `gpt has ${id}`);
    assert.ok(banks.unified.models.some((m) => m.id === id), `unified has ${id}`);
  }

  const expectedClaudeModels = [
    "claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-sonnet-5",
    "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8",
    "claude-opus-5", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5",
  ];
  for (const id of expectedClaudeModels) {
    assert.ok(banks.claude.models.some((m) => m.id === id), `claude has ${id}`);
    assert.ok(banks.unified.models.some((m) => m.id === id), `unified has ${id}`);
  }
});

test("parseNumbers extracts longest digit run correctly", () => {
  const text = "Prefix 10 20 30, text abc 40 50 60 70 80 90, end";
  const numbers = parseNumbers(text);
  assert.deepEqual(numbers, [40, 50, 60, 70, 80, 90]);

  // Filtering out of 1..355
  const outOfRange = "5 0 356 100 200";
  const parsed = parseNumbers(outOfRange);
  assert.deepEqual(parsed, [5, 100, 200]);
});

test("challengeSuite generates valid suite and challenges", () => {
  const suite = fingerprintSuite();
  assert.equal(suite.length, 36, "fingerprint suite has 36 challenges");
  assert.ok(suite[0].prompt.includes("1 到 355") || suite[0].prompt.includes("1 to 355"));

  const ch = generateChallenges(3);
  assert.equal(ch.length, 3);
  for (const item of ch) {
    assert.ok(item.id.startsWith("probe-"));
    assert.ok(item.expected_count >= 292 && item.expected_count <= 332);
    assert.ok(item.prompt.includes(String(item.expected_count)));
  }
});

test("Fingerprint attribution calculation matches expectation", async () => {
  const banks = await getBuiltinBanks();
  const testOutputs = [
    { text: Array.from({ length: 300 }, (_, i) => (i % 355) + 1).join(" "), expected_count: 300 },
    { text: Array.from({ length: 300 }, (_, i) => ((i * 3) % 355) + 1).join(" "), expected_count: 300 },
    { text: Array.from({ length: 300 }, (_, i) => ((i * 7) % 355) + 1).join(" "), expected_count: 300 },
  ];
  const res = analyzeGlobalOutputs(testOutputs, banks.unified);
  assert.equal(res.prediction, "claude-opus-5-5");
  assert.equal(res.family_prediction, "claude");
  assert.ok(res.probability > 0.9);
  assert.equal(res.results.length, 18);
  assert.equal(res.diagnostics.length, 3);
  assert.ok(res.diagnostics.every((d) => d.accepted));
});

test("Worker: GET / serves complete HTML with identical structure", async () => {
  const res = await worker.fetch(new Request("https://example.com/"));
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type").includes("text/html"));

  const html = await res.text();
  assert.ok(html.includes("ModelTrace"));
  assert.ok(html.includes('id="workspace-test"'));
  assert.ok(html.includes('id="workspace-library"'));
  assert.ok(html.includes('id="test-manual"'));
  assert.ok(html.includes('id="test-api"'));
  assert.ok(html.includes('id="bank-select"'));
  assert.ok(html.includes('id="create-bank-form"'));
  assert.ok(html.includes('id="auto-enrollment"'));
  assert.ok(html.includes("18 个候选模型"));
  assert.ok(html.includes("window.BANK_SUMMARIES"));
  assert.ok(html.includes("window.UNIFIED_SUMMARY"));
});

test("Worker: Static CSS and JS assets are served", async () => {
  const cssRes = await worker.fetch(new Request("https://example.com/static/styles.css"));
  assert.equal(cssRes.status, 200);
  assert.ok(cssRes.headers.get("content-type").includes("text/css"));

  const repoRes = await worker.fetch(new Request("https://example.com/static/repository-link.css"));
  assert.equal(repoRes.status, 200);
  assert.ok(repoRes.headers.get("content-type").includes("text/css"));

  const jsRes = await worker.fetch(new Request("https://example.com/static/app.js"));
  assert.equal(jsRes.status, 200);
  assert.ok(jsRes.headers.get("content-type").includes("javascript"));
});

test("Worker: GET /api/challenges returns 3 challenges", async () => {
  const res = await worker.fetch(new Request("https://example.com/api/challenges"));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.challenges.length, 3);
  assert.ok(data.challenges[0].prompt);
});

test("Worker: GET /api/bank and /api/banks return expected summaries", async () => {
  const resGpt = await worker.fetch(new Request("https://example.com/api/bank?bank_id=gpt"));
  assert.equal(resGpt.status, 200);
  const gptData = await resGpt.json();
  assert.equal(gptData.id, "gpt");
  assert.equal(gptData.label, "GPT");
  assert.equal(gptData.model_count, 8);

  const resClaude = await worker.fetch(new Request("https://example.com/api/bank?bank_id=claude"));
  assert.equal(resClaude.status, 200);
  const claudeData = await resClaude.json();
  assert.equal(claudeData.id, "claude");
  assert.equal(claudeData.label, "Claude");
  assert.equal(claudeData.model_count, 10);

  const resBanks = await worker.fetch(new Request("https://example.com/api/banks"));
  assert.equal(resBanks.status, 200);
  const banksData = await resBanks.json();
  assert.equal(banksData.gpt.model_count, 8);
  assert.equal(banksData.claude.model_count, 10);
});

test("Worker: POST /api/analyze computes attribution probabilities", async () => {
  const payload = {
    outputs: [
      { text: Array.from({ length: 300 }, (_, i) => (i % 355) + 1).join(" "), expected_count: 300 },
      { text: Array.from({ length: 300 }, (_, i) => ((i * 3) % 355) + 1).join(" "), expected_count: 300 },
      { text: Array.from({ length: 300 }, (_, i) => ((i * 7) % 355) + 1).join(" "), expected_count: 300 },
    ],
  };
  const res = await worker.fetch(
    new Request("https://example.com/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.prediction, "claude-opus-5-5");
  assert.equal(data.family_prediction, "claude");
  assert.ok(data.bank);
  assert.equal(data.bank.model_count, 18);
});

test("Worker: POST /api/banks creates a new custom bank", async () => {
  const res = await worker.fetch(
    new Request("https://example.com/api/banks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Llama" }),
    })
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.bank.id, "llama");
  assert.equal(data.bank.label, "Llama");
  assert.equal(data.bank.model_count, 0);
  assert.ok(data.banks.llama);
});
