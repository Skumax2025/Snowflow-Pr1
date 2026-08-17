/**
 * Парсер — единственная точка, где рапорт игрока встречается с LLM.
 *
 * Модель ничего не считает, только размечает текст. Дальше работает офлайн-код:
 * сверка claims с Журналом фактов и упаковка вердикта в одно явное событие
 * Городу. Дельты характеристик Парсер не считает и не применяет.
 *
 * Парсер стейтлесс: истории прошлых рапортов не помнит, второй рапорт до
 * обработки первого разрешён.
 */

import type { ProxyConfig } from "../config/types.js";
import type { EventBus } from "./bus.js";
import {
  EV,
  type ClaimVerdict,
  type ClaimVerdictCategory,
  type OfftopicPayload,
  type ReportSentPayload,
  type ReportVerdictPayload,
} from "./events.js";
import type { FactRecord, Journal } from "./journal.js";
import type { Glossary, ParsedClaim, ProxyClient } from "./proxyClient.js";
import type { StructureRegistry } from "./structures.js";
import type { GameTime } from "./time.js";
import type { FactionKind } from "./types.js";

export interface ParserPeers {
  structures: StructureRegistry;
  factions: FactionKind[];
  grid: { cols: number; rows: number };
}

export class Parser {
  /** Только для тестов и UI: последний запущенный разбор. */
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly cfg: ProxyConfig,
    private readonly journal: Journal,
    private readonly time: GameTime,
    private readonly peers: ParserPeers,
    private readonly proxy: ProxyClient,
    private readonly bus: EventBus,
  ) {
    bus.on<ReportSentPayload>(EV.REPORT_SENT, (p) => {
      // Вызов модели асинхронный — Терминал ответа не ждёт.
      const task = this.handle(p.text);
      this.inFlight = this.inFlight.then(() => task).catch(() => undefined);
    });
  }

  /** Ждёт завершения всех запущенных разборов. Нужен тестам, не игре. */
  async settled(): Promise<void> {
    await this.inFlight;
  }

  /** Справочник имён: словарь, а не состояние мира. */
  private glossary(): Glossary {
    return {
      structures: this.peers.structures.alive().map((s) => ({ kind: s.kind, quadrant: s.quadrant })),
      factions: [...this.peers.factions],
      grid: { cols: this.peers.grid.cols, rows: this.peers.grid.rows, format: "буква+цифра" },
    };
  }

  private async handle(text: string): Promise<void> {
    const response = await this.proxy.parse(text, this.glossary());

    const verdicts: ClaimVerdict[] = response.claims.map((claim) => this.judge(claim));

    this.bus.emit<ReportVerdictPayload>(EV.REPORT_VERDICT, {
      verdicts,
      tone: response.tone,
    });

    // Офтопик уходит отдельным событием, минуя Город и минуя «вердикт_рапорта».
    if (response.offtopic.flag && response.offtopic.text.length > 0) {
      this.bus.emit<OfftopicPayload>(EV.OFFTOPIC_FOUND, { text: response.offtopic.text });
    }
  }

  /** Сверка одного claim с Журналом по (субъект, место, время). */
  private judge(claim: ParsedClaim): ClaimVerdict {
    const place = claim.place.trim().toUpperCase();
    const candidates = place ? this.journal.query({ place }) : [...this.journal.all];

    const claimMinute = this.parseTime(claim.time);
    let exact: FactRecord | null = null;
    let partial: FactRecord | null = null;

    for (const record of candidates) {
      if (!this.subjectMatches(claim, record)) continue;
      if (!partial) partial = record;
      if (claimMinute === null) {
        exact = record;
        break;
      }
      if (Math.abs(record.time - claimMinute) <= this.cfg.matching.timeToleranceMinutes) {
        exact = record;
        break;
      }
    }

    if (exact) {
      return { claimId: claim.id, category: "правда", factId: exact.id };
    }

    // Противоречит записи или события не было вовсе: категорию разделяет
    // заявленная автором уверенность.
    const category: ClaimVerdictCategory =
      claim.confidence >= this.cfg.matching.confidenceThreshold ? "ложь" : "неточность";
    return { claimId: claim.id, category, factId: partial?.id ?? null };
  }

  private subjectMatches(claim: ParsedClaim, record: FactRecord): boolean {
    const haystack = `${record.subject} ${record.eventType} ${record.status}`.toLowerCase();
    const subject = claim.subject.trim().toLowerCase();
    const action = claim.action.trim().toLowerCase();
    const hit = (needle: string) =>
      needle.length > 2 && (haystack.includes(needle) || needle.includes(record.eventType.toLowerCase()));
    return hit(subject) || hit(action);
  }

  /** «14:20» или «870» — иначе время не проверяется. */
  private parseTime(raw: string): number | null {
    const text = raw.trim();
    if (!text) return null;
    const hhmm = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (hhmm) {
      const dayStart =
        this.time.totalMinutes - (this.time.moment.hour * 60 + this.time.moment.minute);
      return dayStart + Number(hhmm[1]) * 60 + Number(hhmm[2]);
    }
    const asNumber = Number(text);
    return Number.isFinite(asNumber) ? asNumber : null;
  }
}
