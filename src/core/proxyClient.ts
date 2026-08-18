/**
 * Клиент к Прокси к Gemini.
 *
 * Единственная точка, где игра говорит с внешним LLM, живёт на сервере
 * (`api/parse.ts`). Здесь — только вызов эндпоинта и гарантия того, что
 * наружу всегда уходит валидный по форме разбор.
 *
 * Деградация — единый класс исходов: невалидный JSON, таймаут, ошибка квоты
 * или сети, недействительный ключ, превышение рейт-лимита. Вызывающая сторона
 * настоящий ответ от подделки не отличает.
 */

import type { ProxyConfig } from "../config/types.js";
import { validateAgainstSchema } from "./schema.js";

export interface ParsedClaim {
  id: string;
  subject: string;
  action: string;
  place: string;
  time: string;
  confidence: number;
}

export interface ParseResponse {
  claims: ParsedClaim[];
  tone: { inspiration: number; anxiety: number; specificity: number };
  offtopic: { flag: boolean; text: string };
}

/** Справочник имён — словарь, а не состояние мира. */
export interface Glossary {
  structures: Array<{ kind: string; quadrant: string }>;
  factions: string[];
  grid: { cols: number; rows: number; format: string };
}

export interface ProxyClient {
  parse(text: string, glossary: Glossary): Promise<ParseResponse>;
}

export function emptyParse(cfg: ProxyConfig): ParseResponse {
  return {
    claims: [],
    tone: { ...cfg.emptyParse.tone },
    offtopic: { flag: false, text: "" },
  };
}

export class HttpProxyClient implements ProxyClient {
  constructor(private readonly cfg: ProxyConfig) {}

  async parse(text: string, glossary: Glossary): Promise<ParseResponse> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.cfg.timeoutSeconds * 1000);
      const response = await fetch(this.cfg.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, glossary }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) return emptyParse(this.cfg);
      const data: unknown = await response.json();
      const check = validateAgainstSchema(data, this.cfg.responseSchema);
      if (!check.valid) return emptyParse(this.cfg);
      return data as ParseResponse;
    } catch {
      // Любой сбой сводится к одному классу исходов.
      return emptyParse(this.cfg);
    }
  }
}
