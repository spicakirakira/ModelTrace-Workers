import {
  generateChallenges,
  fingerprintSuite,
} from "./challenge-suite.js";
import { parseNumbers as parseNumbersFromText } from "./fingerprint.js";

const DEFAULT_UPSTREAM_USER_AGENT =
  "Codex Desktop/0.147.0-alpha.1.2 (Windows 10.0.26200; x86_64) unknown (codex_exec; 0.147.0-alpha.1.2)";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 1000; // ms

export function completionUrl(baseUrl, apiFormat = "openai") {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (apiFormat === "anthropic") {
    if (normalized.endsWith("/messages")) return normalized;
    if (normalized.endsWith("/v1")) return `${normalized}/messages`;
    return `${normalized}/v1/messages`;
  }
  if (normalized.endsWith("/chat/completions")) return normalized;
  if (normalized.endsWith("/v1")) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function looksLikeWafBlock(text) {
  const lowered = String(text).toLowerCase();
  return ["cloudflare", "just a moment", "cf-ray", "access denied", "attention required"].some(
    (marker) => lowered.includes(marker)
  );
}

function compactUpstreamError(details, fallback) {
  const text = String(details || fallback || "").trim();
  if (!text) return "上游接口返回错误";
  if (looksLikeWafBlock(text)) {
    return (
      "请求被上游网关拦截（Cloudflare/WAF 拦截页）。" +
      "请确认 base_url 指向 API 端点而非网页地址、API Key 有效，或该服务是否限制当前网络/IP"
    );
  }
  if (text.startsWith("<") || (!text.includes("{") && text.toLowerCase().includes("html"))) {
    return text.slice(0, 200);
  }
  try {
    const payload = JSON.parse(text);
    if (payload && typeof payload === "object") {
      const error = payload.error;
      if (error && typeof error === "object") {
        return String(error.message || error);
      }
      if (error) return String(error);
      return JSON.stringify(payload).slice(0, 500);
    }
  } catch {}
  return text.slice(0, 500);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestCompletionDirect(
  baseUrl,
  apiKey,
  apiModel,
  prompt,
  temperature,
  apiFormat,
  systemPrompt = ""
) {
  let bodyData;
  let headers;

  if (apiFormat === "anthropic") {
    bodyData = {
      model: apiModel,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    };
    if (systemPrompt) {
      bodyData.system = systemPrompt;
    }
    headers = {
      "x-api-key": apiKey,
      Authorization: `Bearer ${apiKey}`,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": DEFAULT_UPSTREAM_USER_AGENT,
    };
  } else {
    bodyData = {
      model: apiModel,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: prompt },
      ],
    };
    headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": DEFAULT_UPSTREAM_USER_AGENT,
    };
  }

  if (temperature !== null && temperature !== undefined && temperature !== "") {
    bodyData.temperature = Number(temperature);
  }

  const url = completionUrl(baseUrl, apiFormat);
  const body = JSON.stringify(bodyData);
  let payload = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
      });

      if (!res.ok) {
        const details = (await res.text()).trim();
        const msg = compactUpstreamError(details, res.statusText);
        const retried = attempt > 1 ? `（已自动重试 ${attempt - 1} 次）` : "";
        if (attempt < MAX_ATTEMPTS && RETRYABLE_STATUS.has(res.status)) {
          await sleep(RETRY_BASE_DELAY * attempt + Math.random() * 500);
          continue;
        }
        throw new Error(`HTTP ${res.status}: ${msg}${retried}`);
      }

      payload = await res.json();
      break;
    } catch (err) {
      if (err.message.startsWith("HTTP ")) throw err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY * attempt + Math.random() * 500);
        continue;
      }
      const retried = attempt > 1 ? `（已自动重试 ${attempt - 1} 次）` : "";
      throw new Error(`无法连接接口：${err.message}${retried}`);
    }
  }

  if (apiFormat === "anthropic") {
    const content = (payload.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text || "")
      .join("");
    const stopReason = payload.stop_reason;
    if (stopReason === "refusal") {
      throw new Error("模型拒绝生成，本次回答不计入");
    }
    if (stopReason === "max_tokens") {
      throw new Error("回答因 max_tokens 截断，本次回答不计入");
    }
    return String(content);
  } else {
    const choice = payload.choices && payload.choices[0];
    if (!choice) throw new Error("上游响应中无 choices 结果");
    let content = choice.message?.content || "";
    if (Array.isArray(content)) {
      content = content.map((part) => part.text || "").join("");
    }
    if (choice.finish_reason === "length" || choice.finish_reason === "content_filter") {
      throw new Error(`回答未正常完成（${choice.finish_reason}），本次回答不计入`);
    }
    return String(content);
  }
}

export async function requestCompletion(
  baseUrl,
  apiKey,
  apiModel,
  prompt,
  temperature,
  apiFormat = "auto",
  systemPrompt = ""
) {
  if (apiFormat !== "auto") {
    return requestCompletionDirect(baseUrl, apiKey, apiModel, prompt, temperature, apiFormat, systemPrompt);
  }

  const formats = ["openai", "anthropic"];
  const errors = [];
  for (const candidate of formats) {
    try {
      return await requestCompletionDirect(baseUrl, apiKey, apiModel, prompt, temperature, candidate, systemPrompt);
    } catch (err) {
      errors.push(`${candidate}: ${err.message}`);
    }
  }
  throw new Error(`接口格式自动探测失败；${errors.join("；")}`);
}

