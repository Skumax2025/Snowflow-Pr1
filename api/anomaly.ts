/**
 * База аномалий — серверное хранилище офтопик-сообщений.
 *
 * POST — запись текста со статусом `pending`, fire-and-forget, закрыт
 * рейт-лимитом по IP: это открытый URL, дёргаемый кем угодно.
 * GET — список сообщений со статусом `approved`, один раз за партию.
 *
 * Аппрув делается вручную через табличный интерфейс провайдера БД. Отдельного
 * экрана модерации в игре нет и игрового кода под это не пишется.
 */

import { defaultConfig } from "../src/config/default.js";
import { checkRateLimit, clientIp, jsonResponse } from "./_shared.js";

const cfg = defaultConfig.anomalyFilter;

export type AnomalyStatus = "pending" | "approved" | "rejected";

export interface AnomalyMessage {
  id: string;
  text: string;
  status: AnomalyStatus;
  addedAt: string;
}

/**
 * Хранилище провайдера БД. Пока провайдер не выбран (открытый вопрос заметки
 * «Фильтр аномалий»), эндпоинт работает поверх памяти процесса: контракт
 * и рейт-лимит те же, замена — только в этих двух функциях.
 */
const store: AnomalyMessage[] = [];
let counter = 0;

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "GET") {
    return jsonResponse(
      store.filter((m) => m.status === "approved").map((m) => ({ id: m.id, text: m.text })),
      200,
    );
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false }, 405);
  }

  if (!checkRateLimit(`anomaly:${clientIp(request)}`, cfg.rateLimitPerIp)) {
    // Ответ тот же: клиент про судьбу записи ничего не узнаёт и не ждёт.
    return jsonResponse({ ok: true }, 200);
  }

  try {
    const body = (await request.json()) as { text?: string };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text.length > 0) {
      counter += 1;
      store.push({
        id: `a${counter}`,
        text,
        status: "pending",
        addedAt: new Date().toISOString(),
      });
    }
  } catch {
    // Молча: обратной связи Парсеру всё равно нет.
  }

  return jsonResponse({ ok: true }, 200);
}
