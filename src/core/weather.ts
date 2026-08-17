/**
 * Погода — единственный источник правды о штормах и температуре.
 *
 * Скрытый от игрока слой состояния мира. В Журнал фактов не пишет никогда.
 * Не знает, где стоят вышка, город и структуры: чистая функция от координаты.
 * История хранится всю партию — иначе сломается шторм-алиби по старым меткам.
 */

import type { WeatherConfig } from "../config/types.js";
import type { Rng } from "./rng.js";
import { Schedule } from "./time.js";
import { allQuadrants, type Moment, type Quadrant, type Tickable } from "./types.js";

export interface StormInterval {
  quadrant: Quadrant;
  start: number;
  /** null — шторм ещё идёт. */
  end: number | null;
}

export class Weather implements Tickable {
  readonly systemId = "погода";

  private active = new Map<Quadrant, boolean>();
  private history: StormInterval[] = [];
  private schedule: Schedule;
  private quadrants: Quadrant[];

  constructor(
    private readonly cfg: WeatherConfig,
    private readonly rng: Rng,
    cols: number,
    rows: number,
  ) {
    this.quadrants = allQuadrants(cols, rows);
    for (const q of this.quadrants) this.active.set(q, false);
    this.schedule = new Schedule(cfg.tickMinutes, cfg.tickMinutes);
  }

  tick(now: Moment): void {
    const times = this.schedule.due(now.totalMinutes);
    for (let i = 0; i < times; i++) {
      this.roll(now.totalMinutes);
    }
  }

  private roll(nowMinutes: number): void {
    // Каждый квадрант катает свою вероятность независимо; соседи не влияют.
    for (const q of this.quadrants) {
      const storming = this.active.get(q) === true;
      if (!storming) {
        if (this.rng.chance(this.cfg.stormStartChance)) {
          this.active.set(q, true);
          this.history.push({ quadrant: q, start: nowMinutes, end: null });
        }
      } else if (this.rng.chance(this.cfg.stormEndChance)) {
        this.active.set(q, false);
        for (let i = this.history.length - 1; i >= 0; i--) {
          const rec = this.history[i];
          if (rec && rec.quadrant === q && rec.end === null) {
            rec.end = nowMinutes;
            break;
          }
        }
      }
    }
  }

  /** Статус шторма в квадранте прямо сейчас. */
  isStorm(quadrant: Quadrant): boolean {
    return this.active.get(quadrant) === true;
  }

  /** Был ли квадрант под штормом в момент T в прошлом. Сырой факт, без оценки. */
  wasStorm(quadrant: Quadrant, atMinute: number): boolean {
    return this.history.some(
      (rec) =>
        rec.quadrant === quadrant && rec.start <= atMinute && (rec.end === null || atMinute < rec.end),
    );
  }

  /** Полная картина по квадрантам — читает Генератор эфира в час метеосводки. */
  snapshot(): Array<{ quadrant: Quadrant; storm: boolean }> {
    return this.quadrants.map((q) => ({ quadrant: q, storm: this.isStorm(q) }));
  }

  /** Базовая кривая от дня партии и часа суток; к квадранту не привязана. */
  baseTemperature(now: Moment): number {
    const daily = this.cfg.dailyAmplitude * Math.sin(((now.hour - 6) / 24) * 2 * Math.PI);
    return this.cfg.baseTemperature + daily + this.cfg.driftPerDay * (now.day - 1);
  }

  get stormPenalty(): number {
    return this.cfg.stormTemperaturePenalty;
  }

  get intervals(): readonly StormInterval[] {
    return this.history;
  }
}
