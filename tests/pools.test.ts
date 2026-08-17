/**
 * «Первый срез» заметок «Пулы событий» и «Структуры».
 *
 * Пулы: Склад порождает Конвой; Конвой тикает свой пул самостоятельно; доходит
 * до терминального события; всё различие между сущностями лежит в данных
 * таблиц; повтор с тем же сидом даёт тот же результат.
 *
 * Структуры: «атака силой N» больше Целостности гасит Структуру общим
 * механизмом, факт «структура уничтожена» с полем «место» уходит в Журнал.
 */

import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";
import { EventBus } from "../src/core/bus.js";
import { EV, type AttackPayload } from "../src/core/events.js";
import { Journal } from "../src/core/journal.js";
import type { PoolContext } from "../src/core/pools.js";
import { createRng } from "../src/core/rng.js";
import { Structure } from "../src/core/structures.js";
import type { Moment } from "../src/core/types.js";

const cfg = loadConfig();

function moment(totalMinutes: number): Moment {
  return { totalMinutes, day: 1, hour: 0, minute: 0, isNight: false };
}

function makeDepot(seed = 11, storm = false) {
  const bus = new EventBus();
  const journal = new Journal();
  const ctx: PoolContext = {
    journal,
    rng: createRng(seed),
    external: { stormAt: () => (storm ? 1 : 0), tension: () => 0 },
    emit: (event, payload) => bus.emit(event, payload),
  };
  const depot = new Structure(
    "склад",
    "B2",
    80,
    { stock: 60 },
    cfg.structures,
    ctx,
    cfg.party.cityQuadrant,
    bus,
    0,
  );
  return { bus, journal, depot, ctx };
}

function runFor(depot: Structure, minutes: number, step = cfg.party.loopStepMinutes) {
  for (let t = step; t <= minutes; t += step) depot.tick(moment(t));
}

describe("Пулы событий", () => {
  it("Склад порождает Конвой, Конвой тикает свой пул и доходит до терминального события", () => {
    const { journal, depot } = makeDepot(11);
    runFor(depot, 5000);

    expect(journal.query({ eventType: "конвой_вышел" }).length).toBeGreaterThan(0);
    expect(journal.query({ eventType: "конвой_в_пути" }).length).toBeGreaterThan(0);

    const terminal = [
      ...journal.query({ eventType: "конвой_прибыл" }),
      ...journal.query({ eventType: "конвой_перехвачен" }),
      ...journal.query({ eventType: "конвой_погиб_в_шторме" }),
    ];
    expect(terminal.length).toBeGreaterThan(0);
  });

  it("терминальное событие Конвоя шлёт Городу явное событие и убирает его из реестра", () => {
    const { bus, depot } = makeDepot(11);
    const supply: string[] = [];
    bus.on(EV.SUPPLY_DELIVERED, () => supply.push("доставлена"));
    bus.on(EV.SUPPLY_LOST, () => supply.push("потеряна"));

    runFor(depot, 5000);
    expect(supply.length).toBeGreaterThan(0);
    // Все дошедшие до терминала конвои вычищены из реестра родителя.
    for (const convoy of depot.convoys) expect(convoy.alive).toBe(true);
  });

  it("каждый факт несёт непустое поле «место»", () => {
    const { journal, depot } = makeDepot(11);
    runFor(depot, 5000);
    expect(journal.size).toBeGreaterThan(0);
    for (const record of journal.all) {
      expect(record.place).toBeTruthy();
    }
  });

  it("повтор прогона с тем же сидом даёт тот же результат", () => {
    const a = makeDepot(2024);
    const b = makeDepot(2024);
    runFor(a.depot, 4000);
    runFor(b.depot, 4000);
    expect(JSON.stringify(a.journal.all)).toBe(JSON.stringify(b.journal.all));
  });

  it("разные сиды расходятся", () => {
    const a = makeDepot(1);
    const b = makeDepot(2);
    runFor(a.depot, 4000);
    runFor(b.depot, 4000);
    expect(JSON.stringify(a.journal.all)).not.toBe(JSON.stringify(b.journal.all));
  });

  it("внешний модификатор «погода» поднимает вес погодозависимого события", () => {
    const calm = makeDepot(31);
    const stormy = makeDepot(31, true);
    runFor(calm.depot, 8000);
    runFor(stormy.depot, 8000);
    const calmDeaths = calm.journal.query({ eventType: "конвой_погиб_в_шторме" }).length;
    const stormyDeaths = stormy.journal.query({ eventType: "конвой_погиб_в_шторме" }).length;
    expect(stormyDeaths).toBeGreaterThan(calmDeaths);
  });

  it("Ретранслятор собственных фактов не генерирует", () => {
    const bus = new EventBus();
    const journal = new Journal();
    const ctx: PoolContext = {
      journal,
      rng: createRng(5),
      external: { stormAt: () => 0, tension: () => 0 },
      emit: () => {},
    };
    const relay = new Structure(
      "ретранслятор",
      "C4",
      70,
      { gain: 50 },
      cfg.structures,
      ctx,
      cfg.party.cityQuadrant,
      bus,
      0,
    );
    runFor(relay, 10000);
    expect(journal.size).toBe(0);
  });
});

describe("Структуры", () => {
  it("атака силой больше Целостности гасит Структуру и пишет факт с местом", () => {
    const { bus, journal, depot } = makeDepot(3);
    depot.tick(moment(100));

    bus.emit<AttackPayload>(EV.ATTACK, {
      power: 100,
      quadrant: "B2",
      target: depot.subject,
      origin: "фракция:противники",
    });

    expect(depot.integrity).toBe(0);
    expect(depot.alive).toBe(false);
    const facts = journal.query({ eventType: "структура_уничтожена" });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.place).toBe("B2");
  });

  it("уничтоженный Склад перестаёт тикать и больше не рожает конвои", () => {
    const { bus, journal, depot } = makeDepot(3);
    bus.emit<AttackPayload>(EV.ATTACK, {
      power: 100,
      quadrant: "B2",
      target: depot.subject,
      origin: "фракция:противники",
    });
    const sizeAfterDeath = journal.size;
    runFor(depot, 8000);
    expect(journal.size).toBe(sizeAfterDeath);
  });

  it("атака, адресованная другой Структуре, эту не трогает", () => {
    const { bus, depot } = makeDepot(3);
    bus.emit<AttackPayload>(EV.ATTACK, {
      power: 100,
      quadrant: "B2",
      target: "структура:склад:E5",
      origin: "фракция:противники",
    });
    expect(depot.integrity).toBe(80);
    expect(depot.alive).toBe(true);
  });
});
