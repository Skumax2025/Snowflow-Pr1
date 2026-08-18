/**
 * Фильтр аномалий — клиентская половина киллер-фичи.
 *
 * Ловит офтопик от Парсера и кладёт его в Базу аномалий (fire-and-forget),
 * а по запросу Галлюцинаций отдаёт одно чужое аппрувленное сообщение, ещё
 * не проигранное в этой партии. Как именно голос подаётся игроку — решает
 * не эта система.
 */

import type { AnomalyFilterConfig } from "../config/types.js";
import type { EventBus } from "./bus.js";
import { EV, type OfftopicPayload } from "./events.js";

export interface AnomalyTransport {
  /** Запись офтопика. Обратной связи нет и не ждём. */
  write(text: string): void;
  /** Список approved-сообщений, один запрос за партию. */
  readApproved(): Promise<Array<{ id: string; text: string }>>;
}

export class HttpAnomalyTransport implements AnomalyTransport {
  constructor(private readonly cfg: AnomalyFilterConfig) {}

  write(text: string): void {
    void fetch(this.cfg.endpointWrite, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => undefined);
  }

  async readApproved(): Promise<Array<{ id: string; text: string }>> {
    try {
      const response = await fetch(this.cfg.endpointRead);
      if (!response.ok) return [];
      return (await response.json()) as Array<{ id: string; text: string }>;
    } catch {
      return [];
    }
  }
}

export class AnomalyFilter {
  /** Кэш approved на партию: повторных обращений за списком в партии нет. */
  private cache: Array<{ id: string; text: string }> = [];
  /** id, уже выданные в этой партии. Пустой на старте. */
  private issued = new Set<string>();

  constructor(
    cfg: AnomalyFilterConfig,
    private readonly transport: AnomalyTransport,
    bus: EventBus,
  ) {
    this.cache = cfg.seedMessages.map((text, index) => ({ id: `seed${index}`, text }));
    bus.on<OfftopicPayload>(EV.OFFTOPIC_FOUND, (p) => this.transport.write(p.text));
  }

  /** Однократная загрузка кэша при старте партии. */
  async loadCache(): Promise<void> {
    const remote = await this.transport.readApproved();
    if (remote.length > 0) this.cache = remote;
  }

  /** Ответ Галлюцинациям: текст или «пусто». */
  requestVoice(pick: (items: Array<{ id: string; text: string }>) => { id: string; text: string }): string | null {
    const available = this.cache.filter((m) => !this.issued.has(m.id));
    if (available.length === 0) return null;
    const chosen = pick(available);
    this.issued.add(chosen.id);
    return chosen.text;
  }

  get cachedCount(): number {
    return this.cache.length;
  }
}
