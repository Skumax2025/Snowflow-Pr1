/**
 * Галлюцинации — механическое воплощение того, что низкий Рассудок делает мир
 * ненадёжным ещё до того, как игрок сам ошибётся.
 *
 * Один общий триггер, два параллельных проявления: фантомные сигналы в эфире
 * и голоса из Базы аномалий. Оба усиливаются с глубиной провала. Ни один
 * из двух эффектов не пишет факт в Журнал: оба выдуманы.
 */

import type { HallucinationsConfig } from "../config/types.js";
import type { AnomalyFilter } from "./anomalyFilter.js";
import type { EventBus } from "./bus.js";
import { EV } from "./events.js";
import type { Rng } from "./rng.js";
import { Schedule } from "./time.js";
import type { Moment, Tickable } from "./types.js";

export interface SanitySource {
  readonly sanityValue: number;
}

export interface Voice {
  text: string;
  atMinute: number;
}

export class Hallucinations implements Tickable {
  readonly systemId = "галлюцинации";

  private schedule: Schedule;
  private voices: Voice[] = [];

  constructor(
    private readonly cfg: HallucinationsConfig,
    private readonly radioman: SanitySource,
    private readonly filter: AnomalyFilter,
    private readonly rng: Rng,
    private readonly bus: EventBus,
  ) {
    this.schedule = new Schedule(cfg.tickMinutes, cfg.tickMinutes);
  }

  tick(now: Moment): void {
    const times = this.schedule.due(now.totalMinutes);
    for (let i = 0; i < times; i++) this.roll(now);
  }

  private roll(now: Moment): void {
    const sanity = this.radioman.sanityValue;
    // Рассудок выше порога — оба потока молчат, тик ничего не делает.
    if (sanity >= this.cfg.criticalSanity) return;

    const depth = (this.cfg.criticalSanity - sanity) / Math.max(1, this.cfg.criticalSanity);
    const intensity = 1 + this.cfg.escalationCoef * depth;

    if (this.rng.chance(this.cfg.phantomBaseChance * intensity)) {
      this.bus.emit(EV.MIX_PHANTOM_SIGNAL, {});
    }

    if (this.rng.chance(this.cfg.voiceBaseChance * intensity)) {
      const text = this.filter.requestVoice((items) => this.rng.pick(items));
      // Пустая база не ломает тик: Галлюцинации просто молчат по этому каналу.
      if (text !== null) this.voices.push({ text, atMinute: now.totalMinutes });
    }
  }

  /** Голос подаётся отдельным каналом, не через тюнер и не через список сигналов. */
  get heardVoices(): readonly Voice[] {
    return this.voices;
  }

  get format(): string {
    return this.cfg.voiceFormat;
  }
}
