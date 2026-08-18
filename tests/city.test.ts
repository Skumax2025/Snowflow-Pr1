/**
 * «Первый срез» заметки «Город», один к одному: семь проверок на мок-событиях,
 * без единого случайного тика собственного пула (пул заглушён нулевыми весами).
 */

import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";
import { EventBus } from "../src/core/bus.js";
import { City } from "../src/core/city.js";
import { EV, type AttackPayload, type ReportVerdictPayload } from "../src/core/events.js";
import { Journal, REPORT_PROCESSED } from "../src/core/journal.js";
import type { PoolContext } from "../src/core/pools.js";
import { createRng } from "../src/core/rng.js";
import type { Moment } from "../src/core/types.js";

function moment(totalMinutes: number): Moment {
  return { totalMinutes, day: 1, hour: 0, minute: 0, isNight: true };
}

function makeCity() {
  // Мок-конфиг: собственный пул выключен, чтобы проверять только внешний контракт.
  const cfg = loadConfig({
    city: { pool: { idleWeight: 1, events: [] } },
  });
  const bus = new EventBus();
  const journal = new Journal();
  const ctx: PoolContext = {
    journal,
    rng: createRng(1),
    external: { stormAt: () => 0, tension: () => 0 },
    now: () => 0,
    emit: (event, payload) => bus.emit(event, payload),
  };
  const city = new City(cfg.city, ctx, cfg.party.cityQuadrant, bus);
  return { cfg, bus, journal, city };
}

const tone = { inspiration: 0.6, anxiety: 0.2, specificity: 0.5 };

