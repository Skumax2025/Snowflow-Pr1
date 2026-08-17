/**
 * Радист — тело и психика игрока.
 *
 * Четыре стока тикают сами по себе. Тепло — накопительная величина: Радист
 * читает у Генератора готовый «баланс тепла» и прибавляет его за прошедшие
 * минуты; дискретные дельты от Мостика ложатся сверху и следующим тиком
 * не стираются.
 *
 * Погоду Радист не читает вообще: температурный дефицит целиком считает
 * Генератор. Два независимых способа умереть — заморозка и рассудок.
 */

import type { RadiomanConfig } from "../config/types.js";
import type { EventBus } from "./bus.js";
import {
  EV,
  type ColdPayload,
  type DeathCause,
  type RadiomanDiedPayload,
  type ReduceHungerPayload,
  type SanityPayload,
  type SleepFinishedPayload,
} from "./events.js";
import { Schedule } from "./time.js";
import { clamp, type Moment, type Tickable } from "./types.js";

export interface HeatSource {
  heatBalance(): number;
}

export class Radioman implements Tickable {
  readonly systemId = "радист";

  private fatigue: number;
  private hunger: number;
  private warmth: number;
  private sanity: number;

  private lastMinute = 0;
  private coldStreakMinutes = 0;
  private dead = false;
  private schedule: Schedule;

  constructor(
    private readonly cfg: RadiomanConfig,
    private readonly heat: HeatSource,
    private readonly bus: EventBus,
  ) {
    this.fatigue = cfg.start.fatigue;
    this.hunger = cfg.start.hunger;
    this.warmth = cfg.start.warmth;
    this.sanity = cfg.start.sanity;
    this.schedule = new Schedule(cfg.tickMinutes, cfg.tickMinutes);

    bus.on<SleepFinishedPayload>(EV.SLEEP_FINISHED, (p) => this.onSleepFinished(p.minutes));
    bus.on<ReduceHungerPayload>(EV.REDUCE_HUNGER, (p) => {
      this.hunger = clamp(this.hunger - p.amount, 0, 100);
    });
    bus.on<SanityPayload>(EV.RESTORE_SANITY, (p) => {
      this.sanity = clamp(this.sanity + p.amount, 0, 100);
    });
    bus.on<ColdPayload>(EV.APPLY_COLD, (p) => {
      // Дискретная дельта накапливается, а не стирается следующим тиком.
      this.warmth = clamp(this.warmth - p.amount, 0, 100);
    });
  }

  tick(now: Moment): void {
    if (this.dead) return;
    if (this.schedule.due(now.totalMinutes) === 0) return;

    const elapsed = now.totalMinutes - this.lastMinute;
    this.lastMinute = now.totalMinutes;
    if (elapsed <= 0) return;

    this.fatigue = clamp(this.fatigue + this.cfg.fatiguePerMinute * elapsed, 0, 100);
    this.hunger = clamp(this.hunger + this.cfg.hungerPerMinute * elapsed, 0, 100);
    this.warmth = clamp(this.warmth + this.heat.heatBalance() * elapsed, 0, 100);

    const coldGap = Math.max(0, this.cfg.sanity.comfortWarmth - this.warmth);
    const sanityDrop =
      (this.cfg.sanity.fatigueWeight * (this.fatigue / 100) +
        this.cfg.sanity.hungerWeight * (this.hunger / 100) +
        this.cfg.sanity.coldWeight * (coldGap / 100)) *
      elapsed;
    this.sanity = clamp(this.sanity - sanityDrop, 0, 100);

    // Счётчик копится по фактически прошедшим минутам: долгий сон в холоде
    // убивает так же, как бодрствование в холоде.
    if (this.warmth < this.cfg.thresholds.freezing) {
      this.coldStreakMinutes += elapsed;
    } else {
      this.coldStreakMinutes = 0;
    }

    if (this.coldStreakMinutes >= this.cfg.thresholds.freezingDurationMinutes) {
      this.die("заморозка");
      return;
    }
    if (this.sanity <= 0) {
      this.die("рассудок");
    }
  }

  private onSleepFinished(minutes: number): void {
    if (this.dead) return;
    // Сон в тепле и при невысоком Голоде восстанавливает сильнее.
    const comfortable = this.warmth >= this.cfg.sanity.comfortWarmth && this.hunger < 50;
    const bonus = comfortable ? this.cfg.sleep.comfortBonus : 1;
    this.fatigue = clamp(this.fatigue - this.cfg.sleep.fatigueRecoveryPerMinute * minutes, 0, 100);
    this.sanity = clamp(
      this.sanity + this.cfg.sleep.sanityRecoveryPerMinute * minutes * bonus,
      0,
      100,
    );
  }

  private die(cause: DeathCause): void {
    if (this.dead) return;
    this.dead = true;
    this.bus.emit<RadiomanDiedPayload>(EV.RADIOMAN_DIED, { cause });
  }

  /** Флаг «спать нельзя» — отдаётся Сну по запросу, блокировка живёт там. */
  get cannotSleep(): boolean {
    return this.warmth < this.cfg.thresholds.cannotSleep;
  }

  get state(): { fatigue: number; hunger: number; warmth: number; sanity: number } {
    return { fatigue: this.fatigue, hunger: this.hunger, warmth: this.warmth, sanity: this.sanity };
  }

  get sanityValue(): number {
    return this.sanity;
  }

  get isDead(): boolean {
    return this.dead;
  }
}
