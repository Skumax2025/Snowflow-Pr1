/**
 * Мостик — экран с двумя действиями и, отдельно, такт получения припасов.
 *
 * «Смотреть» — бесплатно и мгновенно: единственная неподделываемая информация
 * в игре. «Остаться» — платно: лечит Рассудок ценой Тепла, с эскалацией холода
 * после безопасного времени. «Остаться» не блокируется даже при критическом
 * Тепле: это единственное место, где игрок может осознанно разменять жизнь
 * на ясную голову. Смерть от холода целиком в Радисте.
 */

import type { BridgeConfig } from "../config/types.js";
import type { EventBus } from "./bus.js";
import {
  EV,
  type ColdPayload,
  type FuelPayload,
  type RationsPayload,
  type SanityPayload,
  type SpendMinutesPayload,
} from "./events.js";
import type { Journal } from "./journal.js";
import { DailySchedule } from "./time.js";
import type { Moment, Quadrant, Tickable } from "./types.js";
import type { Weather } from "./weather.js";

export interface CityView {
  destruction(): number;
  supplyVolume(): number;
}

export interface BridgeSight {
  /** Тир картинки города или надгробие. */
  city: string;
  /** Вид ухудшен штормом над квадрантом города. */
  degraded: boolean;
  sky: { hour: number; isNight: boolean; day: number; storm: boolean };
}

export interface LastSupply {
  volume: number;
  fuel: number;
  portions: number;
  atMinute: number;
}

export class Bridge implements Tickable {
  readonly systemId = "мостик";

  private minutesInARow = 0;
  private tombstone = false;
  private lastSupply: LastSupply | null = null;
  private schedule: DailySchedule;
  private lastSupplyDay = 0;

  constructor(
    private readonly cfg: BridgeConfig,
    private readonly city: CityView,
    private readonly weather: Weather,
    private readonly journal: Journal,
    private readonly cityQuadrant: Quadrant,
    private readonly towerQuadrant: Quadrant,
    private readonly bus: EventBus,
  ) {
    this.schedule = new DailySchedule(cfg.supplyHour);
  }

  tick(now: Moment): void {
    // Режим надгробия обнаруживается тем же способом, что у Газеты.
    if (!this.tombstone && this.journal.hasCityDead()) {
      this.tombstone = true;
    }

    if (!this.schedule.due(now)) return;
    if (this.tombstone) return; // поставок больше нет
    if (now.day - this.lastSupplyDay < this.cfg.supplyPeriodDays) return;
    this.lastSupplyDay = now.day;
    this.deliverSupply(now);
  }

  /**
   * Такт поставки — не игровое действие. Объём Город уже клэмпнул полом,
   * так что даже при нулевом Доверии придёт минимальный паёк.
   */
  private deliverSupply(now: Moment): void {
    const volume = this.city.supplyVolume();
    const fuel = volume * this.cfg.fuelShare;
    const foodVolume = volume - fuel;
    const portions = Math.floor(foodVolume / this.cfg.rationVolume);

    this.bus.emit<FuelPayload>(EV.FUEL_REFILL, { amount: fuel, source: "мостик" });
    this.bus.emit<RationsPayload>(EV.ADD_RATIONS, { portions });
    this.lastSupply = { volume, fuel, portions, atMinute: now.totalMinutes };
  }

  /** «Смотреть» — бесплатно, мгновенно, всегда доступно. */
  look(now: Moment): BridgeSight {
    const degraded = this.weather.isStorm(this.cityQuadrant);
    return {
      city: this.tombstone ? "мёртвый город" : this.tierFor(this.city.destruction()),
      degraded,
      sky: {
        hour: now.hour,
        isNight: now.isNight,
        day: now.day,
        storm: this.weather.isStorm(this.towerQuadrant),
      },
    };
  }

  private tierFor(destruction: number): string {
    for (const tier of this.cfg.destructionTiers) {
      if (destruction <= tier.upTo) return tier.label;
    }
    return this.cfg.destructionTiers[this.cfg.destructionTiers.length - 1]?.label ?? "";
  }

  /** «Остаться» — платно, повторяемо, не блокируется даже при критическом Тепле. */
  stay(): void {
    const escalated = this.minutesInARow >= this.cfg.safeMinutes;
    const cold = escalated ? this.cfg.baseCold * this.cfg.coldEscalation : this.cfg.baseCold;

    this.bus.emit<SanityPayload>(EV.RESTORE_SANITY, { amount: this.cfg.sanityRestore });
    this.bus.emit<ColdPayload>(EV.APPLY_COLD, { amount: cold });
    this.bus.emit<SpendMinutesPayload>(EV.SPEND_MINUTES, {
      minutes: this.cfg.stayMinutes,
      source: "мостик",
    });

    this.minutesInARow += this.cfg.stayMinutes;
  }

  /** Уход с экрана обнуляет счётчик — это таймер холода, а не таймер смерти. */
  leave(): void {
    this.minutesInARow = 0;
  }

  get streakMinutes(): number {
    return this.minutesInARow;
  }

  get isTombstone(): boolean {
    return this.tombstone;
  }

  get lastDelivery(): LastSupply | null {
    return this.lastSupply;
  }
}
