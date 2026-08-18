/**
 * «Первые срезы» Стола и второго контура: Карта, Галлюцинации,
 * Фильтр аномалий, Финал.
 */

import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";
import { AnomalyFilter, type AnomalyTransport } from "../src/core/anomalyFilter.js";
import { EventBus } from "../src/core/bus.js";
import { Ending } from "../src/core/ending.js";
import { EV, type OfftopicPayload, type SignalCaughtPayload } from "../src/core/events.js";
import { Hallucinations } from "../src/core/hallucinations.js";
import { Journal, REPORT_PROCESSED, CITY_DEAD } from "../src/core/journal.js";
import { GameMap } from "../src/core/map.js";
import { createRng } from "../src/core/rng.js";
import { GameTime } from "../src/core/time.js";
import type { Moment } from "../src/core/types.js";

const cfg = loadConfig();
const dayCfg = {
  minutesPerDay: cfg.party.minutesPerDay,
  dawnHour: cfg.party.dawnHour,
  duskHour: cfg.party.duskHour,
};

function moment(totalMinutes: number): Moment {
  return { totalMinutes, day: 1, hour: 0, minute: 0, isNight: true };
}

describe("Карта", () => {
  function make() {
    const bus = new EventBus();
    const time = new GameTime(dayCfg, bus);
    const map = new GameMap(cfg.party.gridCols, cfg.party.gridRows, time, bus);
    return { bus, time, map };
  }

  it("пойманная сводка отображается, но ни одна метка сама не появляется", () => {
    const { bus, map } = make();
    bus.emit<SignalCaughtPayload>(EV.SIGNAL_CAUGHT, {
      signalId: "s1",
      frequency: 120,
      band: "военный",
      signalKind: "сводка",
      digest: { kind: "метео", entries: [{ quadrant: "D4", storm: true }] },
    });
    expect(map.digest("метео")?.entries).toEqual([{ quadrant: "D4", storm: true }]);
    expect(map.allStormMarks).toHaveLength(0);
    expect(map.relayStatus("D4")).toBe("не знаю");
  });

  it("метка шторма накопительная: старые записи не пропадают", () => {
    const { time, map } = make();
    map.markStorm("D4", "шторм");
    expect(map.stormHistory("D4")).toHaveLength(1);

    time.advance(120);
    map.markStorm("D4", "чисто");
    const history = map.stormHistory("D4");
    expect(history).toHaveLength(2);
    expect(history[0]?.status).toBe("шторм");
    expect(history[1]?.status).toBe("чисто");
    expect(history[1]?.observedAt).toBe(120);
  });

  it("метка ретранслятора перезаписывается, прежнее значение нигде не хранится", () => {
    const { map } = make();
    map.markRelay("C2", "активен");
    map.markRelay("C2", "мёртв");
    expect(map.relayStatus("C2")).toBe("мёртв");
    expect(JSON.stringify(map)).not.toContain("активен");
  });

  it("метка поста декоративна и без статуса", () => {
    const { map } = make();
    map.markPost("A4");
    expect(map.hasPost("A4")).toBe(true);
    expect(map.hasPost("A1")).toBe(false);
  });

  it("обычный сигнал на Карту не попадает — сюда приходят только сводки", () => {
    const { bus, map } = make();
    bus.emit<SignalCaughtPayload>(EV.SIGNAL_CAUGHT, {
      signalId: "s9",
      frequency: 142,
      band: "военный",
      signalKind: "обычный",
    });
    expect(map.digest("метео")).toBeUndefined();
  });

  it("Карта не читает Погоду, Структуры и Журнал", () => {
    const { map } = make();
    const keys = JSON.stringify(Object.keys(map));
    expect(keys).not.toContain("weather");
    expect(keys).not.toContain("journal");
    expect(keys).not.toContain("structures");
  });
});

