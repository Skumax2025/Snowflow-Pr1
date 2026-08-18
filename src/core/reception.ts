/**
 * Приём сигнала — единственный орган чувств игрока.
 *
 * Гибрид: бесплатный скраббинг по шкале частот плюс дискретная попытка
 * настройки, которая стоит времени. Окно приёма грубое: да/нет, без градации.
 * Приём целиком блокируется штормом над квадрантом вышки.
 *
 * Система не знает точности сигнала и не умеет отличить фантом от настоящего:
 * оба лежат в одном списке в одном формате.
 */

import type { PartyConfig, ReceptionConfig } from "../config/types.js";
import type { Broadcast } from "./broadcast.js";
import type { EventBus } from "./bus.js";
import { EV, type SignalCaughtPayload, type SpendMinutesPayload } from "./events.js";
import type { Band, Quadrant, SignalId } from "./types.js";
import type { Weather } from "./weather.js";

export type AttemptResult =
  | { outcome: "заблокировано" }
  | { outcome: "промах" }
  | { outcome: "пойман"; signalId: SignalId };

export class Reception {
  private tuner: number;
  private readonly caught = new Set<SignalId>();

  constructor(
    private readonly cfg: ReceptionConfig,
    private readonly party: PartyConfig,
    private readonly broadcast: Broadcast,
    private readonly weather: Weather,
    private readonly towerQuadrant: Quadrant,
    private readonly bus: EventBus,
  ) {
    this.tuner = cfg.tunerStart;
  }

  /** Скраббинг ничего не стоит, ни времени, ни ресурсов. */
  setTuner(position: number): void {
    const max = this.party.bands.reduce((acc, b) => Math.max(acc, b.to), 0);
    this.tuner = Math.min(max, Math.max(0, position));
  }

  get tunerPosition(): number {
    return this.tuner;
  }

  /** Флаг для UI: приём заблокирован штормом над квадрантом вышки. */
  get blocked(): boolean {
    return this.weather.isStorm(this.towerQuadrant);
  }

  bandAt(frequency: number): Band | null {
    const row = this.party.bands.find((b) => frequency >= b.from && frequency < b.to);
    return row?.band ?? null;
  }

  /**
   * Попытка настройки. Шторм проверяется до списания: раз действие
   * недоступно, значит его и не начинали — время не тратится.
   */
  attempt(): AttemptResult {
    if (this.blocked) return { outcome: "заблокировано" };

    this.bus.emit<SpendMinutesPayload>(EV.SPEND_MINUTES, {
      minutes: this.cfg.attemptMinutes,
      source: "приём_сигнала",
    });

    const candidates = this.broadcast
      .liveSignals()
      .filter((s) => Math.abs(this.tuner - s.frequency) <= this.cfg.windowWidth);
    if (candidates.length === 0) return { outcome: "промах" };

    // При нескольких сигналах в окне ловится ближайший по частоте.
    let best = candidates[0];
    for (const signal of candidates) {
      if (
        best &&
        Math.abs(signal.frequency - this.tuner) < Math.abs(best.frequency - this.tuner)
      ) {
        best = signal;
      }
    }
    if (!best) return { outcome: "промах" };

    this.broadcast.markCaught(best.id);
    this.caught.add(best.id);

    this.bus.emit<SignalCaughtPayload>(EV.SIGNAL_CAUGHT, {
      signalId: best.id,
      frequency: best.frequency,
      band: best.band,
      signalKind: best.kind,
      digest: best.digest,
    });

    return { outcome: "пойман", signalId: best.id };
  }

  get caughtIds(): ReadonlySet<SignalId> {
    return this.caught;
  }
}
