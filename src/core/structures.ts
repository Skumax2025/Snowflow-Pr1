/**
 * Структуры — Посты, Базы, Склады, Ретрансляторы.
 *
 * Каждая — рядовая сущность по общему контракту Пулов событий, без исключений.
 * Единственная сверх-способность у Склада: он порождает дочернюю сущность
 * Конвой. Терминальные события Конвой шлёт Городу напрямую, Склад в этом
 * не участвует.
 */

import type { StructuresConfig } from "../config/types.js";
import type { EventBus } from "./bus.js";
import { EV, type AttackPayload, type SupplyPayload } from "./events.js";
import { WorldEntity, type PoolContext, type SpawnRequest } from "./pools.js";
import type { PoolEventRow, PoolTable } from "../config/types.js";
import {
  clamp,
  makeQuadrant,
  parseQuadrant,
  type Moment,
  type Quadrant,
  type StructureKind,
} from "./types.js";

/**
 * Конвой — дочерняя сущность Склада, а не флейвор-статус: у него свои
 * характеристики, свой пул и свой маршрут по квадрантам.
 */
export class Convoy extends WorldEntity {
  constructor(
    subject: string,
    quadrant: Quadrant,
    table: PoolTable,
    ctx: PoolContext,
    stats: Record<string, number>,
    private readonly destination: Quadrant,
    private readonly bus: EventBus,
    startOffset: number,
  ) {
    super(subject, quadrant, table, ctx, startOffset);
    this.stats = { ...stats };
  }

  /** Маршрут: на каждом шаге конвой смещается на один квадрант к городу. */
  protected override afterEvent(row: PoolEventRow, _now: Moment): void {
    if (row.id !== "шаг_по_маршруту") return;
    const here = parseQuadrant(this.quadrant);
    const there = parseQuadrant(this.destination);
    const step = (from: number, to: number) => from + Math.sign(to - from);
    this.quadrant = makeQuadrant(step(here.col, there.col), step(here.row, there.row));
  }

  /** Терминальный исход уходит Городу напрямую, минуя Склад-родителя. */
  protected override onOutbound(row: PoolEventRow, _place: Quadrant, _power: number | undefined): void {
    const event = row.outbound?.event;
    if (event === EV.SUPPLY_DELIVERED || event === EV.SUPPLY_LOST) {
      this.bus.emit<SupplyPayload>(event, { origin: this.subject });
    }
  }
}

export class Structure extends WorldEntity {
  private convoyCounter = 0;

  constructor(
    readonly kind: StructureKind,
    quadrant: Quadrant,
    integrity: number,
    domain: Record<string, number>,
    private readonly cfg: StructuresConfig,
    ctx: PoolContext,
    private readonly cityQuadrant: Quadrant,
    private readonly bus: EventBus,
    index: number,
  ) {
    super(`структура:${kind}:${quadrant}`, quadrant, cfg.pools[kind], ctx, index * 5);
    this.stats = { integrity, ...domain };

    this.bus.on<AttackPayload>(EV.ATTACK, (p) => {
      if (p.target === this.subject) this.receiveAttack(p);
    });
  }

  /** Атака без демпфера: N сразу вычитается из Целостности. */
  private receiveAttack(payload: AttackPayload): void {
    if (!this.alive) return;
    this.stats.integrity = clamp((this.stats.integrity ?? 0) - payload.power, 0, 100);
    if ((this.stats.integrity ?? 0) <= 0) {
      this.ctx.journal.write({
        time: this.ctx.now(),
        eventType: "структура_уничтожена",
        subject: this.subject,
        place: this.quadrant,
        status: "уничтожена",
        participants: [`сила:${payload.power}`],
      });
      // Разрушение необратимо: Структура перестаёт тикать.
      this.alive = false;
    }
  }

  protected override onSpawn(request: SpawnRequest, now: Moment): void {
    if (request.kind !== "конвой") return;
    this.convoyCounter += 1;
    const convoy = new Convoy(
      `конвой:${this.quadrant}:${this.convoyCounter}`,
      this.quadrant,
      this.cfg.convoyPool,
      this.ctx,
      request.stats,
      this.cityQuadrant,
      this.bus,
      now.totalMinutes,
    );
    this.children.push(convoy);
  }

  get integrity(): number {
    return this.stats.integrity ?? 0;
  }

  /** Живые Конвои этого Склада — реестр хранит родитель. */
  get convoys(): WorldEntity[] {
    return this.children;
  }
}

/** Набор Структур сценария. Стартовый состав фиксирован при инициализации. */
export class StructureRegistry {
  readonly items: Structure[] = [];

  add(structure: Structure): void {
    this.items.push(structure);
  }

  /** Живые Структуры — читают Генератор эфира (слышимость) и Парсер (словарь). */
  alive(): Structure[] {
    return this.items.filter((s) => s.alive && s.integrity > 0);
  }

  aliveOfKind(kind: StructureKind): Structure[] {
    return this.alive().filter((s) => s.kind === kind);
  }

  /** Живая Структура в квадранте — цель маршрутизированной атаки. */
  findAliveAt(quadrant: Quadrant): Structure | undefined {
    return this.alive().find((s) => s.quadrant === quadrant);
  }
}