export function makeRow({
  modelLabel,
  text,
  condition,
  challengeId,
  expectedCount = 0,
  temperature = "unknown",
  bankId = "reference-bank",
  wrapperTransport = null,
  provider = "api",
  prompt = null,
  basePrompt = null,
  systemPrompt = null,
  userPrefix = null,
}) {
  const numbers = parseNumbersFromText(text);
  const threshold = expectedCount ? Math.max(80, Math.ceil(expectedCount * 0.55)) : 80;
  const rowId = `${condition}-${crypto.randomUUID()}`;
  return {
    row_id: rowId,
    parent_row_id: rowId,
    bank_id: bankId,
    source: modelLabel,
    model_id: modelLabel,
    exact_version: modelLabel,
    condition_id: condition,
    nuisance_condition_id: condition,
    wrapper_id: condition,
    wrapper_transport: wrapperTransport || (condition === "manual" ? "manual_import" : "clean"),
    provider: condition === "manual" ? "manual" : provider,
    challenge_id: challengeId,
    task_index: 0,
    requested_count: expectedCount,
    parsed_count: numbers.length,
    strict_threshold: threshold,
    strict_valid: numbers.length >= threshold,
    temperature,
    config_id: "enrollment",
    prompt,
    base_prompt: basePrompt,
    system_prompt: systemPrompt,
    user_prefix: userPrefix,
    text,
    numbers,
    error: null,
    collected_at: new Date().toISOString(),
  };
}

export async function enrollAutomatic({
  baseUrl,
  apiKey,
  apiModel,
  modelLabel,
  sampleCount = 36,
  temperature,
  apiFormat = "auto",
  bankId = "reference-bank",
  provider = "api",
}) {
  const suite = fingerprintSuite();
  if (sampleCount < 3 || sampleCount > suite.length) {
    throw new Error(`采集回答数必须在 3 到 ${suite.length} 之间`);
  }
  const selected = Array.from({ length: sampleCount }, (_, index) => {
    const idx = Math.floor((index * suite.length) / sampleCount);
    return suite[idx];
  });

  const rows = [];
  const errors = [];

  // Concurrency pool of 2
  const queue = [...selected];
  const workers = Array.from({ length: 2 }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      const basePrompt = task.prompt;
      let prompt = basePrompt;
      if (task.user_prefix) {
        prompt = `${task.user_prefix}\n\nFinal task:\n${prompt}`;
      }
      const systemPrompt = task.system;

      let collectedRow = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const text = await requestCompletion(
            baseUrl,
            apiKey,
            apiModel,
            prompt,
            temperature,
            apiFormat,
            systemPrompt
          );
          const row = makeRow({
            modelLabel,
            text,
            condition: task.condition,
            challengeId: task.challenge_id,
            expectedCount: task.expected_count,
            temperature: temperature !== null && temperature !== undefined ? temperature : "provider_default",
            bankId,
            wrapperTransport: task.transport,
            provider,
            prompt,
            basePrompt,
            systemPrompt,
            userPrefix: task.user_prefix,
          });
          if (row.strict_valid) {
            collectedRow = row;
            break;
          }
          errors.push(`${task.challenge_id} 有效数字不足：${row.parsed_count}/${row.strict_threshold}`);
        } catch (err) {
          errors.push(`${task.challenge_id}: ${err.message}`);
        }
      }
      if (collectedRow) {
        rows.push(collectedRow);
      }
    }
  });

  await Promise.all(workers);

  const accepted = rows.filter((row) => row.strict_valid);
  if (!accepted.length) {
    throw new Error("没有获得可用回答，指纹库未修改");
  }

  return {
    requested: sampleCount,
    received: accepted.length,
    accepted: accepted.length,
    rejected: sampleCount - accepted.length,
    errors,
    acceptedRows: accepted,
  };
}

export async function testAutomatic({
  baseUrl,
  apiKey,
  apiModel,
  temperature,
  bank,
  apiFormat = "auto",
}) {
  const targetCount = 3;
  const maxAttempts = 6;
  const challenges = generateChallenges(maxAttempts);
  const outputs = [];
  const errors = [];

  for (const challenge of challenges) {
    try {
      const text = await requestCompletion(
        baseUrl,
        apiKey,
        apiModel,
        challenge.prompt,
        temperature,
        apiFormat
      );
      const minimum = Math.max(80, Math.ceil(challenge.expected_count * 0.55));
      const parsedNumbers = parseNumbersFromText(text);
      if (parsedNumbers.length >= minimum) {
        outputs.push({
          text,
          expected_count: challenge.expected_count,
        });
      } else {
        errors.push(`有效数字不足：${parsedNumbers.length}/${minimum}`);
      }
    } catch (err) {
      errors.push(err.message);
    }
    if (outputs.length === targetCount) break;
  }

  return {
    outputs,
    api_test: {
      requested: targetCount,
      attempted: outputs.length + errors.length,
      max_attempts: maxAttempts,
      received: outputs.length,
      errors,
    },
  };
}
