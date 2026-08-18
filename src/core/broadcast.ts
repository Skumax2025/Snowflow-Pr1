/**
 * Генератор эфира — единственная система, превращающая Журнал фактов
 * в радиосигналы. Владеет форматом Сигнала и списком живых сигналов целиком.
 *
 * Не знает, что игрок услышал, поймал или написал. Границы диапазонов читает
 * из конфига партии, а не у Приёма сигнала — иначе Мир читал бы Вышку.
 */

import type { BroadcastConfig, PartyConfig } from "../config/types.js";
import type { EventBus } from "./bus.js";
import type { FactRecord, Journal } from "./journal.js";
import type { Rng } from "./rng.js";
import type { StructureRegistry } from "./structures.js";
import { DailySchedule, Schedule } from "./time.js";
import {
  makeQuadrant,
  parseQuadrant,
  quadrantDistance,
  type Accuracy,
  type Band,
  type FactId,
  type Moment,
  type Quadrant,
  type SignalId,
  type Tickable,
} from "./types.js";
import type { Weather } from "./weather.js";
import { EV } from "./events.js";

export type SignalKind = "обычный" | "сводка";

export interface StormDigestEntry {
  quadrant: Quadrant;
  storm: boolean;
}

export interface RelayDigestEntry {
  quadrant: Quadrant;
  alive: boolean;
}

export interface Signal {
  id: SignalId;
  /** Момент, когда сигнал лёг в эфир. */
  time: number;
  kind: SignalKind;
  band: Band;
  frequency: number;
  accuracy: Accuracy;
  /** Ссылка на запись Журнала; пусто у сводок и фантомов. */
  sourceFact: FactId | null;
  /** Заявленный квадрант-источник; при точности ниже «правды» расходится с истиной. */
  sourceQuadrant: Quadrant;
  /** Тип события — то, о чём сигнал сообщает. */
  eventType: string;
  declaredDistance: number;
  declaredRoute: string;
  declaredTimestamp: number;
  digest?: { kind: "метео"; entries: StormDigestEntry[] } | { kind: "ретрансляторы"; entries: RelayDigestEntry[] };
  expiresAt: number;
  caught: boolean;
}

export class Broadcast implements Tickable {
  readonly systemId = "генератор_эфира";

  private signals: Signal[] = [];
  private counter = 0;
  /** Монотонный счёт по видам: список сигналов чистится по TTL, счёт — нет. */
  private generated = { обычный: 0, сводка: 0 };
  private schedule: Schedule;
  private meteoSchedule: DailySchedule;
  private relaySchedule: DailySchedule;
  private windowStart = 0;
  /** Момент партии: фантом приходит событием вне собственного тика. */
  private currentMinute = 0;

  constructor(
    private readonly cfg: BroadcastConfig,
    private readonly party: PartyConfig,
    private readonly journal: Journal,
    private readonly structures: StructureRegistry,
    private readonly weather: Weather,
    private readonly rng: Rng,
    bus: EventBus,
  ) {
    this.schedule = new Schedule(cfg.tickMinutes, cfg.tickMinutes);
    this.meteoSchedule = new DailySchedule(cfg.meteoHour);
    this.relaySchedule = new DailySchedule(cfg.relayHour);
    bus.on(EV.MIX_PHANTOM_SIGNAL, () => this.mixPhantom());
  }

  tick(now: Moment): void {
    this.currentMinute = now.totalMinutes;
    // Непойманный сигнал по истечении TTL исчезает из списка.
    this.signals = this.signals.filter((s) => s.expiresAt > now.totalMinutes);

    if (this.schedule.due(now.totalMinutes) > 0) {
      const records = this.journal.query({ fromTime: this.windowStart, toTime: now.totalMinutes + 1 });
      this.windowStart = now.totalMinutes + 1;
      for (const record of records) this.considerRecord(record, now);
    }

    if (this.meteoSchedule.due(now)) this.publishMeteo(now);
    if (this.relaySchedule.due(now)) this.publishRelays(now);
  }

