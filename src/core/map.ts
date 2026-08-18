/**
 * Карта — блокнот игрока, а не окно в мир.
 *
 * Хранит ровно то, что игрок сам решил записать. Журнал фактов, Погоду
 * и Структуры не читает никогда и не сверяет свои метки с правдой:
 * ядро игры лежит в зазоре между тем, что было, и тем, что записано здесь.
 */

import type { EventBus } from "./bus.js";
import { EV, type SignalCaughtPayload } from "./events.js";
import type { GameTime } from "./time.js";
import { allQuadrants, type Quadrant } from "./types.js";

export type StormMarkStatus = "шторм" | "чисто";
export type RelayMarkStatus = "активен" | "мёртв" | "не знаю";

export interface StormMark {
  quadrant: Quadrant;
  observedAt: number;
  status: StormMarkStatus;
}

export interface RelayMark {
  quadrant: Quadrant;
  status: RelayMarkStatus;
  updatedAt: number;
}

export interface CaughtDigest {
  kind: string;
  entries: unknown;
  caughtAt: number;
}

export class GameMap {
  /** Накопительная история наблюдений: старые записи не стираются. */
  private storm = new Map<Quadrant, StormMark[]>();
  /** Перезаписываемый статус: важно только «жив ли он сейчас». */
  private relay = new Map<Quadrant, RelayMark>();
  /** Декоративные метки: механически не читаются ни одной системой. */
  private posts = new Set<Quadrant>();
  private digests = new Map<string, CaughtDigest>();
  readonly quadrants: Quadrant[];

  constructor(
    cols: number,
    rows: number,
    private readonly time: GameTime,
    bus: EventBus,
  ) {
    this.quadrants = allQuadrants(cols, rows);
    bus.on<SignalCaughtPayload>(EV.SIGNAL_CAUGHT, (p) => {
      // Единственный вход информации о мире — и он ничего не проставляет сам.
      if (p.signalKind !== "сводка") return;
      const digest = p.digest as { kind: string; entries: unknown } | undefined;
      if (!digest) return;
      this.digests.set(digest.kind, {
        kind: digest.kind,
        entries: digest.entries,
        caughtAt: this.time.totalMinutes,
      });
    });
  }

  /** Клик игрока: метка шторма добавляется в историю квадранта. */
  markStorm(quadrant: Quadrant, status: StormMarkStatus): void {
    const list = this.storm.get(quadrant) ?? [];
    list.push({ quadrant, observedAt: this.time.totalMinutes, status });
    this.storm.set(quadrant, list);
  }

  /** Клик игрока: метка ретранслятора перезаписывается, старое теряется. */
  markRelay(quadrant: Quadrant, status: RelayMarkStatus): void {
    this.relay.set(quadrant, { quadrant, status, updatedAt: this.time.totalMinutes });
  }

  markPost(quadrant: Quadrant): void {
    this.posts.add(quadrant);
  }

  stormHistory(quadrant: Quadrant): readonly StormMark[] {
    return this.storm.get(quadrant) ?? [];
  }

  relayStatus(quadrant: Quadrant): RelayMarkStatus {
    return this.relay.get(quadrant)?.status ?? "не знаю";
  }

  hasPost(quadrant: Quadrant): boolean {
    return this.posts.has(quadrant);
  }

  /** Последняя пойманная сводка каждого типа — для отображения рядом с сеткой. */
  digest(kind: string): CaughtDigest | undefined {
    return this.digests.get(kind);
  }

  get allStormMarks(): StormMark[] {
    return [...this.storm.values()].flat();
  }
}
