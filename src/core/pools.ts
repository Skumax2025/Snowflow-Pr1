/**
 * Пулы событий — единый механизм, которым живёт весь симулятивный Мир.
 *
 * Сущность = набор характеристик + пул событий, где вес каждого события зависит
 * от характеристик. Всё различие между Городом, Складом и Конвоем лежит в
 * данных таблиц, а не в ветвлениях логики.
 *
 * Пул не решает, звучит ли событие в эфире, — это работа Генератора эфира.
 * Пул гарантирует только, что факт появился и что у него заполнено «место».
 */

import type { PoolEventRow, PoolTable } from "../config/types.js";
import type { Journal } from "./journal.js";
import type { Rng } from "./rng.js";
import { Schedule } from "./time.js";
import { clamp, type Moment, type Quadrant, type Tickable } from "./types.js";

/** Явно разрешённые внешние источники модификаторов (мастер-концепт 6.7). */
export interface PoolExternalSources {
  /** Шторм над квадрантом сущности: 1 или 0. */
  stormAt(quadrant: Quadrant): number;
  /** Напряжённость Режиссёра. */
  tension(): number;
}

export interface PoolContext {
  journal: Journal;
  rng: Rng;
  external: PoolExternalSources;
  /**
   * Текущий момент партии от Времени. Нужен записям, которые сущность делает
   * не на своём тике, а по входящему явному событию: вердикт рапорта, атака,
   * уничтожение Структуры. Момент прошлого тика для них — неверная метка.
   */
  now(): number;
  /** Явное событие другой сущности. Пул чужие характеристики не трогает. */
  emit(event: string, payload: unknown): void;
}

export interface SpawnRequest {
  kind: string;
  stats: Record<string, number>;
}

/**
 * Базовая сущность Мира. Город, Структура, Фракция и Конвой — её частные
 * случаи; всё, что их различает, лежит в таблице пула.
 */
export class WorldEntity implements Tickable {
  readonly systemId: string;
  stats: Record<string, number> = {};
  alive = true;
  /** Реестр живых дочерних сущностей — хранит родитель. */
  readonly children: WorldEntity[] = [];

  protected schedule: Schedule;
  protected lastTickMinute = 0;

  constructor(
    /** Субъект записи Журнала: «склад:B2», «фракция:противники»… */
    readonly subject: string,
    /** Собственный квадрант. У Фракций его нет — см. resolvePlace(). */
    public quadrant: Quadrant,
    protected readonly table: PoolTable,
    protected readonly ctx: PoolContext,
    startOffset = 0,
  ) {
    this.systemId = subject;
    this.schedule = new Schedule(
      table.tickMinutes,
      startOffset + (table.firstTickMinutes ?? table.tickMinutes),
    );
  }

  tick(now: Moment): void {
    if (!this.alive) return;
    this.beforePool(now);
    const times = this.schedule.due(now.totalMinutes);
    for (let i = 0; i < times && this.alive; i++) {
      this.rollPool(now);
    }
    this.lastTickMinute = now.totalMinutes;
    // Дети тикают свой пул самостоятельно; родитель их не решает за них.
    for (const child of [...this.children]) {
      child.tick(now);
    }
    for (let i = this.children.length - 1; i >= 0; i--) {
      if (!this.children[i]?.alive) this.children.splice(i, 1);
    }
  }

  /** Точка расширения: накопительные величины, которые считаются за минуты. */
  protected beforePool(_now: Moment): void {}

  /** Место записи. Фракции и Режиссёр катают его из недавних записей Журнала. */
  protected resolvePlace(): Quadrant {
    return this.quadrant;
  }

  protected weightOf(row: PoolEventRow): number {
    let weight = row.baseWeight;
    for (const mod of row.modifiers ?? []) {
      weight += mod.coef * (this.stats[mod.stat] ?? 0);
    }
    for (const mod of row.externalModifiers ?? []) {
      const value =
        mod.source === "погода" ? this.ctx.external.stormAt(this.quadrant) : this.ctx.external.tension();
      weight += mod.coef * value;
    }
    return weight > 0 ? weight : 0;
  }

  protected rollPool(now: Moment): void {
    const rows = this.table.events;
    // Опция «ничего не произошло» — такой же участник розыгрыша.
    const weights = [this.table.idleWeight, ...rows.map((r) => this.weightOf(r))];
    const index = this.ctx.rng.weightedIndex(weights);
    if (index <= 0) return;
    const row = rows[index - 1];
    if (row) this.fireEvent(row, now);
  }

  protected fireEvent(row: PoolEventRow, now: Moment): void {
    for (const eff of row.effectOnSelf ?? []) {
      this.stats[eff.stat] = clamp((this.stats[eff.stat] ?? 0) + eff.delta, 0, 100);
    }

    const place = this.resolvePlace();
    const power = row.attackPower
      ? this.ctx.rng.int(row.attackPower[0], row.attackPower[1])
      : undefined;

    if (row.fact) {
      this.ctx.journal.write({
        time: now.totalMinutes,
        eventType: row.fact.eventType,
        subject: this.subject,
        place,
        status: row.fact.status,
        participants: power !== undefined ? [`сила:${power}`] : [],
        archetypeTag: row.fact.archetypeTag ?? null,
      });
    }

    if (row.spawn) {
      const stats: Record<string, number> = {};
      for (const [name, range] of Object.entries(row.spawn.stats)) {
        stats[name] = this.ctx.rng.int(range[0], range[1]);
      }
      this.onSpawn({ kind: row.spawn.kind, stats }, now);
    }

    if (row.outbound) {
      this.onOutbound(row, place, power, now);
    }

    this.afterEvent(row, now);

    if (row.terminal) {
      this.alive = false;
    }
  }

  /** Переопределяют Склад (рождение Конвоя) и всё, что спавнит детей. */
  protected onSpawn(_request: SpawnRequest, _now: Moment): void {}

  /** Переопределяют Фракции (маршрутизация атаки) и Конвой (исход поставки). */
  protected onOutbound(row: PoolEventRow, _place: Quadrant, power: number | undefined, _now: Moment): void {
    this.ctx.emit(row.outbound?.event ?? "", { origin: this.subject, power });
  }

  /** Хук для эффектов, которых нет в таблице: движение конвоя, разрядка и т.п. */
  protected afterEvent(_row: PoolEventRow, _now: Moment): void {}
}
