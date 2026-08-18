/**
 * «Первые срезы» Эфира: Генератор эфира, Приём сигнала, Проверка сигнала.
 */

import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";
import { Broadcast, type Signal } from "../src/core/broadcast.js";
import { EventBus } from "../src/core/bus.js";
import { EV, type SignalCaughtPayload } from "../src/core/events.js";
import { Journal } from "../src/core/journal.js";
import type { PoolContext } from "../src/core/pools.js";
import { Reception } from "../src/core/reception.js";
import { createRng } from "../src/core/rng.js";
import { SignalCheck } from "../src/core/signalCheck.js";
import { Structure, StructureRegistry } from "../src/core/structures.js";
import type { Moment } from "../src/core/types.js";
import { Weather } from "../src/core/weather.js";

const cfg = loadConfig();

function moment(totalMinutes: number): Moment {
  const minuteOfDay = totalMinutes % cfg.party.minutesPerDay;
  return {
    totalMinutes,
    day: Math.floor(totalMinutes / cfg.party.minutesPerDay) + 1,
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    isNight: false,
  };
}

/** Заглушка Погоды с ручным переключением шторма по квадрантам. */
class WeatherStub {
  storms = new Set<string>();
  past = new Map<string, boolean>();
  isStorm(q: string): boolean {
    return this.storms.has(q);
  }
  wasStorm(q: string): boolean {
    return this.past.get(q) ?? false;
  }
  snapshot() {
    return [{ quadrant: "D4", storm: this.storms.has("D4") }];
  }
  baseTemperature(): number {
    return -20;
  }
  get stormPenalty(): number {
    return 12;
  }
}

function makeEther(seed = 5) {
  const bus = new EventBus();
  const journal = new Journal();
  const weather = new WeatherStub();
  const structures = new StructureRegistry();
  const ctx: PoolContext = {
    journal,
    rng: createRng(seed),
    external: { stormAt: () => 0, tension: () => 0 },
    now: () => 0,
    emit: () => {},
  };
  // Одна захардкоженная живая структура-приёмник в том же квадранте.
  structures.add(
    new Structure("пост", "B2", 60, {}, cfg.structures, ctx, cfg.party.cityQuadrant, bus, 0),
  );

  const broadcast = new Broadcast(
    cfg.broadcast,
    cfg.party,
    journal,
    structures,
    weather as unknown as Weather,
    createRng(seed),
    bus,
  );
  return { bus, journal, weather, structures, broadcast };
}

