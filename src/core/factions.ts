/**
 * Фракции — Свои, Противники, Мародёры.
 *
 * Три строки одной сущности-таблицы, тот же общий контракт, что и у Структур.
 * У Фракций нет собственного квадранта: координата каждого факта катается из
 * недавних записей Журнала — тем же механизмом, что и квадрант атаки. Без
 * координаты Генератор эфира не сможет решить, слышно ли событие.
 */

import type { FactionsConfig } from "../config/types.js";
import type { PoolEventRow } from "../config/types.js";
import type { EventBus } from "./bus.js";
import { EV, type AttackPayload } from "./events.js";
import { WorldEntity, type PoolContext } from "./pools.js";
import type { StructureRegistry } from "./structures.js";
import type { FactionKind, Moment, Quadrant } from "./types.js";

export interface AttackRouting {
  cityQuadrant(): Quadrant;
  structures: StructureRegistry;
  /** Все квадранты сетки — запасной источник координаты, пока Журнал пуст. */
  allQuadrants: Quadrant[];
  now(): number;
}

export class Faction extends WorldEntity {
  constructor(
    readonly kind: FactionKind,
    private readonly cfg: FactionsConfig,
    ctx: PoolContext,
    private readonly routing: AttackRouting,
    private readonly bus: EventBus,
    index: number,
  ) {
    super(`фракция:${kind}`, "", cfg.pools[kind], ctx, index * 7);
    if (kind === "противники") {
      this.stats = { aggression: cfg.aggressionStart };
    }
  }

  /**
   * Координата катается из квадрантов, недавно упомянутых в поле «место»
   * записей Журнала. Насилие стягивается туда, где уже что-то происходило.
   */
  protected override resolvePlace(): Quadrant {
    const from = Math.max(0, this.routing.now() - this.cfg.recentWindowMinutes);
    const recent = this.ctx.journal.recentPlaces(from);
    const pool = recent.length > 0 ? recent : this.routing.allQuadrants;
    return this.ctx.rng.pick(pool);
  }

  protected override onOutbound(
    row: PoolEventRow,
    place: Quadrant,
    power: number | undefined,
    now: Moment,
  ): void {
    if (row.outbound?.to !== "маршрутизация_атаки") return;
    const strength = power ?? 0;

    // Маршрутизация по квадранту: Город, живая Структура или пустота.
    let target = "пустота";
    if (place === this.routing.cityQuadrant()) {
      target = "город";
    } else {
      const structure = this.routing.structures.findAliveAt(place);
      if (structure) target = structure.subject;
    }

    if (target === "пустота") {
      // Валидный ожидаемый исход, а не ошибка маршрутизации.
      this.ctx.journal.write({
        time: now.totalMinutes,
        eventType: "атака_в_пустоту",
        subject: this.subject,
        place,
        status: "без_цели",
        participants: [`сила:${strength}`],
        archetypeTag: "агрессивное",
      });
    } else {
      this.bus.emit<AttackPayload>(EV.ATTACK, {
        power: strength,
        quadrant: place,
        target,
        origin: this.subject,
      });
    }

    // Разряд Режиссёру уходит при любом срабатывании «агрессивного» события,
    // попала атака в цель или ушла в пустоту.
    this.bus.emit(EV.AGGRESSIVE_FIRED, { origin: this.subject });
  }

  get aggression(): number {
    return this.stats.aggression ?? 0;
  }
}
