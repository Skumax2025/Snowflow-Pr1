/**
 * «Первый срез» заметок «Фракции» и «Режиссёр».
 *
 * Фракции: три исхода маршрутизации атаки (Склад, Город, пустота); рост веса от
 * Напряжённости; «агрессивное_сработало» Режиссёру; любой факт Своих несёт
 * непустое поле «место».
 *
 * Режиссёр: рост Напряжённости от Паники и падения Доверия, три пороговые
 * ветки, чтение по запросу, разряд по «агрессивное_сработало».
 */

import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";
import { EventBus } from "../src/core/bus.js";
import { Director } from "../src/core/director.js";
import { EV, type AttackPayload } from "../src/core/events.js";
import { Faction } from "../src/core/factions.js";
import { Journal } from "../src/core/journal.js";
import type { PoolContext } from "../src/core/pools.js";
import { createRng } from "../src/core/rng.js";
import { Structure, StructureRegistry } from "../src/core/structures.js";
import { allQuadrants, type Moment } from "../src/core/types.js";

const cfg = loadConfig();

function moment(totalMinutes: number): Moment {
  return { totalMinutes, day: 1, hour: 0, minute: 0, isNight: false };
}

/**
 * Мок: пул Противников с единственным событием «атака силой N» и нулевым
 * весом простоя — тик гарантированно катает атаку.
 */
function makeFactions(opts: { place: string; tension?: number }) {
  const bus = new EventBus();
  const journal = new Journal();
  const ctx: PoolContext = {
    journal,
    rng: createRng(9),
    external: { stormAt: () => 0, tension: () => opts.tension ?? 0 },
    emit: (event, payload) => bus.emit(event, payload),
  };
  const structures = new StructureRegistry();
  structures.add(
    new Structure("склад", "B2", 80, { stock: 60 }, cfg.structures, ctx, cfg.party.cityQuadrant, bus, 0),
  );

  const forcedCfg = loadConfig({
    factions: {
      pools: {
        противники: {
          idleWeight: 0,
          events: [
            {
              id: "атака_силой_N",
              baseWeight: 100,
              fact: { eventType: "атака", status: "нанесена", archetypeTag: "агрессивное" },
              outbound: { event: "атака_силой_N", to: "маршрутизация_атаки" },
              attackPower: [30, 30],
            },
          ],
        },
      },
    },
  });

  // Единственная свежая запись Журнала задаёт квадрант, который выберет атака.
  journal.write({ time: 0, eventType: "мок", subject: "мок", place: opts.place, status: "ок" });

  const enemies = new Faction(
    "противники",
    forcedCfg.factions,
    ctx,
    {
      cityQuadrant: () => cfg.party.cityQuadrant,
      structures,
      allQuadrants: allQuadrants(cfg.party.gridCols, cfg.party.gridRows),
      now: () => 0,
    },
    bus,
    0,
  );

  const attacks: AttackPayload[] = [];
  const aggressive: unknown[] = [];
  bus.on<AttackPayload>(EV.ATTACK, (p) => attacks.push(p));
  bus.on(EV.AGGRESSIVE_FIRED, (p) => aggressive.push(p));

  return { bus, journal, enemies, structures, attacks, aggressive };
}

describe("Фракции", () => {
  it("атака, попавшая в квадрант Склада, уходит этой Структуре", () => {
    const { enemies, attacks } = makeFactions({ place: "B2" });
    enemies.tick(moment(cfg.factions.pools.противники.tickMinutes));
    expect(attacks).toHaveLength(1);
    expect(attacks[0]?.target).toBe("структура:склад:B2");
    expect(attacks[0]?.power).toBe(30);
  });

  it("атака, попавшая в квадрант Города, уходит Городу тем же приёмником", () => {
    const { enemies, attacks } = makeFactions({ place: cfg.party.cityQuadrant });
    enemies.tick(moment(cfg.factions.pools.противники.tickMinutes));
    expect(attacks).toHaveLength(1);
    expect(attacks[0]?.target).toBe("город");
  });

  it("атака в пустой квадрант пишет «атака в пустоту» и никого не трогает", () => {
    const { enemies, journal, attacks } = makeFactions({ place: "A1" });
    enemies.tick(moment(cfg.factions.pools.противники.tickMinutes));
    expect(attacks).toHaveLength(0);
    const empty = journal.query({ eventType: "атака_в_пустоту" });
    expect(empty).toHaveLength(1);
    expect(empty[0]?.place).toBe("A1");
  });

  it("«агрессивное_сработало» уходит Режиссёру независимо от исхода маршрутизации", () => {
    const hit = makeFactions({ place: cfg.party.cityQuadrant });
    hit.enemies.tick(moment(60));
    const miss = makeFactions({ place: "A1" });
    miss.enemies.tick(moment(60));
    expect(hit.aggressive).toHaveLength(1);
    expect(miss.aggressive).toHaveLength(1);
  });

  it("Напряжённость поднимает вес агрессивного события", () => {
    const count = (tension: number) => {
      const bus = new EventBus();
      const journal = new Journal();
      const ctx: PoolContext = {
        journal,
        rng: createRng(77),
        external: { stormAt: () => 0, tension: () => tension },
        emit: (event, payload) => bus.emit(event, payload),
      };
      const faction = new Faction(
        "противники",
        cfg.factions,
        ctx,
        {
          cityQuadrant: () => cfg.party.cityQuadrant,
          structures: new StructureRegistry(),
          allQuadrants: allQuadrants(cfg.party.gridCols, cfg.party.gridRows),
          now: () => 0,
        },
        bus,
        0,
      );
      for (let t = 60; t <= 60 * 24 * 13; t += 60) faction.tick(moment(t));
      return journal.query({ archetypeTag: "агрессивное" }).length;
    };
    expect(count(90)).toBeGreaterThan(count(0));
  });

  it("любое флейвор-событие Своих пишет факт с непустым полем «место»", () => {
    const bus = new EventBus();
    const journal = new Journal();
    const ctx: PoolContext = {
      journal,
      rng: createRng(4),
      external: { stormAt: () => 0, tension: () => 0 },
      emit: () => {},
    };
    const own = new Faction(
      "свои",
      cfg.factions,
      ctx,
      {
        cityQuadrant: () => cfg.party.cityQuadrant,
        structures: new StructureRegistry(),
        allQuadrants: allQuadrants(cfg.party.gridCols, cfg.party.gridRows),
        now: () => 0,
      },
      bus,
      0,
    );
    for (let t = 60; t <= 60 * 100; t += 60) own.tick(moment(t));
    expect(journal.size).toBeGreaterThan(0);
    for (const rec of journal.all) expect(rec.place).toBeTruthy();
  });
});