describe("Генератор эфира", () => {
  it("запись Журнала превращается в объект «Сигнал» ровно один раз на факт", () => {
    const { journal, broadcast } = makeEther();
    journal.write({
      time: 1,
      eventType: "конвой_вышел",
      subject: "структура:склад:B2",
      place: "B2",
      status: "в_пути",
    });
    broadcast.tick(moment(cfg.broadcast.tickMinutes));
    broadcast.tick(moment(cfg.broadcast.tickMinutes * 2));

    const fromFacts = broadcast.all.filter((s) => s.sourceFact !== null);
    expect(fromFacts).toHaveLength(1);
    expect(fromFacts[0]?.accuracy).toBe("правда");
    expect(fromFacts[0]?.band).toBe("военный");
  });

  it("сигнал протухает по TTL и исчезает из списка", () => {
    const { journal, broadcast } = makeEther();
    journal.write({ time: 1, eventType: "болтовня", subject: "структура:пост:B2", place: "B2", status: "в_эфире" });
    broadcast.tick(moment(cfg.broadcast.tickMinutes));
    expect(broadcast.liveSignals().length).toBe(1);

    broadcast.tick(moment(cfg.broadcast.tickMinutes + cfg.broadcast.ttlMinutes + 1));
    expect(broadcast.liveSignals().length).toBe(0);
  });

  it("запись из квадранта вне радиуса живых структур не звучит вовсе", () => {
    const { journal, broadcast } = makeEther();
    journal.write({ time: 1, eventType: "болтовня", subject: "структура:пост:F6", place: "F6", status: "в_эфире" });
    broadcast.tick(moment(cfg.broadcast.tickMinutes));
    expect(broadcast.liveSignals()).toHaveLength(0);
  });

  it("шторм над квадрантом-источником гасит запись полностью, на следующий тик не откладывая", () => {
    const { journal, weather, broadcast } = makeEther();
    weather.storms.add("B2");
    journal.write({ time: 1, eventType: "болтовня", subject: "структура:пост:B2", place: "B2", status: "в_эфире" });
    broadcast.tick(moment(cfg.broadcast.tickMinutes));
    expect(broadcast.liveSignals()).toHaveLength(0);

    weather.storms.delete("B2");
    broadcast.tick(moment(cfg.broadcast.tickMinutes * 2));
    expect(broadcast.liveSignals()).toHaveLength(0);
  });

  it("запись с тегом «агрессивное» звучит только как искажение или ложь", () => {
    const { journal, broadcast } = makeEther();
    for (let i = 0; i < 30; i++) {
      journal.write({
        time: 1 + i,
        eventType: "атака",
        subject: "фракция:противники",
        place: "B2",
        status: "нанесена",
        archetypeTag: "агрессивное",
      });
    }
    broadcast.tick(moment(cfg.broadcast.tickMinutes));
    const accuracies = new Set(broadcast.all.map((s) => s.accuracy));
    expect(accuracies.has("правда")).toBe(false);
    expect(accuracies.has("неточность")).toBe(false);
    expect(accuracies.has("ложь") || accuracies.has("искажение")).toBe(true);
  });

  it("диапазон берётся из таблицы «Слышимость» по типу источника", () => {
    const { journal, broadcast } = makeEther();
    journal.write({ time: 1, eventType: "болтовня", subject: "структура:пост:B2", place: "B2", status: "в_эфире" });
    journal.write({ time: 2, eventType: "сигнал_бедствия", subject: "фракция:мародёры", place: "B2", status: "передан" });
    journal.write({ time: 3, eventType: "дезинформация", subject: "режиссёр:дезинформация", place: "B2", status: "в_эфире" });
    broadcast.tick(moment(cfg.broadcast.tickMinutes));

    const byType = new Map(broadcast.all.map((s) => [s.eventType, s.band]));
    expect(byType.get("болтовня")).toBe("посты");
    expect(byType.get("сигнал_бедствия")).toBe("гражданский");
    expect(byType.get("дезинформация")).toBe("гражданский");
  });

  it("частота лежит внутри назначенного диапазона", () => {
    const { journal, broadcast } = makeEther();
    for (let i = 0; i < 20; i++) {
      journal.write({ time: i, eventType: "болтовня", subject: "структура:пост:B2", place: "B2", status: "в_эфире" });
    }
    broadcast.tick(moment(cfg.broadcast.tickMinutes));
    for (const signal of broadcast.all) {
      const range = cfg.party.bands.find((b) => b.band === signal.band);
      expect(signal.frequency).toBeGreaterThanOrEqual(range?.from as number);
      expect(signal.frequency).toBeLessThan(range?.to as number);
    }
  });

  it("фантом обходит проверки слышимости и шторма", () => {
    const { bus, weather, broadcast } = makeEther();
    weather.storms.add(cfg.party.towerQuadrant);
    for (const q of ["A1", "B2", "F6"]) weather.storms.add(q);

    broadcast.tick(moment(60));
    expect(broadcast.liveSignals()).toHaveLength(0);

    bus.emit(EV.MIX_PHANTOM_SIGNAL, {});
    const live = broadcast.liveSignals();
    expect(live).toHaveLength(1);
    expect(live[0]?.sourceFact).toBeNull();
  });

  it("обе регулярные сводки выходят в свой час на фиксированной частоте и всегда правдивы", () => {
    const { broadcast } = makeEther();
    broadcast.tick(moment(cfg.broadcast.meteoHour * 60));
    const meteo = broadcast.all.filter((s) => s.kind === "сводка");
    expect(meteo).toHaveLength(1);
    expect(meteo[0]?.frequency).toBe(cfg.party.meteoFrequency);

    // Час сводки ретрансляторов дальше TTL метеосводки: та уже протухла,
    // и это ровно механика «проспал — потерял».
    broadcast.tick(moment(cfg.broadcast.relayHour * 60));
    const relay = broadcast.all.filter((s) => s.kind === "сводка");
    expect(relay).toHaveLength(1);
    expect(relay[0]?.frequency).toBe(cfg.party.relayFrequency);

    for (const d of [...meteo, ...relay]) {
      expect(d.accuracy).toBe("правда");
      expect(d.band).toBe("военный");
      expect(d.sourceFact).toBeNull();
      expect(d.digest).toBeDefined();
    }
  });
});

