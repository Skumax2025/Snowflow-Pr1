/**
 * Игровой цикл — единственное место, которое собирает игру в целое.
 *
 * Владеет конфигом партии, порядком обхода систем, шагом лупа и фактом,
 * запущена партия или остановлена. Не знает, что делает каждая система
 * на своём тике.
 *
 * Ход времени: действия игрока и Стенд шлют «потратить N минут»; луп режет
 * интервал на шаги «шаг_лупа», на каждом шаге двигает Время и обходит все
 * тикающие системы. Перемотка сном идёт тем же путём — второго, «ускоренного»
 * пути исполнения в проекте нет (мастер-концепт 4.7).
 */

import type { EventBus } from "./bus.js";
import { EV, type RewindPayload, type SpendMinutesPayload } from "./events.js";
import type { GameTime } from "./time.js";
import type { Tickable } from "./types.js";

export class GameLoop {
  private systems: Tickable[] = [];
  private running = true;
  private pumping = false;
  private pending: number[] = [];
  /** Счётчик шагов — метрика для «Первого среза» и Стенда. */
  private stepCount = 0;

  constructor(
    private readonly time: GameTime,
    private readonly bus: EventBus,
    private readonly stepMinutes: number,
  ) {
    this.bus.on<SpendMinutesPayload>(EV.SPEND_MINUTES, (p) => this.enqueue(p.minutes));
    this.bus.on<RewindPayload>(EV.REWIND_TO_HOUR, (p) => {
      this.enqueue(Math.max(0, p.targetMinute - this.time.totalMinutes));
    });
    this.bus.on(EV.GAME_OVER, () => {
      this.running = false;
    });
  }

  /**
   * Порядок регистрации = порядок обхода. Константа, не данные для тюнинга:
   * от него зависит воспроизводимость прогона.
   */
  register(system: Tickable): void {
    this.systems.push(system);
  }

  get order(): string[] {
    return this.systems.map((s) => s.systemId);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get steps(): number {
    return this.stepCount;
  }

  /** Продвинуть партию на N минут шагами шага лупа. */
  advance(minutes: number): void {
    this.enqueue(minutes);
  }

  private enqueue(minutes: number): void {
    if (minutes <= 0) return;
    this.pending.push(minutes);
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.pending.length > 0) {
        const chunk = this.pending.shift() as number;
        this.pump(chunk);
      }
    } finally {
      this.pumping = false;
    }
  }

  private pump(minutes: number): void {
    let left = minutes;
    while (left > 0) {
      if (!this.running) return;
      const step = Math.min(this.stepMinutes, left);
      this.time.advance(step);
      left -= step;
      this.tickAll();
    }
  }

  private tickAll(): void {
    this.stepCount += 1;
    const now = this.time.moment;
    for (const system of this.systems) {
      if (!this.running) return;
      system.tick(now);
    }
  }
}
