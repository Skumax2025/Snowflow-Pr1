/**
 * Генератор — сердце вышки. Владеет остатком топлива и уровнем Обогрева.
 *
 * Заправки как отдельного действия нет: топливо приходит автоматически
 * событием «пополнение топлива N» от Мостика. Игрок только регулирует расход.
 *
 * Наружу отдаёт «баланс тепла» — скорость изменения Тепла за минуту. В само
 * Тепло Генератор не лезет: его интегрирует Радист.
 */

import type { GeneratorConfig } from "../config/types.js";
import type { EventBus } from "./bus.js";
import { EV, type FuelPayload } from "./events.js";
import type { GameTime } from "./time.js";
import { clamp, type Quadrant } from "./types.js";
import type { Weather } from "./weather.js";

export class Generator {
  private fuel: number;
  private heating: number;
  private settledAt = 0;

  constructor(
    private readonly cfg: GeneratorConfig,
    private readonly time: GameTime,
    private readonly weather: Weather,
    private readonly towerQuadrant: Quadrant,
    bus: EventBus,
    startingFuel: number,
  ) {
    this.fuel = startingFuel;
    this.heating = cfg.heatingStart;

    bus.on<FuelPayload>(EV.FUEL_REFILL, (p) => {
      this.settle();
      this.fuel += p.amount;
    });
    bus.on<FuelPayload>(EV.SPEND_FUEL, (p) => {
      this.settle();
      // Топливо не уходит в минус: списывается остаток, действие проходит.
      this.fuel = Math.max(0, this.fuel - p.amount);
    });
  }

  /** Эффективная температура = базовая минус штраф, если над вышкой шторм. */
  effectiveTemperature(): number {
    const base = this.weather.baseTemperature(this.time.moment);
    return this.weather.isStorm(this.towerQuadrant) ? base - this.weather.stormPenalty : base;
  }

  private deficit(): number {
    return Math.max(0, this.cfg.comfortTemperature - this.effectiveTemperature());
  }

  /**
   * Непрерывный расход: при каждом обращении Генератор смотрит, сколько минут
   * прошло с последнего пересчёта, и списывает топливо по формуле.
   */
  private settle(): void {
    const now = this.time.totalMinutes;
    const elapsed = now - this.settledAt;
    if (elapsed <= 0) return;
    this.settledAt = now;

    const perMinute =
      this.cfg.fuelPerHeatingPerMinute * this.heating + this.cfg.fuelPerDeficitPerMinute * this.deficit();
    this.fuel = Math.max(0, this.fuel - perMinute * elapsed);
  }

  /** Регулировка уровня Обогрева игроком. Времени не тратит. */
  setHeating(level: number): void {
    this.settle();
    this.heating = clamp(Math.round(level), 0, this.cfg.heatingMax);
  }

  get heatingLevel(): number {
    return this.heating;
  }

  get fuelLeft(): number {
    this.settle();
    return this.fuel;
  }

  /** Фактический обогрев: без топлива клэмпится нулём. */
  private effectiveHeating(): number {
    return this.fuelLeft > 0 ? this.heating : 0;
  }

  /** «Баланс тепла» — единственное число, по которому Радист двигает Тепло. */
  heatBalance(): number {
    return this.cfg.heatPerHeating * this.effectiveHeating() - this.cfg.heatPerDeficit * this.deficit();
  }
}
