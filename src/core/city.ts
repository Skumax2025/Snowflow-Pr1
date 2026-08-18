/**
 * Город — единственный гарант выживания игрока.
 *
 * Семь характеристик, устроен по общему контракту Пулов событий. Реагирует не
 * на то, что произошло на самом деле, а на то, что попало в его вход как явное
 * событие. Дельты считает и применяет только он сам: ни Парсер, ни Мостик,
 * ни Режиссёр в его состояние не пишут.
 */

import type { CityConfig } from "../config/types.js";
import type { EventBus } from "./bus.js";
import {
  EV,
  type AttackPayload,
  type ReportVerdictPayload,
  type SupplyPayload,
} from "./events.js";
import { CITY_DEAD, REPORT_PROCESSED, type FactRecord } from "./journal.js";
import { WorldEntity, type PoolContext } from "./pools.js";
import { clamp, type FactId, type Moment, type Quadrant } from "./types.js";

export class City extends WorldEntity {
  /** Счётчик убывания эффекта риторики. Служебный, наружу не отдаётся. */
  private rhetoricSaturation = 0;
  /** Дедуп-регистр id уже оплаченных фактов Журнала. Растёт всю партию. */
  private readonly paidFacts = new Set<FactId>();
  private lastTrustDelta = 0;
  private deathWritten = false;

  constructor(
    private readonly cfg: CityConfig,
    ctx: PoolContext,
    quadrant: Quadrant,
    private readonly bus: EventBus,
  ) {
    super("город", quadrant, cfg.pool, ctx);
    this.stats = {
      panic: cfg.start.panic,
      morale: cfg.start.morale,
      trust: cfg.start.trust,
      defence: cfg.start.defence,
      population: cfg.start.population,
      integrity: cfg.start.integrity,
      supply: cfg.start.supply,
    };

    this.bus.on<ReportVerdictPayload>(EV.REPORT_VERDICT, (p) => this.applyVerdict(p));
    this.bus.on<AttackPayload>(EV.ATTACK, (p) => {
      if (p.target === "город") this.applyAttack(p);
    });
    this.bus.on<SupplyPayload>(EV.SUPPLY_DELIVERED, () => this.applySupply(true));
    this.bus.on<SupplyPayload>(EV.SUPPLY_LOST, () => this.applySupply(false));
  }

  /**
   * Оборона — накопительная величина: формула даёт скорость прироста за минуту,
   * бои вычитают дискретно. Пересчитывать её заново на каждом тике нельзя —
   * следующий тик стёр бы урон от боя.
   */
  protected override beforePool(now: Moment): void {
    const elapsed = now.totalMinutes - this.lastTickMinute;
    if (elapsed <= 0) return;

    const rate =
      this.cfg.defenceRate.coefPanic * (this.stats.panic ?? 0) +
      this.cfg.defenceRate.coefIntegrity * (this.stats.integrity ?? 0);
    this.stats.defence = clamp((this.stats.defence ?? 0) + rate * elapsed, 0, this.cfg.defenceRate.cap);

    this.rhetoricSaturation = Math.max(
      0,
      this.rhetoricSaturation - this.cfg.rhetoric.decayPerMinute * elapsed,
    );

    this.checkDeath(now.totalMinutes);
  }

  // ── Входящие явные события ──────────────────────────────────────────────

  private applyVerdict(payload: ReportVerdictPayload): void {
    if (!this.alive) return;
    const now = this.ctx.now();
    let trustDelta = 0;
    const processed: Array<{ category: string; factId: FactId | null }> = [];

    for (const verdict of payload.verdicts) {
      processed.push({ category: verdict.category, factId: verdict.factId });

      if (verdict.category === "правда") {
        // Повторное подтверждение оплаченного факта даёт нулевую дельту Доверия.
        if (verdict.factId && !this.paidFacts.has(verdict.factId)) {
          this.paidFacts.add(verdict.factId);
          trustDelta += this.cfg.verdict.trustTruth;
          const fact = this.ctx.journal.byId(verdict.factId);
          if (fact?.archetypeTag === "агрессивное") {
            this.stats.panic = clamp(
              (this.stats.panic ?? 0) + this.cfg.verdict.panicPerConfirmedThreat,
              0,
              100,
            );
          }
        }
      } else if (verdict.category === "ложь") {
        trustDelta += this.cfg.verdict.trustLie;
      } else {
        trustDelta += this.cfg.verdict.trustInaccuracy;
      }
    }

    this.stats.trust = clamp((this.stats.trust ?? 0) + trustDelta, 0, 100);
    this.lastTrustDelta = trustDelta;

    // Риторика бьёт по Морали и всегда — даже за повторно подтверждённый факт.
    const decay =
      this.cfg.rhetoric.halfSaturation / (this.cfg.rhetoric.halfSaturation + this.rhetoricSaturation);
    const moraleDelta = this.cfg.verdict.moraleFromTone * payload.tone.inspiration * decay;
    this.stats.morale = clamp((this.stats.morale ?? 0) + moraleDelta, 0, 100);
    this.rhetoricSaturation += this.cfg.rhetoric.growthPerApply;

    // Агрегатная запись — список по каждому claim, а не счётчики.
    this.ctx.journal.write(
      {
        time: now,
        eventType: REPORT_PROCESSED,
        subject: "город",
        place: this.quadrant,
        status: "обработан",
      },
      processed,
    );
  }