describe("Город", () => {
  it("инициализируется стартовыми значениями и квадрантом из мок-конфига", () => {
    const { cfg, city } = makeCity();
    expect(city.characteristics).toEqual({
      panic: cfg.city.start.panic,
      morale: cfg.city.start.morale,
      trust: cfg.city.start.trust,
      defence: cfg.city.start.defence,
      population: cfg.city.start.population,
      integrity: cfg.city.start.integrity,
      supply: cfg.city.start.supply,
    });
    expect(city.quadrant).toBe(cfg.party.cityQuadrant);
  });

  it("правдивый claim поднимает Доверие и Мораль, кладёт id в дедуп-регистр и пишет агрегат", () => {
    const { bus, journal, city, cfg } = makeCity();
    const fact = journal.write({
      time: 10,
      eventType: "конвой_вышел",
      subject: "склад:B2",
      place: "B2",
      status: "в_пути",
    });

    const trustBefore = city.characteristics.trust as number;
    const moraleBefore = city.characteristics.morale as number;

    bus.emit<ReportVerdictPayload>(EV.REPORT_VERDICT, {
      verdicts: [{ claimId: "c1", category: "правда", factId: fact.id }],
      tone,
    });

    expect(city.characteristics.trust).toBe(trustBefore + cfg.city.verdict.trustTruth);
    expect(city.characteristics.morale as number).toBeGreaterThan(moraleBefore);
    expect(city.hasPaidFor(fact.id)).toBe(true);

    const aggregate = journal.query({ eventType: REPORT_PROCESSED });
    expect(aggregate).toHaveLength(1);
    expect(journal.payloadOf(aggregate[0]!.id)).toEqual([{ category: "правда", factId: fact.id }]);
  });

  it("повторный тот же вердикт: Доверие не меняется, Мораль растёт слабее", () => {
    const { bus, journal, city } = makeCity();
    const fact = journal.write({
      time: 10,
      eventType: "конвой_вышел",
      subject: "склад:B2",
      place: "B2",
      status: "в_пути",
    });
    const payload: ReportVerdictPayload = {
      verdicts: [{ claimId: "c1", category: "правда", factId: fact.id }],
      tone,
    };

    const moraleStart = city.characteristics.morale as number;
    bus.emit<ReportVerdictPayload>(EV.REPORT_VERDICT, payload);
    const trustAfterFirst = city.characteristics.trust as number;
    const firstMoraleGain = (city.characteristics.morale as number) - moraleStart;

    const moraleMid = city.characteristics.morale as number;
    bus.emit<ReportVerdictPayload>(EV.REPORT_VERDICT, payload);
    const secondMoraleGain = (city.characteristics.morale as number) - moraleMid;

    expect(city.characteristics.trust).toBe(trustAfterFirst);
    expect(secondMoraleGain).toBeLessThan(firstMoraleGain);
    expect(secondMoraleGain).toBeGreaterThan(0);
  });

  it("атака силой больше Обороны роняет Население и пишет «атака пробила оборону»", () => {
    const { bus, journal, city, cfg } = makeCity();
    const defence = city.characteristics.defence as number;
    const power = defence + 20;

    bus.emit<AttackPayload>(EV.ATTACK, {
      power,
      quadrant: cfg.party.cityQuadrant,
      target: "город",
      origin: "фракция:противники",
    });

    const expectedLoss = 20 * cfg.city.breach.populationLossPercent;
    expect(city.characteristics.population).toBeCloseTo(100 - expectedLoss, 6);

    const facts = journal.query({ eventType: "атака_пробила_оборону" });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.place).toBe(cfg.party.cityQuadrant);
  });

  it("атака слабее Обороны отбивается, факт пишется всё равно", () => {
    const { bus, journal, city, cfg } = makeCity();
    bus.emit<AttackPayload>(EV.ATTACK, {
      power: 5,
      quadrant: cfg.party.cityQuadrant,
      target: "город",
      origin: "фракция:противники",
    });
    expect(city.characteristics.population).toBe(100);
    expect(journal.query({ eventType: "атака_отбита" })).toHaveLength(1);
  });

  it("Оборона восстанавливается постепенно, а не возвращается к формуле мгновенно", () => {
    const { bus, city, cfg } = makeCity();
    city.tick(moment(0));
    const before = city.characteristics.defence as number;

    bus.emit<AttackPayload>(EV.ATTACK, {
      power: 40,
      quadrant: cfg.party.cityQuadrant,
      target: "город",
      origin: "фракция:противники",
    });
    const afterAttack = city.characteristics.defence as number;
    expect(afterAttack).toBeLessThan(before);

    city.tick(moment(60));
    const afterOneHour = city.characteristics.defence as number;
    expect(afterOneHour).toBeGreaterThan(afterAttack);
    expect(afterOneHour).toBeLessThan(before);
  });

  it("при нулевых Доверии и Снабжении объём поставки равен полу, а не нулю", () => {
    const { bus, city, cfg } = makeCity();
    for (let i = 0; i < 20; i++) {
      bus.emit<ReportVerdictPayload>(EV.REPORT_VERDICT, {
        verdicts: [{ claimId: `c${i}`, category: "ложь", factId: null }],
        tone: { inspiration: 0, anxiety: 0, specificity: 0 },
      });
      bus.emit(EV.SUPPLY_LOST, { origin: "тест" });
    }
    expect(city.characteristics.trust).toBe(0);
    expect(city.characteristics.supply).toBe(0);
    expect(city.supplyVolume()).toBe(cfg.city.supplyVolume.floor);
  });

  it("«Разрушение» считается на лету и нигде не хранится", () => {
    const { city } = makeCity();
    const before = city.destruction();
    expect(Object.keys(city.characteristics)).not.toContain("destruction");

    city.characteristics; // читать можно, писать — нет
    (city as unknown as { stats: Record<string, number> }).stats.integrity = 20;
    expect(city.destruction()).toBeGreaterThan(before);
  });

  it("при Населении 0 пишет факт «город мёртв» ровно один раз", () => {
    const { bus, journal, city, cfg } = makeCity();
    for (let i = 0; i < 60; i++) {
      bus.emit<AttackPayload>(EV.ATTACK, {
        power: 100,
        quadrant: cfg.party.cityQuadrant,
        target: "город",
        origin: "фракция:противники",
      });
    }
    expect(city.characteristics.population).toBe(0);
    expect(journal.query({ eventType: "город_мёртв" })).toHaveLength(1);
    expect(city.isDead).toBe(true);
  });
});