describe("Приём сигнала", () => {
  /** Заглушка Генератора эфира: два захардкоженных сигнала. */
  function makeReception() {
    const bus = new EventBus();
    const weather = new WeatherStub();
    const signals: Signal[] = [
      {
        id: "s1",
        time: 0,
        kind: "обычный",
        band: "военный",
        frequency: 142,
        accuracy: "ложь",
        sourceFact: "f1",
        sourceQuadrant: "D4",
        eventType: "конвой_вышел",
        declaredDistance: 12,
        declaredRoute: "через лес",
        declaredTimestamp: 14 * 60,
        expiresAt: 100000,
        caught: false,
      },
      {
        id: "s2",
        time: 0,
        kind: "сводка",
        band: "военный",
        frequency: 150,
        accuracy: "правда",
        sourceFact: null,
        sourceQuadrant: "",
        eventType: "метеосводка",
        declaredDistance: 0,
        declaredRoute: "",
        declaredTimestamp: 0,
        digest: { kind: "метео", entries: [{ quadrant: "D4", storm: true }] },
        expiresAt: 100000,
        caught: false,
      },
    ];
    const broadcast = {
      liveSignals: () => signals.filter((s) => !s.caught),
      markCaught: (id: string) => {
        const s = signals.find((x) => x.id === id);
        if (s) s.caught = true;
      },
      byId: (id: string) => signals.find((s) => s.id === id),
    } as unknown as Broadcast;

    const reception = new Reception(
      cfg.reception,
      cfg.party,
      broadcast,
      weather as unknown as Weather,
      cfg.party.towerQuadrant,
      bus,
    );
    const caught: SignalCaughtPayload[] = [];
    const minutes: unknown[] = [];
    bus.on<SignalCaughtPayload>(EV.SIGNAL_CAUGHT, (p) => caught.push(p));
    bus.on(EV.SPEND_MINUTES, (p) => minutes.push(p));
    return { bus, weather, broadcast, reception, caught, minutes, signals };
  }

  it("промах далеко от частоты: время потрачено, сигнал остался в пуле", () => {
    const { reception, caught, minutes, broadcast } = makeReception();
    reception.setTuner(110);
    expect(reception.attempt()).toEqual({ outcome: "промах" });
    expect(minutes).toHaveLength(1);
    expect(caught).toHaveLength(0);
    expect(broadcast.liveSignals()).toHaveLength(2);
  });

  it("попадание в окно ловит обычный сигнал и убирает его из пула", () => {
    const { reception, caught, broadcast } = makeReception();
    reception.setTuner(142);
    expect(reception.attempt()).toEqual({ outcome: "пойман", signalId: "s1" });
    expect(caught[0]?.signalKind).toBe("обычный");
    expect(broadcast.liveSignals()).toHaveLength(1);
  });

  it("сводка ловится тем же действием и уходит с вложенным содержимым", () => {
    const { reception, caught } = makeReception();
    reception.setTuner(150);
    reception.attempt();
    expect(caught[0]?.signalKind).toBe("сводка");
    expect(caught[0]?.digest).toBeDefined();
  });

  it("повторная попытка на тех же позициях: ловить нечего", () => {
    const { reception, caught } = makeReception();
    reception.setTuner(142);
    reception.attempt();
    reception.setTuner(150);
    reception.attempt();
    reception.setTuner(142);
    expect(reception.attempt()).toEqual({ outcome: "промах" });
    expect(caught).toHaveLength(2);
  });

  it("шторм над квадрантом вышки блокирует попытку целиком, время не тратится", () => {
    const { reception, weather, minutes, caught } = makeReception();
    weather.storms.add(cfg.party.towerQuadrant);
    reception.setTuner(142);
    expect(reception.blocked).toBe(true);
    expect(reception.attempt()).toEqual({ outcome: "заблокировано" });
    expect(minutes).toHaveLength(0);
    expect(caught).toHaveLength(0);
  });

  it("при нескольких сигналах в окне ловится ближайший по частоте", () => {
    const { reception, signals } = makeReception();
    signals[1]!.frequency = 143;
    reception.setTuner(143);
    expect(reception.attempt()).toEqual({ outcome: "пойман", signalId: "s2" });
  });

  it("скраббинг бесплатен", () => {
    const { reception, minutes } = makeReception();
    for (let f = 0; f < 300; f += 10) reception.setTuner(f);
    expect(minutes).toHaveLength(0);
  });
});