describe("Фильтр аномалий", () => {
  /** Заглушка Базы: пять захардкоженных approved-текстов, без сетевого вызова. */
  class StubTransport implements AnomalyTransport {
    written: string[] = [];
    constructor(private readonly items: Array<{ id: string; text: string }>) {}
    write(text: string): void {
      this.written.push(text);
    }
    async readApproved(): Promise<Array<{ id: string; text: string }>> {
      return this.items;
    }
  }

  function make(count = 5) {
    const bus = new EventBus();
    const transport = new StubTransport(
      Array.from({ length: count }, (_, i) => ({ id: `a${i}`, text: `голос ${i}` })),
    );
    const filter = new AnomalyFilter(cfg.anomalyFilter, transport, bus);
    return { bus, transport, filter };
  }

  it("первые пять ответов — пять разных текстов без повторов, шестой — «пусто»", async () => {
    const { filter } = make(5);
    await filter.loadCache();
    const rng = createRng(7);
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const voice = filter.requestVoice((items) => rng.pick(items));
      expect(voice).not.toBeNull();
      seen.add(voice as string);
    }
    expect(seen.size).toBe(5);
    expect(filter.requestVoice((items) => rng.pick(items))).toBeNull();
  });

  it("пустая база возвращает «пусто» с первого же запроса", async () => {
    const { filter } = make(0);
    await filter.loadCache();
    expect(filter.requestVoice((items) => items[0]!)).toBeNull();
  });

  it("«офтопик_обнаружен» кладётся в Базу fire-and-forget", () => {
    const { bus, transport } = make();
    bus.emit<OfftopicPayload>(EV.OFFTOPIC_FOUND, { text: "я не помню, как меня зовут" });
    expect(transport.written).toEqual(["я не помню, как меня зовут"]);
  });

  it("кэш грузится один раз за партию", async () => {
    const { filter } = make(3);
    await filter.loadCache();
    await filter.loadCache();
    expect(filter.cachedCount).toBe(3);
  });
});

