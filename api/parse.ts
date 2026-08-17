/**
 * Прокси к Gemini — единственная точка, где игра говорит с внешним LLM.
 *
 * Ключ живёт только в переменных окружения и никогда не попадает в браузерный
 * бандл. Любой сбой — невалидный JSON, таймаут, ошибка квоты или сети,
 * недействительный ключ, превышение рейт-лимита — гасится здесь: наружу уходит
 * синтетический пустой разбор, по форме неотличимый от настоящего ответа.
 */

import { defaultConfig } from "../src/config/default.js";
import { validateAgainstSchema } from "../src/core/schema.js";
import { checkRateLimit, clientIp, jsonResponse } from "./_shared.js";

const cfg = defaultConfig.proxy;

function emptyParse() {
  return {
    claims: [],
    tone: { ...cfg.emptyParse.tone },
    offtopic: { flag: false, text: "" },
  };
}

/** Логируется только на сервере, для отладки. Это не игровые данные. */
function logDegradation(reason: string): void {
  console.warn(`[прокси] деградация: ${reason}`);
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(emptyParse(), 200);
  }

  if (!checkRateLimit(`parse:${clientIp(request)}`, cfg.rateLimitPerIp)) {
    // Превышение рейт-лимита обрабатывается тем же пустым разбором,
    // а не отдельным кодом ошибки: Парсеру нечего делать с деталями сбоя.
    logDegradation("рейт-лимит");
    return jsonResponse(emptyParse(), 200);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logDegradation("ключ не задан");
    return jsonResponse(emptyParse(), 200);
  }

  let text = "";
  let glossary: unknown = null;
  try {
    const body = (await request.json()) as { text?: string; glossary?: unknown };
    text = typeof body.text === "string" ? body.text : "";
    glossary = body.glossary ?? null;
  } catch {
    logDegradation("невалидное тело запроса");
    return jsonResponse(emptyParse(), 200);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutSeconds * 1000);

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: cfg.systemPrompt }] },
          contents: [
            {
              role: "user",
              parts: [{ text: `СПРАВОЧНИК ИМЁН:\n${JSON.stringify(glossary)}\n\nРАПОРТ:\n${text}` }],
            },
          ],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      },
    );

    if (!upstream.ok) {
      logDegradation(`ответ апстрима ${upstream.status}`);
      return jsonResponse(emptyParse(), 200);
    }

    const payload = (await upstream.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed: unknown = JSON.parse(raw);

    const check = validateAgainstSchema(parsed, cfg.responseSchema);
    if (!check.valid) {
      logDegradation(`схема: ${check.errors.join("; ")}`);
      return jsonResponse(emptyParse(), 200);
    }

    return jsonResponse(parsed, 200);
  } catch (error) {
    logDegradation(error instanceof Error ? error.message : "неизвестный сбой");
    return jsonResponse(emptyParse(), 200);
  } finally {
    clearTimeout(timer);
  }
}
