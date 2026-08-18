/**
 * Финал — конец партии как отдельная система.
 *
 * Победы не существует: партия всегда заканчивается смертью радиста.
 * Отличается только то, в каком мире он умер. Смерть города партию не
 * заканчивает — она только поднимает флаг.
 */

import type { EndingConfig } from "../config/types.js";
import type { EventBus } from "./bus.js";
import { EV, type DeathCause, type RadiomanDiedPayload } from "./events.js";
import { REPORT_PROCESSED, type Journal } from "./journal.js";
import { Schedule } from "./time.js";
import type { Moment, Tickable } from "./types.js";

export type EndingRoute = "вахта_окончена" | "последний_в_эфире";

export interface EndingScreen {
  route: EndingRoute;
  cause: DeathCause;
  text: string;
  summary: {
    days: number;
    reports: number;
    confirmedClaims: number;
    cityCharacteristics: Record<string, number>;
  };
}

export interface FinalCityView {
  characteristics: Record<string, number>;
}

export class Ending implements Tickable {
  readonly systemId = "финал";

  /** Собственная копия флага; поднимается один раз, обратно не опускается. */
  private cityDead = false;
  private screen: EndingScreen | null = null;
  private schedule: Schedule;
  private lastMinute = 0;

  constructor(
    private readonly cfg: EndingConfig,
    private readonly journal: Journal,
    private readonly city: FinalCityView,
    private readonly minutesPerDay: number,
    private readonly bus: EventBus,
  ) {
    this.schedule = new Schedule(cfg.tickMinutes, cfg.tickMinutes);
    bus.on<RadiomanDiedPayload>(EV.RADIOMAN_DIED, (p) => this.onDeath(p.cause));
  }

  tick(now: Moment): void {
    this.lastMinute = now.totalMinutes;
    if (this.schedule.due(now.totalMinutes) === 0) return;
    if (!this.cityDead && this.journal.hasCityDead()) this.cityDead = true;
  }

  private onDeath(cause: DeathCause): void {
    if (this.screen) return; // «радист_умер» приходит ровно один раз за партию
    if (!this.cityDead && this.journal.hasCityDead()) this.cityDead = true;

    const route: EndingRoute = this.cityDead ? "последний_в_эфире" : "вахта_окончена";
    const reports = this.journal.query({ eventType: REPORT_PROCESSED });
    let confirmed = 0;
    for (const record of reports) {
      const payload = this.journal.payloadOf(record.id) as
        | Array<{ category: string; factId: string | null }>
        | undefined;
      for (const claim of payload ?? []) {
        if (claim.category === "правда") confirmed += 1;
      }
    }

    this.screen = {
      route,
      cause,
      text: this.cfg.routes[`${route}:${cause}`] ?? "",
      summary: {
        days: Math.floor(this.lastMinute / this.minutesPerDay) + 1,
        reports: reports.length,
        confirmedClaims: confirmed,
        cityCharacteristics: { ...this.city.characteristics },
      },
    };

    // Луп останавливается: тикать больше некому и незачем.
    this.bus.emit(EV.GAME_OVER, {});
  }

  /** Пока «радист_умер» не пришёл, Финал ничего не показывает. */
  get endScreen(): EndingScreen | null {
    return this.screen;
  }

  get isOver(): boolean {
    return this.screen !== null;
  }

  get knowsCityDead(): boolean {
    return this.cityDead;
  }
}