describe("Галлюцинации", () => {
  function make(sanity: number, count = 3) {
    const bus = new EventBus();
    const transport = {
      write: () => {},
      readApproved: async () => Array.from({ length: count }, (_, i) => ({ id: `a${i}`, text: `голос ${i}` })),
    };
    const filter = new AnomalyFilter(cfg.anomalyFilter, transport, bus);
    const radioman = { sanityValue: sanity };
    const hallucinations = new Hallucinations(cfg.hallucinations, radioman, filter, createRng(21), bus);
    const phantoms: unknown[] = [];
    bus.on(EV.MIX_PHANTOM_SIGNAL, (p) => phantoms.push(p));
    return { bus, filter, radioman, hallucinations, phantoms };
  }

  function run(h: Hallucinations, ticks: number) {
    for (let i = 1; i <= ticks; i++) h.tick(moment(i * cfg.hallucinations.tickMinutes));
  }

  it("Рассудок выше порога: ни один тик не порождает ни одного события", async () => {
    const { filter, hallucinations, phantoms } = make(cfg.hallucinations.criticalSanity + 1);
    await filter.loadCache();
    run(hallucinations, 200);
    expect(phantoms).toHaveLength(0);
    expect(hallucinations.heardVoices).toHaveLength(0);
  });

  it("ниже порога приходят оба типа событий", async () => {
    const { filter, hallucinations, phantoms } = make(cfg.hallucinations.criticalSanity - 5);
    await filter.loadCache();
    run(hallucinations, 100);
    expect(phantoms.length).toBeGreaterThan(0);
    expect(hallucinations.heardVoices.length).toBeGreaterThan(0);
  });

  it("глубже провал — заметно выше частота фантомов", async () => {
    const shallow = make(cfg.hallucinations.criticalSanity - 2, 0);
    const deep = make(1, 0);
    await shallow.filter.loadCache();
    await deep.filter.loadCache();
    run(shallow.hallucinations, 300);
    run(deep.hallucinations, 300);
    expect(deep.phantoms.length).toBeGreaterThan(shallow.phantoms.length);
  });

  it("возврат Рассудка выше порога немедленно останавливает оба потока", async () => {
    const bus = new EventBus();
    const transport = { write: () => {}, readApproved: async () => [{ id: "a0", text: "голос" }] };
    const filter = new AnomalyFilter(cfg.anomalyFilter, transport, bus);
    await filter.loadCache();
    const radioman = { sanityValue: 5 };
    const h = new Hallucinations(cfg.hallucinations, radioman, filter, createRng(21), bus);
    const phantoms: unknown[] = [];
    bus.on(EV.MIX_PHANTOM_SIGNAL, (p) => phantoms.push(p));

    for (let i = 1; i <= 50; i++) h.tick(moment(i * cfg.hallucinations.tickMinutes));
    const before = phantoms.length;
    expect(before).toBeGreaterThan(0);

    radioman.sanityValue = 100;
    for (let i = 51; i <= 200; i++) h.tick(moment(i * cfg.hallucinations.tickMinutes));
    expect(phantoms.length).toBe(before);
  });

  it("исчерпанный пул голосов не ломает тик", async () => {
    const { filter, hallucinations } = make(1, 3);
    await filter.loadCache();
    expect(() => run(hallucinations, 500)).not.toThrow();
    expect(hallucinations.heardVoices.length).toBeLessThanOrEqual(3);
    const texts = hallucinations.heardVoices.map((v) => v.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("ни один эффект не пишет факт в Журнал: Журнала у системы нет", () => {
    const { hallucinations } = make(1);
    expect(JSON.stringify(Object.keys(hallucinations))).not.toContain("journal");
  });
});

describe("Финал", () => {
  function make() {
    const bus = new EventBus();
    const journal = new Journal();
    const city = { characteristics: { population: 42 } };
    const ending = new Ending(cfg.ending, journal, city, cfg.party.minutesPerDay, bus);
    const over: unknown[] = [];
    bus.on(EV.GAME_OVER, (p) => over.push(p));
    return { bus, journal, ending, over };
  }

  it("смерть при живом городе даёт маршрут «вахта окончена» и ровно один сигнал окончания", () => {
    const { bus, ending, over } = make();
    bus.emit(EV.RADIOMAN_DIED, { cause: "заморозка" });
    expect(ending.endScreen?.route).toBe("вахта_окончена");
    expect(ending.endScreen?.text).toContain("Вахта окончена");
    expect(over).toHaveLength(1);
  });

  it("смерть при мёртвом городе даёт маршрут «последний в эфире»", () => {
    const { bus, journal, ending } = make();
    journal.write({ time: 1, eventType: CITY_DEAD, subject: "город", place: "D4", status: "мёртв" });
    ending.tick(moment(cfg.ending.tickMinutes));
    bus.emit(EV.RADIOMAN_DIED, { cause: "рассудок" });
    expect(ending.endScreen?.route).toBe("последний_в_эфире");
    expect(ending.endScreen?.cause).toBe("рассудок");
  });

  it("четыре комбинации дают четыре разных текста", () => {
    const texts = new Set<string>();
    for (const dead of [false, true]) {
      for (const cause of ["заморозка", "рассудок"] as const) {
        const { bus, journal, ending } = make();
        if (dead) {
          journal.write({ time: 1, eventType: CITY_DEAD, subject: "город", place: "D4", status: "мёртв" });
          ending.tick(moment(cfg.ending.tickMinutes));
        }
        bus.emit(EV.RADIOMAN_DIED, { cause });
        texts.add(ending.endScreen?.text ?? "");
      }
    }
    expect(texts.size).toBe(4);
  });

  it("второй «радист_умер» ничего не меняет и второго сигнала не шлёт", () => {
    const { bus, ending, over } = make();
    bus.emit(EV.RADIOMAN_DIED, { cause: "заморозка" });
    const screen = ending.endScreen;
    bus.emit(EV.RADIOMAN_DIED, { cause: "рассудок" });
    expect(ending.endScreen).toBe(screen);
    expect(over).toHaveLength(1);
  });

  it("смерть города сама по себе партию не заканчивает", () => {
    const { journal, ending, over } = make();
    journal.write({ time: 1, eventType: CITY_DEAD, subject: "город", place: "D4", status: "мёртв" });
    ending.tick(moment(cfg.ending.tickMinutes));
    expect(ending.knowsCityDead).toBe(true);
    expect(ending.endScreen).toBeNull();
    expect(over).toHaveLength(0);
  });

  it("сводка партии собирается выборкой из Журнала", () => {
    const { bus, journal, ending } = make();
    journal.write(
      { time: 10, eventType: REPORT_PROCESSED, subject: "город", place: "D4", status: "обработан" },
      [
        { category: "правда", factId: "f1" },
        { category: "ложь", factId: null },
      ],
    );
    ending.tick(moment(cfg.ending.tickMinutes));
    bus.emit(EV.RADIOMAN_DIED, { cause: "заморозка" });
    expect(ending.endScreen?.summary.reports).toBe(1);
    expect(ending.endScreen?.summary.confirmedClaims).toBe(1);
    expect(ending.endScreen?.summary.cityCharacteristics.population).toBe(42);
  });
});
