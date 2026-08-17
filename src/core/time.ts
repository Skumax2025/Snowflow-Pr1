/**
 * Время — счётчик, а не диспетчер (заметка «Время»).
 *
 * Хранит только счётчик минут с начала партии, номер дня и флаг ночь/день.
 * Ничего не знает о метео, газете, поставке и рапорте: расписания принадлежат
 * тем системам, которым принадлежат по смыслу.
 */

import type { EventBus } from "./bus.js";
import { EV, type NewDayPayload } from "./events.js";
import type { Moment } from "./types.js";

export interface DayConfig {
  /** Длина суток в минутах. */
  minutesPerDay: number;
  /** Час рассвета (0..23). */
  dawnHour: number;
  /** Час заката (0..23). */
  duskHour: number;
}

export class GameTime {
  private minutes = 0;
  private day = 1;
  private night: boolean;

  constructor(
    private readonly cfg: DayConfig,
    private readonly bus: EventBus,
  ) {
    this.night = this.computeNight(0);
  }

  /** Прибавляет минуты. Больше Время не делает ничего. */
  advance(amount: number): void {
    if (amount <= 0) return;
    const before = this.minutes;
    this.minutes = before + amount;

    // Полночь может быть пересечена больше одного раза, если приращение
    // длиннее суток: событие испускается ровно раз на каждый переход.
    const dayBefore = Math.floor(before / this.cfg.minutesPerDay);
    const dayAfter = Math.floor(this.minutes / this.cfg.minutesPerDay);
    for (let d = dayBefore + 1; d <= dayAfter; d++) {
      this.day = d + 1;
      this.bus.emit<NewDayPayload>(EV.NEW_DAY, { day: this.day });
    }

    this.night = this.computeNight(this.minutes);
  }

  get totalMinutes(): number {
    return this.minutes;
  }

  get moment(): Moment {
    const minuteOfDay = this.minutes % this.cfg.minutesPerDay;
    return {
      totalMinutes: this.minutes,
      day: this.day,
      hour: Math.floor(minuteOfDay / 60),
      minute: minuteOfDay % 60,
      isNight: this.night,
    };
  }

  /** Абсолютная метка ближайшего наступления часа H (строго в будущем). */
  nextOccurrenceOfHour(hour: number): number {
    const minuteOfDay = this.minutes % this.cfg.minutesPerDay;
    const dayStart = this.minutes - minuteOfDay;
    const target = hour * 60;
    return target > minuteOfDay ? dayStart + target : dayStart + this.cfg.minutesPerDay + target;
  }

  private computeNight(totalMinutes: number): boolean {
    const hour = Math.floor((totalMinutes % this.cfg.minutesPerDay) / 60);
    const { dawnHour, duskHour } = this.cfg;
    if (dawnHour <= duskHour) {
      return hour < dawnHour || hour >= duskHour;
    }
    // Вырожденный конфиг (закат раньше рассвета) — ночь посередине суток.
    return hour >= duskHour && hour < dawnHour;
  }
}

/**
 * Расписание: система сама сверяет момент партии со своим интервалом.
 * Общий помощник, чтобы каждая система не заводила свой счётчик заново.
 */
export class Schedule {
  private nextAt: number;

  constructor(
    private readonly intervalMinutes: number,
    startAt = 0,
  ) {
    this.nextAt = startAt;
  }

  /** Сколько раз расписание сработало к текущему моменту. Обычно 0 или 1. */
  due(nowMinutes: number): number {
    if (this.intervalMinutes <= 0) return 0;
    let count = 0;
    while (nowMinutes >= this.nextAt) {
      this.nextAt += this.intervalMinutes;
      count++;
      if (count > 100000) break;
    }
    return count;
  }

  get next(): number {
    return this.nextAt;
  }
}

/** Расписание суточного якоря: срабатывает раз в сутки в свой час. */
export class DailySchedule {
  private lastFiredDay = 0;

  constructor(private readonly hour: number) {}

  due(now: Moment): boolean {
    if (now.day === this.lastFiredDay) return false;
    if (now.hour < this.hour) return false;
    this.lastFiredDay = now.day;
    return true;
  }
}