  // ── Обычные сигналы ─────────────────────────────────────────────────────

  private considerRecord(record: FactRecord, now: Moment): void {
    // Агрегатная запись Города — не событие мира, в эфир не идёт.
    if (record.subject === "город" && record.eventType === "рапорт_обработан") return;

    const band = this.bandFor(record);
    if (!band) return;

    // 1. Слышимость: квадрант-источник в радиусе хотя бы одной живой Структуры
    //    типа Ретранслятор / Пост / База. Склад в проверке не участвует.
    if (!this.audible(record.place)) return;

    // 2. Глушение: квадрант-источник под штормом — запись не звучит вовсе.
    if (this.weather.isStorm(record.place)) return;

    // 3. Точность по тегу архетипа, который Журнал хранит явным полем.
    const accuracy: Accuracy =
      record.archetypeTag === "агрессивное"
        ? this.rng.chance(this.cfg.lieChanceForAggressive)
          ? "ложь"
          : "искажение"
        : this.rng.chance(this.cfg.inaccuracyChance)
          ? "неточность"
          : "правда";

    this.push(this.buildSignal(record, band, accuracy, now));
  }

  private bandFor(record: FactRecord): Band | null {
    const key = record.subject.startsWith("конвой:")
      ? "конвой"
      : record.subject.startsWith("режиссёр:")
        ? "режиссёр:дезинформация"
        : record.subject.startsWith("структура:")
          ? record.subject.split(":").slice(0, 2).join(":")
          : record.subject;
    return (this.cfg.audibility[key] as Band | undefined) ?? null;
  }

  /** Радиус — константа по типу структуры; Склад приёмной инфраструктурой не является. */
  private audible(quadrant: Quadrant): boolean {
    for (const structure of this.structures.alive()) {
      const radius = this.cfg.hearingRadius[structure.kind as "ретранслятор" | "пост" | "база"];
      if (radius === undefined) continue;
      if (quadrantDistance(structure.quadrant, quadrant) <= radius) return true;
    }
    return false;
  }

  private buildSignal(record: FactRecord, band: Band, accuracy: Accuracy, now: Moment): Signal {
    const trueDistance = quadrantDistance(this.party.towerQuadrant, record.place);
    const truthful = accuracy === "правда";

    // Заявленные детали при точности ниже «правды» генерируются отдельно
    // от истинных значений записи, с расхождением из конфига.
    const quadrant = truthful ? record.place : this.shiftQuadrant(record.place);
    const distance = truthful
      ? trueDistance
      : Math.max(
          0,
          trueDistance + this.rng.int(-this.cfg.divergence.distanceSpread, this.cfg.divergence.distanceSpread),
        );
    const timestamp = truthful
      ? record.time
      : Math.max(
          0,
          record.time +
            this.rng.int(-this.cfg.divergence.timeSpreadMinutes, this.cfg.divergence.timeSpreadMinutes),
        );

    return {
      id: this.nextId(),
      time: now.totalMinutes,
      kind: "обычный",
      band,
      frequency: this.pickFrequency(band),
      accuracy,
      sourceFact: record.id,
      sourceQuadrant: quadrant,
      eventType: record.eventType,
      declaredDistance: distance,
      declaredRoute: this.rng.pick(this.cfg.routes),
      declaredTimestamp: timestamp,
      expiresAt: now.totalMinutes + this.cfg.ttlMinutes,
      caught: false,
    };
  }

  private shiftQuadrant(quadrant: Quadrant): Quadrant {
    const { col, row } = parseQuadrant(quadrant);
    const shift = this.cfg.divergence.quadrantShift;
    const newCol = Math.min(this.party.gridCols - 1, Math.max(0, col + this.rng.int(-shift, shift)));
    const newRow = Math.min(this.party.gridRows - 1, Math.max(0, row + this.rng.int(-shift, shift)));
    return makeQuadrant(newCol, newRow);
  }