describe("Проверка сигнала", () => {
  function makeCheck() {
    const bus = new EventBus();
    const weather = new WeatherStub();
    const signal: Signal = {
      id: "s1",
      time: 0,
      kind: "обычный",
      band: "военный",
      frequency: 142,
      accuracy: "ложь",
      sourceFact: "f1",
      sourceQuadrant: "D4",
      eventType: "конвой_вышел",
      declaredDistance: 12,
      declaredRoute: "через лес",
      declaredTimestamp: 14 * 60,
      expiresAt: 100000,
      caught: true,
    };
    const broadcast = { byId: (id: string) => (id === "s1" ? signal : undefined) } as unknown as Broadcast;
    const check = new SignalCheck(cfg.signalCheck, broadcast, weather as unknown as Weather, bus);
    const minutes: unknown[] = [];
    const fuel: unknown[] = [];
    bus.on(EV.SPEND_MINUTES, (p) => minutes.push(p));
    bus.on(EV.SPEND_FUEL, (p) => fuel.push(p));
    return { bus, weather, check, minutes, fuel };
  }

  it("проверка списывает минуты и топливо и раскрывает четыре поля плюс шторм-сверку", () => {
    const { bus, check, minutes, fuel } = makeCheck();
    bus.emit<SignalCaughtPayload>(EV.SIGNAL_CAUGHT, {
      signalId: "s1",
      frequency: 142,
      band: "военный",
      signalKind: "обычный",
    });
    expect(check.queue).toEqual(["s1"]);

    const details = check.check("s1");
    expect(minutes).toHaveLength(1);
    expect(fuel).toHaveLength(1);
    expect(details).toMatchObject({
      declaredQuadrant: "D4",
      declaredDistance: 12,
      declaredRoute: "через лес",
      declaredTimestamp: 14 * 60,
      stormAtDeclaredMoment: false,
    });
  });

  it("повторный запуск того же id ресурсы не тратит, детали показывает снова", () => {
    const { check, minutes, fuel } = makeCheck();
    const first = check.check("s1");
    const second = check.check("s1");
    expect(minutes).toHaveLength(1);
    expect(fuel).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("переключение истории Погоды меняет строку шторм-сверки, детали те же", () => {
    const a = makeCheck();
    const detailsA = a.check.check("s1");

    const b = makeCheck();
    b.weather.past.set("D4", true);
    const detailsB = b.check.check("s1");

    expect(detailsA?.stormAtDeclaredMoment).toBe(false);
    expect(detailsB?.stormAtDeclaredMoment).toBe(true);
    expect(detailsB?.declaredDistance).toBe(detailsA?.declaredDistance);
  });

  it("тег «точность» нигде не появляется в выводе, хотя в моке он «ложь»", () => {
    const { check } = makeCheck();
    const details = check.check("s1");
    expect(JSON.stringify(details)).not.toContain("ложь");
    expect(details).not.toHaveProperty("accuracy");
    expect(details).not.toHaveProperty("точность");
  });

  it("сводки в очередь проверки не попадают", () => {
    const { bus, check } = makeCheck();
    bus.emit<SignalCaughtPayload>(EV.SIGNAL_CAUGHT, {
      signalId: "s2",
      frequency: 120,
      band: "военный",
      signalKind: "сводка",
    });
    expect(check.queue).toHaveLength(0);
  });
});
