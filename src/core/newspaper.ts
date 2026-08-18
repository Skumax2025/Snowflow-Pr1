/**
 * Газета — единственный канал, где игрок узнаёт цену вчерашних решений.
 *
 * Мир напрямую не читает: только то, что мир уже записал в Журнал фактов,
 * включая агрегатный итог рапорта от Города. Причинность не вычисляет —
 * переводит готовый факт в читаемую фразу по таблице шаблонов.
 */

import type { NewspaperConfig } from "../config/types.js";
import type { EventBus } from "./bus.js";
import { EV } from "./events.js";
import { REPORT_PROCESSED, type Journal } from "./journal.js";
import type { FactId } from "./types.js";
import type { Rng } from "./rng.js";
import { DailySchedule } from "./time.js";
import type { Moment, Tickable } from "./types.js";

export interface Issue {
  day: number;
  atMinute: number;
  farewell: boolean;
  verdicts: string[];
  digest: string[];
  watchTimer: string | null;
}

interface ProcessedClaim {
  category: string;
  factId: FactId | null;
}

/** Выпуск, который не влезает на страницу, игрок не читает вовсе. */
function trim(lines: string[], limit: number, unit: string): string[] {
  if (lines.length <= limit) return lines;
  const rest = lines.length - limit;
  const tail = `…и ещё ${rest} ${plural(rest, unit)} — подробности в эфире.`;
  return [...lines.slice(0, limit), tail];
}

function plural(count: number, unit: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return unit;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${unit}а`;
  return `${unit}й`;
}

export class Newspaper implements Tickable {
  readonly systemId = "газета";

  private schedule: DailySchedule;
  private lastIssueMinute = 0;
  private farewellShown = false;
  private issues: Issue[] = [];

  constructor(
    private readonly cfg: NewspaperConfig,
    private readonly journal: Journal,
    private readonly rng: Rng,
    private readonly bus: EventBus,
  ) {
    this.schedule = new DailySchedule(cfg.hour);
  }

  tick(now: Moment): void {
    if (!this.schedule.due(now)) return;
    if (this.farewellShown) return; // после прощального издания Газета молчит

    if (this.journal.hasCityDead()) {
      this.farewellShown = true;
      this.publish({
        day: now.day,
        atMinute: now.totalMinutes,
        farewell: true,
        verdicts: [],
        digest: [this.cfg.farewellIssue],
        watchTimer: null,
      });
      return;
    }

    this.publish(this.buildIssue(now));
  }

  private buildIssue(now: Moment): Issue {
    const from = this.lastIssueMinute;
    const to = now.totalMinutes + 1;

    // Блок вердиктов: агрегатные записи «рапорт обработан» за окно.
    const verdicts: string[] = [];
    const usedFacts = new Set<FactId>();
    for (const record of this.journal.query({ eventType: REPORT_PROCESSED, fromTime: from, toTime: to })) {
      const payload = this.journal.payloadOf(record.id) as ProcessedClaim[] | undefined;
      for (const claim of payload ?? []) {
        if (claim.factId) {
          usedFacts.add(claim.factId);
          const fact = this.journal.byId(claim.factId);
          const template = this.cfg.verdictTemplates[claim.category] ?? "{событие}: {квадрант}";
          verdicts.push(
            template
              .replace("{событие}", this.humanEvent(fact?.eventType ?? ""))
              .replace("{квадрант}", fact?.place ?? "—"),
          );
        } else {
          verdicts.push(
            this.cfg.verdictTemplates[`${claim.category}_без_факта`] ??
              `Неподтверждённое заявление, категория: ${claim.category}.`,
          );
        }
      }
    }

    // Блок дайджеста: записи за то же окно, не упомянутые ни в одном id_факта.
    const digest: string[] = [];
    for (const record of this.journal.query({ fromTime: from, toTime: to })) {
      if (record.eventType === REPORT_PROCESSED) continue;
      if (usedFacts.has(record.id)) continue;
      const template = this.cfg.eventTemplates[record.eventType];
      if (!template) continue;
      digest.push(template.replace("{квадрант}", record.place));
    }

    const trimmedVerdicts = trim(verdicts, this.cfg.maxVerdictLines, "доклад");
    const trimmedDigest = trim(digest, this.cfg.maxDigestLines, "сообщение");

    const watchTimer = this.rng.chance(this.cfg.watchTimerChance)
      ? this.rng.pick(this.cfg.watchTimerFlavor)
      : null;

    return {
      day: now.day,
      atMinute: now.totalMinutes,
      farewell: false,
      verdicts: trimmedVerdicts,
      digest: trimmedDigest,
      watchTimer,
    };
  }

  private humanEvent(eventType: string): string {
    return eventType.replace(/_/g, " ");
  }

  private publish(issue: Issue): void {
    this.issues.push(issue);
    this.lastIssueMinute = issue.atMinute + 1;
    this.bus.emit(EV.ISSUE_READY, { day: issue.day });
  }

  /** Готовый выпуск отдаётся по запросу интерфейсу Стола. */
  latest(): Issue | null {
    return this.issues[this.issues.length - 1] ?? null;
  }

  get all(): readonly Issue[] {
    return this.issues;
  }

  get silenced(): boolean {
    return this.farewellShown;
  }
}
