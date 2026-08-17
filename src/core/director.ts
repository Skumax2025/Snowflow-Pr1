/**
 * Режиссёр — теневой арбитр Мира.
 *
 * Держит единственное скрытое число Напряжённость: растёт от Паники Города и
 * падений Доверия, разряжается через агрессивные события Фракций либо через
 * собственные пороговые кризисные ветки. Кризисные ветки — не пул: у них нет
 * таблицы весов и розыгрыша, только пороги.
 */

import type { DirectorConfig } from "../config/types.js";
import type { EventBus } from "./bus.js";
import { EV, type AttackPayload, type SupplyPayload } from "./events.js";
import type { Journal } from "./journal.js";
import type { Rng } from "./rng.js";
import type { StructureRegistry } from "./structures.js";
import { Schedule } from "./time.js";
import { clamp, type Moment, type Quadrant, type Tickable } from "./types.js";

export interface DirectorPeers {
  panic(): number;
  trustDelta(): number;
  cityQuadrant(): Quadrant;
  structures: StructureRegistry;
  allQuadrants: Quadrant[];
}

export class Director implements Tickable {
  readonly systemId = "режиссёр";

  private tension: number;
  private schedule: Schedule;
  /** Ветка срабатывает при переходе через порог, а не на каждом тике над ним. */
  private armed = { supplyLost: true, disinformation: true, emergencyRaid: true };

  constructor(
    private readonly cfg: DirectorConfig,
    private readonly bus: EventBus,
    private readonly journal: Journal,
    private readonly rng: Rng,
    private readonly peers: DirectorPeers,
  ) {
    this.tension = cfg.tensionStart;
    this.schedule = new Schedule(cfg.tickMinutes, cfg.tickMinutes);
    this.bus.on(EV.AGGRESSIVE_FIRED, () => this.discharge());
  }

  tick(now: Moment): void {
    const times = this.schedule.due(now.totalMinutes);
    for (let i = 0; i < times; i++) {
      this.grow();
      this.checkBranches(now);
    }
  }

  private grow(): void {
    const panicPart = this.cfg.coefFromPanic * (this.peers.panic() / 100);
    const trustDrop = Math.max(0, -this.peers.trustDelta());
    const trustPart = this.cfg.coefFromTrustDrop * (trustDrop / 100);
    this.tension = clamp(this.tension + panicPart + trustPart, 0, 100);
  }

  private discharge(): void {
    this.tension = clamp(this.tension - this.cfg.dischargeAmount, 0, 100);
    this.rearm();
  }

  private rearm(): void {
    if (this.tension < this.cfg.branches.supplyLost) this.armed.supplyLost = true;
    if (this.tension < this.cfg.branches.disinformation) this.armed.disinformation = true;
    if (this.tension < this.cfg.branches.emergencyRaid) this.armed.emergencyRaid = true;
  }

  private checkBranches(now: Moment): void {
    if (this.armed.emergencyRaid && this.tension >= this.cfg.branches.emergencyRaid) {
      this.armed.emergencyRaid = false;
      this.bus.emit<AttackPayload>(EV.ATTACK, {
        power: this.rng.int(this.cfg.raidPower[0], this.cfg.raidPower[1]),
        quadrant: this.peers.cityQuadrant(),
        target: "город",
        origin: "режиссёр:экстренный_рейд",
      });
      this.discharge();
      return;
    }

    if (this.armed.disinformation && this.tension >= this.cfg.branches.disinformation) {
      this.armed.disinformation = false;
      // Факт «дезинформация» обязан нести поле «место» — иначе его нечем озвучить.
      this.journal.write({
        time: now.totalMinutes,
        eventType: "дезинформация",
        subject: "режиссёр:дезинформация",
        place: this.rollPlace(now),
        status: "в_эфире",
      });
      this.discharge();
      return;
    }

    if (this.armed.supplyLost && this.tension >= this.cfg.branches.supplyLost) {
      this.armed.supplyLost = false;
      this.bus.emit<SupplyPayload>(EV.SUPPLY_LOST, { origin: "режиссёр:поставка_потеряна" });
      this.discharge();
    }
  }

  private rollPlace(now: Moment): Quadrant {
    const recent = this.journal.recentPlaces(Math.max(0, now.totalMinutes - 720));
    const pool = recent.length > 0 ? recent : this.peers.allQuadrants;
    return this.rng.pick(pool);
  }

  /** Напряжённость доступна по запросу — единственный потребитель — Фракции. */
  get value(): number {
    return this.tension;
  }
}
