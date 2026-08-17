/**
 * Сон — единственный способ снять Усталость и один из способов перемотать
 * время крупным куском. Час пробуждения выбирает игрок.
 *
 * Сон не считает ни одной дельты и не хранит состояния между вызовами:
 * он шлёт Времени перемотку (её перехватывает Игровой цикл) и Радисту
 * «сон_завершён» с фактической длительностью.
 */

import type { SleepConfig } from "../config/types.js";
import type { EventBus } from "./bus.js";
import { EV, type RewindPayload, type SleepFinishedPayload } from "./events.js";
import type { GameTime } from "./time.js";

export interface SleepGate {
  /** Флаг «спать нельзя» — готовое значение от Радиста. Порога Сон не знает. */
  readonly cannotSleep: boolean;
}

export type SleepRefusal = "холодно" | "слишком_далеко" | null;

export class Sleep {
  constructor(
    private readonly cfg: SleepConfig,
    private readonly time: GameTime,
    private readonly radioman: SleepGate,
    private readonly bus: EventBus,
  ) {}

  /** Почему лечь нельзя прямо сейчас — для UI, без побочных эффектов. */
  refusalFor(wakeHour: number): SleepRefusal {
    if (this.radioman.cannotSleep) return "холодно";
    const target = this.time.nextOccurrenceOfHour(wakeHour);
    if (target - this.time.totalMinutes > this.cfg.maxHours * 60) return "слишком_далеко";
    return null;
  }

  /** Возвращает фактическую длительность сна в минутах или 0, если отказано. */
  sleepUntil(wakeHour: number): number {
    if (this.refusalFor(wakeHour) !== null) return 0;

    const target = this.time.nextOccurrenceOfHour(wakeHour);
    const duration = target - this.time.totalMinutes;

    // Игровой цикл перехватит перемотку и прогонит интервал обычными шагами:
    // мир во сне живёт честно.
    this.bus.emit<RewindPayload>(EV.REWIND_TO_HOUR, { targetMinute: target });
    this.bus.emit<SleepFinishedPayload>(EV.SLEEP_FINISHED, { minutes: duration });
    return duration;
  }

  get maxHours(): number {
    return this.cfg.maxHours;
  }
}
