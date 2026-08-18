/**
 * Диагностика доступа к Gemini.
 *
 * Отвечает на единственный вопрос: доедет ли рапорт до модели или партия
 * молча пойдёт в деградированном режиме. Ключ наружу не отдаётся никогда —
 * только факт его наличия, длина и последние четыре символа, чтобы автор мог
 * убедиться, что подхватился нужный ключ, а не старый.
 */

import { defaultConfig } from "../src/config/default.js";
import { checkRateLimit, clientIp, jsonResponse } from "./_shared.js";

const cfg = defaultConfig.proxy;

export interface HealthReport {
  keyPresent: boolean;
  keyHint: string | null;
  model: string;
  reachable: boolean;
  status: number | null;
  /** Человекочитаемое объяснение и что делать дальше. */
  detail: string;
  latencyMs: number | null;
}

export default async function handler(request: Request): Promise<Response> {
  if (!checkRateLimit(`health:${clientIp(request)}`, cfg.rateLimitPerIp)) {
    return jsonResponse(
      {
        keyPresent: false,
        keyHint: null,
        model: cfg.model,
        reachable: false,
        status: null,
        detail: "Слишком часто. Подожди минуту и попробуй снова.",
        latencyMs: null,
      } satisfies HealthReport,
      200,
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonResponse(
      {
        keyPresent: false,
        keyHint: null,
        model: cfg.model,
        reachable: false,
        status: null,
        detail:
          "GEMINI_API_KEY не задан. Локально положи его в .env.local в корне проекта, " +
          "на Vercel — в переменные окружения проекта. Игра при этом работает: " +
          "рапорты уходят в деградированный разбор.",
        latencyMs: null,
      } satisfies HealthReport,
      200,
    );
  }

  const keyHint = `…${apiKey.slice(-4)} (${apiKey.length} симв.)`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutSeconds * 1000);

  try {
    // Самый дешёвый настоящий вызов: генерация одного токена той же моделью,
    // которой пользуется Прокси. Проверка списка моделей не поймала бы отказ
    // именно на этой модели.
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "ping" }] }],
          generationConfig: { maxOutputTokens: 1, temperature: 0 },
        }),
      },
    );

    const latencyMs = Date.now() - started;
    if (response.ok) {
      return jsonResponse(
        {
          keyPresent: true,
          keyHint,
          model: cfg.model,
          reachable: true,
          status: response.status,
          detail: "Связь есть. Рапорты пойдут в настоящий разбор.",
          latencyMs,
        } satisfies HealthReport,
        200,
      );
    }

    const text = await response.text();
    return jsonResponse(
      {
        keyPresent: true,
        keyHint,
        model: cfg.model,
        reachable: false,
        status: response.status,
        detail: explain(response.status, text),
        latencyMs,
      } satisfies HealthReport,
      200,
    );
  } catch (error) {
    return jsonResponse(
      {
        keyPresent: true,
        keyHint,
        model: cfg.model,
        reachable: false,
        status: null,
        detail:
          error instanceof Error && error.name === "AbortError"
            ? `Таймаут ${cfg.timeoutSeconds} с. Сеть недоступна или Gemini не отвечает.`
            : `Сетевой сбой: ${error instanceof Error ? error.message : "неизвестно"}.`,
        latencyMs: Date.now() - started,
      } satisfies HealthReport,
      200,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Коды Gemini переводятся в то, что автору надо сделать руками. */
function explain(status: number, body: string): string {
  const snippet = body.slice(0, 300);
  if (status === 400) return `Запрос отклонён (400). Часто это неверный формат ключа. ${snippet}`;
  if (status === 401 || status === 403) {
    return (
      `Ключ отвергнут (${status}). Проверь, что это обычный API-ключ из Google AI Studio, ` +
      `что он не истёк и что для него включён Generative Language API. ${snippet}`
    );
  }
  if (status === 404) {
    return (
      `Модель «${cfg.model}» недоступна для этого ключа (404). На бесплатном тарифе ` +
      `доступны только Flash и Flash-Lite — поменяй proxy.model в конфиге. ${snippet}`
    );
  }
  if (status === 429) return `Квота исчерпана (429). Лимиты считаются на проект, а не на ключ. ${snippet}`;
  if (status >= 500) return `Сбой на стороне Gemini (${status}). ${snippet}`;
  return `Неожиданный ответ ${status}. ${snippet}`;
}
