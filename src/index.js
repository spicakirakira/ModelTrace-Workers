import { analyzeGlobalOutputs, parseNumbers } from "./fingerprint.js";
import { generateChallenges } from "./challenge-suite.js";
import {
  getBankStore,
  summarizeBank,
  summarizeUnified,
  bankSummary,
} from "./store.js";
import {
  requestCompletion,
  enrollAutomatic,
  testAutomatic,
} from "./enrollment.js";
import { buildBank, prepareRows } from "./bank-builder.js";
import { renderIndexHtml } from "./html-template.js";
import {
  STYLES_CSS,
  REPOSITORY_LINK_CSS,
  CLIENT_APP_JS,
} from "./ui-assets.js";

const DEFAULT_BANK_ID = "claude";

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function textResponse(text, contentType = "text/plain; charset=utf-8", status = 200) {
  return new Response(text, {
    status,
    headers: {
      "Content-Type": contentType,
    },
  });
}

function requestedTemperature(payload) {
  const value = payload.temperature;
  return value === null || value === undefined || value === "" ? null : Number(value);
}

function requestedBankId(payload, url, configs) {
  const bankId = payload?.bank_id || url.searchParams.get("bank_id") || DEFAULT_BANK_ID;
  if (!configs[bankId]) {
    throw new Error(`未知指纹库：${bankId}`);
  }
  return bankId;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const store = await getBankStore(env);

    // Static Assets
    if (method === "GET") {
      if (url.pathname === "/static/styles.css") {
        return textResponse(STYLES_CSS, "text/css; charset=utf-8");
      }
      if (url.pathname === "/static/repository-link.css") {
        return textResponse(REPOSITORY_LINK_CSS, "text/css; charset=utf-8");
      }
      if (url.pathname === "/static/app.js") {
        return textResponse(CLIENT_APP_JS, "application/javascript; charset=utf-8");
      }

      // Root Page
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const summaries = {};
        for (const bankId of Object.keys(store.configs)) {
          summaries[bankId] = summarizeBank(store, bankId);
        }
        const unified = summarizeUnified(store);
        const html = renderIndexHtml({
          banks: summaries,
          bank: summaries[DEFAULT_BANK_ID],
          unified,
          defaultBankId: DEFAULT_BANK_ID,
        });
        return textResponse(html, "text/html; charset=utf-8");
      }

      // API: /api/challenges
      if (url.pathname === "/api/challenges") {
        return jsonResponse({ challenges: generateChallenges(3) });
      }

      // API: /api/bank
      if (url.pathname === "/api/bank") {
        try {
          const bankId = requestedBankId(null, url, store.configs);
          return jsonResponse(summarizeBank(store, bankId));
        } catch (error) {
          return jsonResponse({ error: error.message }, 400);
        }
      }

      // API: /api/banks
      if (url.pathname === "/api/banks") {
        const summaries = {};
        for (const bankId of Object.keys(store.configs)) {
          summaries[bankId] = summarizeBank(store, bankId);
        }
        return jsonResponse(summaries);
      }
    }

    // POST APIs
    if (method === "POST") {
      let payload = {};
      try {
        const contentType = request.headers.get("Content-Type") || "";
        if (contentType.includes("application/json")) {
          payload = await request.json();
        }
      } catch {
        return jsonResponse({ error: "无效的 JSON 请求体" }, 400);
      }

      // API: /api/analyze
      if (url.pathname === "/api/analyze") {
        try {
          if (!payload.outputs || !Array.isArray(payload.outputs)) {
            return jsonResponse({ error: "缺少 outputs 数组" }, 400);
          }
          const result = analyzeGlobalOutputs(payload.outputs, store.unified);
          result.bank = summarizeUnified(store);
          return jsonResponse(result);
        } catch (error) {
          return jsonResponse({ error: error.message }, 400);
        }
      }

      // API: /api/test/auto
      if (url.pathname === "/api/test/auto") {
        try {
          const baseUrl = String(payload.base_url || "").trim();
          const apiKey = String(payload.api_key || "");
          const apiModel = String(payload.api_model || "").trim();
          const temperature = requestedTemperature(payload);

          const { outputs, api_test } = await testAutomatic({
            baseUrl,
            apiKey,
            apiModel,
            temperature,
            bank: store.unified,
            apiFormat: "auto",
          });

          if (!outputs.length) {
            return jsonResponse({ error: "没有获得可分析输出", api_test }, 400);
          }

          const result = analyzeGlobalOutputs(outputs, store.unified);
          result.api_test = api_test;
          result.bank = summarizeUnified(store);
          return jsonResponse(result);
        } catch (error) {
          return jsonResponse({ error: error.message }, 400);
        }
      }

      // API: /api/test/probe
      if (url.pathname === "/api/test/probe") {
        try {
          const baseUrl = String(payload.base_url || "").trim();
          const apiKey = String(payload.api_key || "");
          const apiModel = String(payload.api_model || "").trim();
          const prompt = String(payload.prompt || "");
          const expectedCount = parseInt(payload.expected_count, 10);
          const temperature = requestedTemperature(payload);

          const text = await requestCompletion(
            baseUrl,
            apiKey,
            apiModel,
            prompt,
            temperature,
            "auto"
          );

          const numbers = parseNumbers(text);
          const parsedNumbers = numbers.length;
          const minimumNumbers = Math.max(80, Math.ceil(expectedCount * 0.55));
          const accepted = parsedNumbers >= minimumNumbers;

          return jsonResponse({
            text,
            parsed_numbers: parsedNumbers,
            minimum_numbers: minimumNumbers,
            accepted,
          });
        } catch (error) {
          return jsonResponse({ error: error.message }, 502);
        }
      }

      // API: /api/banks (Create bank)
      if (url.pathname === "/api/banks") {
        try {
          const label = String(payload.label || "").trim();
          if (!label) {
            return jsonResponse({ error: "请输入指纹库名称" }, 400);
          }

          let bankId = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
          if (!bankId) {
            bankId = `bank-${crypto.randomUUID().slice(0, 6)}`;
          }

          if (store.configs[bankId]) {
            return jsonResponse({ error: "同名指纹库已存在" }, 400);
          }

          store.configs[bankId] = { label, custom: true };
          store.banks[bankId] = null;
          await store.saveCustomBank(bankId, label, null, []);

          const summaries = {};
          for (const item of Object.keys(store.configs)) {
            summaries[item] = summarizeBank(store, item);
          }

          return jsonResponse({
            bank: summarizeBank(store, bankId),
            banks: summaries,
            unified: summarizeUnified(store),
          });
        } catch (error) {
          return jsonResponse({ error: error.message }, 400);
        }
      }

      // API: /api/enroll/auto
      if (url.pathname === "/api/enroll/auto") {
        try {
          const bankId = requestedBankId(payload, url, store.configs);
          const baseUrl = String(payload.base_url || "").trim();
          const apiKey = String(payload.api_key || "");
          const apiModel = String(payload.api_model || "").trim();
          const modelLabel = String(payload.model_label || "").trim();
          const sampleCount = parseInt(payload.sample_count || 36, 10);
          const temperature = requestedTemperature(payload);

          const enrollResult = await enrollAutomatic({
            baseUrl,
            apiKey,
            apiModel,
            modelLabel,
            sampleCount,
            temperature,
            apiFormat: "auto",
            bankId,
            provider: "api",
          });

          // Update the bank with new rows
          const existingRows = await store.getCustomRows(bankId);
          const allRows = [...existingRows, ...enrollResult.acceptedRows];
          const newBank = buildBank(prepareRows(allRows), store.banks[bankId]?.calibration);
          newBank.family_name = store.configs[bankId].label;

          store.banks[bankId] = newBank;
          await store.saveCustomBank(bankId, store.configs[bankId].label, newBank, allRows);

          // Rebuild unified bank
          const allGlobalRows = [];
          for (const activeId of Object.keys(store.banks)) {
            if (store.configs[activeId].builtin) {
              // Builtin models are represented in the current unified bank
              continue;
            }
            const activeRows = await store.getCustomRows(activeId);
            for (const r of activeRows) {
              allGlobalRows.push({
                ...r,
                family_id: activeId,
                family_name: store.configs[activeId].label,
              });
            }
          }

          if (allGlobalRows.length > 0) {
            // Rebuild unified with custom rows appended to builtin models
            const unifiedCustomBank = buildBank(
              prepareRows(allGlobalRows),
              store.unified.calibration
            );
            // Merge custom models into store.unified
            store.unified.models = [
              ...store.unified.models.filter((m) => !allGlobalRows.some((r) => r.source === m.id)),
              ...unifiedCustomBank.models,
            ];
            await store.saveUnified(store.unified);
          }

          enrollResult.bank = summarizeBank(store, bankId);
          enrollResult.unified = summarizeUnified(store);
          delete enrollResult.acceptedRows;

          return jsonResponse(enrollResult);
        } catch (error) {
          return jsonResponse({ error: error.message }, 400);
        }
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};