  private pickFrequency(band: Band): number {
    const range = this.party.bands.find((b) => b.band === band);
    if (!range) return 0;
    return this.rng.int(range.from, range.to - 1);
  }

  // ── Регулярные сводки: обычные сигналы на фиксированной частоте ──────────

  private publishMeteo(now: Moment): void {
    this.push({
      ...this.digestBase(now),
      frequency: this.party.meteoFrequency,
      eventType: "метеосводка",
      digest: { kind: "метео", entries: this.weather.snapshot() },
    });
  }

  private publishRelays(now: Moment): void {
    const entries: RelayDigestEntry[] = this.structures.items
      .filter((s) => s.kind === "ретранслятор")
      .map((s) => ({ quadrant: s.quadrant, alive: s.alive && s.integrity > 0 }));
    this.push({
      ...this.digestBase(now),
      frequency: this.party.relayFrequency,
      eventType: "сводка_ретрансляторов",
      digest: { kind: "ретрансляторы", entries },
    });
  }

  private digestBase(now: Moment): Signal {
    return {
      id: this.nextId(),
      time: now.totalMinutes,
      kind: "сводка",
      // Сводки правдивы по построению: скрывать в снимке нечего.
      band: (this.cfg.audibility["сводка"] as Band) ?? "военный",
      frequency: 0,
      accuracy: "правда",
      sourceFact: null,
      sourceQuadrant: "",
      eventType: "сводка",
      declaredDistance: 0,
      declaredRoute: "",
      declaredTimestamp: now.totalMinutes,
      expiresAt: now.totalMinutes + this.cfg.ttlMinutes,
      caught: false,
    };
  }

  // ── Фантомы Галлюцинаций ────────────────────────────────────────────────

  /**
   * Полностью синтетическая запись. Проверки слышимости и глушения фантом
   * не проходит: он звучит в голове, а не в эфире, и обязан появляться именно
   * тогда, когда над вышкой шторм и всё остальное молчит.
   */
  private mixPhantom(): void {
    const now = this.currentMinute;
    const quadrant = makeQuadrant(
      this.rng.int(0, this.party.gridCols - 1),
      this.rng.int(0, this.party.gridRows - 1),
    );
    const bandRow = this.rng.pick(this.party.bands);

    this.push({
      id: this.nextId(),
      time: now,
      kind: "обычный",
      band: bandRow.band,
      frequency: this.rng.int(bandRow.from, bandRow.to - 1),
      accuracy: "искажение",
      sourceFact: null,
      sourceQuadrant: quadrant,
      eventType: this.rng.pick(this.cfg.phantomEventTypes),
      declaredDistance: this.rng.int(0, this.cfg.divergence.distanceSpread),
      declaredRoute: this.rng.pick(this.cfg.routes),
      declaredTimestamp: Math.max(0, now - this.rng.int(0, this.cfg.divergence.timeSpreadMinutes)),
      expiresAt: now + this.cfg.ttlMinutes,
      caught: false,
    });
  }

  private push(signal: Signal): void {
    this.generated[signal.kind] += 1;
    this.signals.push(signal);
  }

  private nextId(): SignalId {
    this.counter += 1;
    return `s${this.counter}`;
  }

  // ── Выходы ──────────────────────────────────────────────────────────────

  /** Список живых непойманных сигналов — читает Приём сигнала. */
  liveSignals(): Signal[] {
    return this.signals.filter((s) => !s.caught);
  }

  /** Полная запись по id — читает Проверка сигнала. */
  byId(id: SignalId): Signal | undefined {
    return this.signals.find((s) => s.id === id);
  }

  markCaught(id: SignalId): void {
    const signal = this.byId(id);
    if (signal) signal.caught = true;
  }

  get all(): readonly Signal[] {
    return this.signals;
  }

  /** Сколько сигналов каждого вида вышло в эфир за партию. Метрика Стенда. */
  get generatedCount(): { обычный: number; сводка: number } {
    return { ...this.generated };
  }
}
