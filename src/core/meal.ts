/**
 * Приём пищи — единственное действие, конвертирующее Еду в снижение Голода.
 *
 * Само значение Голода не трогает: это чужое состояние, наружу уходит дельта.
 * При нуле порций действие недоступно — потеря времени без выбора внутри неё.
 */

import type { MealConfig } from "../config/types.js";
import type { EventBus } from "./bus.js";
import { EV, type RationsPayload, type ReduceHungerPayload, type SpendMinutesPayload } from "./events.js";

export class Meal {
  private portions: number;

  constructor(
    private readonly cfg: MealConfig,
    private readonly bus: EventBus,
    startingPortions: number,
  ) {
    this.portions = startingPortions;
    bus.on<RationsPayload>(EV.ADD_RATIONS, (p) => {
      this.portions += p.portions;
    });
  }

  get available(): boolean {
    return this.portions > 0;
  }

  get count(): number {
    return this.portions;
  }

  /** Порция целая и неделимая: эффект фиксированный, от уровня Голода не зависит. */
  eat(): boolean {
    if (!this.available) return false;
    this.portions -= 1;
    this.bus.emit<ReduceHungerPayload>(EV.REDUCE_HUNGER, { amount: this.cfg.hungerReduction });
    this.bus.emit<SpendMinutesPayload>(EV.SPEND_MINUTES, {
      minutes: this.cfg.minutes,
      source: "приём_пищи",
    });
    return true;
  }
}
