/**
 * Проверка сигнала — платное действие, раскрывающее заявленные детали.
 *
 * Тег «точность» эта система сознательно не читает и не показывает: вердикт
 * «врёт или нет» игрок выносит сам, опираясь на правило «сигнал не может
 * прийти из-под шторма». Повторный просмотр уже проверенного сигнала бесплатен.
 */

import type { SignalCheckConfig } from "../config/types.js";
import type { Broadcast } from "./broadcast.js";
import type { EventBus } from "./bus.js";
import { EV, type FuelPayload, type SignalCaughtPayload, type SpendMinutesPayload } from "./events.js";
import type { Quadrant, SignalId } from "./types.js";
import type { Weather } from "./weather.js";

export interface RevealedDetails {
  signalId: SignalId;
  eventType: string;
  /** Откуда сигнал якобы пришёл. */
  declaredQuadrant: Quadrant;
  declaredDistance: number;
  declaredRoute: string;
  declaredTimestamp: number;
  /** Сырой факт из истории Погоды: был / не был. Без интерпретации. */
  stormAtDeclaredMoment: boolean;
}

export class SignalCheck {
  private readonly pending: SignalId[] = [];
  private readonly checked = new Map<SignalId, RevealedDetails>();

  constructor(
    private readonly cfg: SignalCheckConfig,
    private readonly broadcast: Broadcast,
    private readonly weather: Weather,
    private readonly bus: EventBus,
  ) {
    bus.on<SignalCaughtPayload>(EV.SIGNAL_CAUGHT, (p) => {
      // Сводки сюда не приходят: они правдивы по построению и уходят в Карту.
      if (p.signalKind !== "обычный") return;
      this.pending.push(p.signalId);
    });
  }

  /** Пойманные, но не проверенные. Проверка не запускается автоматически. */
  get queue(): readonly SignalId[] {
    return this.pending.filter((id) => !this.checked.has(id));
  }

  isChecked(id: SignalId): boolean {
    return this.checked.has(id);
  }

  check(id: SignalId): RevealedDetails | null {
    const already = this.checked.get(id);
    if (already) return already; // повторный просмотр ресурсы не тратит

    const signal = this.broadcast.byId(id);
    if (!signal) return null;

    this.bus.emit<SpendMinutesPayload>(EV.SPEND_MINUTES, {
      minutes: this.cfg.minutes,
      source: "проверка_сигнала",
    });
    this.bus.emit<FuelPayload>(EV.SPEND_FUEL, {
      amount: this.cfg.fuel,
      source: "проверка_сигнала",
    });

    const details: RevealedDetails = {
      signalId: signal.id,
      eventType: signal.eventType,
      declaredQuadrant: signal.sourceQuadrant,
      declaredDistance: signal.declaredDistance,
      declaredRoute: signal.declaredRoute,
      declaredTimestamp: signal.declaredTimestamp,
      stormAtDeclaredMoment: this.weather.wasStorm(signal.sourceQuadrant, signal.declaredTimestamp),
    };
    this.checked.set(id, details);
    return details;
  }

  detailsOf(id: SignalId): RevealedDetails | undefined {
    return this.checked.get(id);
  }
}