describe("Режиссёр", () => {
  function makeDirector(panic: number, trustDelta: number) {
    const bus = new EventBus();
    const journal = new Journal();
    const attacks: AttackPayload[] = [];
    const supplyLost: unknown[] = [];
    bus.on<AttackPayload>(EV.ATTACK, (p) => attacks.push(p));
    bus.on(EV.SUPPLY_LOST, (p) => supplyLost.push(p));

    const director = new Director(cfg.director, bus, journal, createRng(8), {
      panic: () => panic,
      trustDelta: () => trustDelta,
      cityQuadrant: () => cfg.party.cityQuadrant,
      structures: new StructureRegistry(),
      allQuadrants: allQuadrants(cfg.party.gridCols, cfg.party.gridRows),
    });
    return { bus, journal, director, attacks, supplyLost };
  }

  it("Напряжённость стартует нулём и растёт от Паники и падения Доверия", () => {
    const { director } = makeDirector(80, -10);
    expect(director.value).toBe(0);
    director.tick(moment(60));
    expect(director.value).toBeGreaterThan(0);
    const after = director.value;
    director.tick(moment(120));
    expect(director.value).toBeGreaterThan(after);
  });

  it("не растёт при спокойном городе без падения Доверия", () => {
    const { director } = makeDirector(0, 0);
    for (let t = 60; t <= 60 * 24; t += 60) director.tick(moment(t));
    expect(director.value).toBe(0);
  });

  it("при пороге_1 Город получает «поставка_потеряна», Напряжённость падает на разряд", () => {
    const { director, supplyLost } = makeDirector(100, 0);
    for (let t = 60; t <= 60 * 200 && supplyLost.length === 0; t += 60) director.tick(moment(t));
    expect(supplyLost).toHaveLength(1);
    expect(director.value).toBeLessThan(cfg.director.branches.supplyLost);
  });

  it("при пороге_3 Город получает «атака силой N» с силой выше обычного диапазона", () => {
    // Разряд отключён, чтобы Напряжённость дошла до верхней ветки.
    const noDischarge = loadConfig({ director: { dischargeAmount: 0 } });
    const bus = new EventBus();
    const journal = new Journal();
    const attacks: AttackPayload[] = [];
    bus.on<AttackPayload>(EV.ATTACK, (p) => attacks.push(p));
    const director = new Director(noDischarge.director, bus, journal, createRng(8), {
      panic: () => 100,
      trustDelta: () => -20,
      cityQuadrant: () => cfg.party.cityQuadrant,
      structures: new StructureRegistry(),
      allQuadrants: allQuadrants(cfg.party.gridCols, cfg.party.gridRows),
    });
    for (let t = 60; t <= 60 * 300; t += 60) director.tick(moment(t));

    expect(attacks.length).toBeGreaterThan(0);
    expect(attacks[0]?.power).toBeGreaterThanOrEqual(cfg.director.raidPower[0]);
    expect(attacks[0]?.target).toBe("город");
    expect(journal.query({ eventType: "дезинформация" }).length).toBeGreaterThan(0);
  });

  it("факт «дезинформация» несёт непустое поле «место»", () => {
    const noDischarge = loadConfig({ director: { dischargeAmount: 0 } });
    const bus = new EventBus();
    const journal = new Journal();
    const director = new Director(noDischarge.director, bus, journal, createRng(8), {
      panic: () => 100,
      trustDelta: () => 0,
      cityQuadrant: () => cfg.party.cityQuadrant,
      structures: new StructureRegistry(),
      allQuadrants: allQuadrants(cfg.party.gridCols, cfg.party.gridRows),
    });
    for (let t = 60; t <= 60 * 200; t += 60) director.tick(moment(t));
    const facts = journal.query({ eventType: "дезинформация" });
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) expect(f.place).toBeTruthy();
  });

  it("Напряжённость читается по запросу без побочных эффектов", () => {
    const { director } = makeDirector(50, 0);
    director.tick(moment(60));
    const first = director.value;
    expect(director.value).toBe(first);
    expect(director.value).toBe(first);
  });

  it("«агрессивное_сработало» разряжает на ту же величину", () => {
    const { bus, director } = makeDirector(100, 0);
    for (let t = 60; t <= 60 * 20; t += 60) director.tick(moment(t));
    const before = director.value;
    bus.emit(EV.AGGRESSIVE_FIRED, { origin: "тест" });
    expect(director.value).toBeCloseTo(Math.max(0, before - cfg.director.dischargeAmount), 6);
  });
});