  private applyAttack(payload: AttackPayload): void {
    if (!this.alive) return;
    const now = this.ctx.now();
    const defence = this.stats.defence ?? 0;
    const breached = payload.power > defence;

    if (breached) {
      const overflow = payload.power - defence;
      this.stats.population = clamp(
        (this.stats.population ?? 0) - overflow * this.cfg.breach.populationLossPercent,
        0,
        100,
      );
      this.stats.integrity = clamp((this.stats.integrity ?? 0) - this.cfg.breach.integrityLoss, 0, 100);
      this.stats.panic = clamp((this.stats.panic ?? 0) + this.cfg.verdict.panicPerConfirmedThreat, 0, 100);
    }

    this.stats.defence = clamp(defence - payload.power * this.cfg.breach.defenceLossFactor, 0, 100);

    this.ctx.journal.write({
      time: now,
      eventType: breached ? "атака_пробила_оборону" : "атака_отбита",
      subject: "город",
      place: this.quadrant,
      status: breached ? "пробитие" : "отбита",
      participants: [`сила:${payload.power}`, `источник:${payload.origin}`],
      archetypeTag: "агрессивное",
    });

    this.checkDeath(now);
  }

  private applySupply(delivered: boolean): void {
    if (!this.alive) return;
    if (delivered) {
      this.stats.supply = clamp((this.stats.supply ?? 0) + this.cfg.supplyEvent.delivered, 0, 100);
    } else {
      this.stats.supply = clamp((this.stats.supply ?? 0) + this.cfg.supplyEvent.lost, 0, 100);
      this.stats.panic = clamp((this.stats.panic ?? 0) + this.cfg.supplyEvent.lostPanic, 0, 100);
    }
  }

  private checkDeath(atMinute: number): void {
    if (this.deathWritten) return;
    if ((this.stats.population ?? 0) > 0) return;
    this.deathWritten = true;
    this.alive = false;
    this.ctx.journal.write({
      time: atMinute,
      eventType: CITY_DEAD,
      subject: "город",
      place: this.quadrant,
      status: "мёртв",
    });
  }

  // ── Выходы по запросу ───────────────────────────────────────────────────

  /** Производное значение, нигде не хранится. Отдаётся Мостику. */
  destruction(): number {
    const { weightIntegrity, weightPopulation } = this.cfg.destruction;
    return clamp(
      weightIntegrity * (100 - (this.stats.integrity ?? 0)) +
        weightPopulation * (100 - (this.stats.population ?? 0)),
      0,
      100,
    );
  }

  /** Объём поставки: пол применяется к объёму, а не к характеристике Снабжение. */
  supplyVolume(): number {
    const raw =
      this.cfg.supplyVolume.coefSupply * (this.stats.supply ?? 0) +
      this.cfg.supplyVolume.coefTrust * (this.stats.trust ?? 0);
    return Math.max(this.cfg.supplyVolume.floor, raw);
  }

  /** Читает Режиссёр по запросу. */
  get panic(): number {
    return this.stats.panic ?? 0;
  }

  get trustDelta(): number {
    return this.lastTrustDelta;
  }

  get characteristics(): Record<string, number> {
    return { ...this.stats };
  }

  get isDead(): boolean {
    return this.deathWritten;
  }

  /** Только для тестов «Первого среза»: заглянуть в дедуп-регистр. */
  hasPaidFor(factId: FactId): boolean {
    return this.paidFacts.has(factId);
  }

  /** Агрегатная запись последнего обработанного рапорта — для тестов. */
  lastReportRecord(): FactRecord | undefined {
    const list = this.ctx.journal.query({ eventType: REPORT_PROCESSED });
    return list[list.length - 1];
  }
}
