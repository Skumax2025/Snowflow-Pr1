/**
 * «Первые срезы» Вышки: Генератор, Радист, Сон, Приём пищи, Мостик.
 * Каждый — один к одному из своей заметки, на заглушках.
 */

import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/index.js";
import { Bridge } from "../src/core/bridge.js";
import { EventBus } from "../src/core/bus.js";
import {
  EV,
  type ColdPayload,
  type FuelPayload,
  type RadiomanDiedPayload,
  type RationsPayload,
  type ReduceHungerPayload,
  type SanityPayload,
  type SpendMinutesPayload,
} from "../src/core/events.js";
import { Generator } from "../src/core/generator.js";
import { Journal, CITY_DEAD } from "../src/core/journal.js";
import { Meal } from "../src/core/meal.js";
import { Radioman } from "../src/core/radioman.js";
import { Sleep } from "../src/core/sleep.js";
import { GameTime } from "../src/core/time.js";
import type { Moment } from "../src/core/types.js";
import { Weather } from "../src/core/weather.js";
import { createRng } from "../src/core/rng.js";

const cfg = loadConfig();
const dayCfg = {
  minutesPerDay: cfg.party.minutesPerDay,
  dawnHour: cfg.party.dawnHour,
  duskHour: cfg.party.duskHour,
};

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

/** Заглушка Погоды: фиксированная базовая температура, переключаемый шторм. */
class WeatherStub {
  storm = false;
  constructor(private readonly temp = -20) {}
  isStorm(): boolean {
    return this.storm;
  }
  baseTemperature(): number {
    return this.temp;
  }
  get stormPenalty(): number {
    return cfg.weather.stormTemperaturePenalty;
  }
}

describe("Генератор", () => {
  function make(startingFuel = 100) {
    const bus = new EventBus();
    const time = new GameTime(dayCfg, bus);
    const weather = new WeatherStub();
    const generator = new Generator(
      cfg.generator,
      time,
      weather as unknown as Weather,
      cfg.party.towerQuadrant,
      bus,
      startingFuel,
    );
    return { bus, time, weather, generator };
  }

  it("«пополнение топлива N» увеличивает остаток ровно на N", () => {
    const { bus, generator } = make(100);
    bus.emit<FuelPayload>(EV.FUEL_REFILL, { amount: 50, source: "мостик" });
    expect(generator.fuelLeft).toBeCloseTo(150, 6);
  });

  it("топливо убывает по формуле за прошедшие минуты", () => {
    const { time, generator } = make(100);
    generator.setHeating(4);
    const before = generator.fuelLeft;
    time.advance(60);
    const after = generator.fuelLeft;
    const deficit = cfg.generator.comfortTemperature - -20;
    const expected =
      (cfg.generator.fuelPerHeatingPerMinute * 4 + cfg.generator.fuelPerDeficitPerMinute * deficit) * 60;
    expect(before - after).toBeCloseTo(expected, 6);
  });

  it("«потратить N топлива» списывается мгновенно, независимо от непрерывного расхода", () => {
    const { bus, generator } = make(100);
    bus.emit<FuelPayload>(EV.SPEND_FUEL, { amount: 6, source: "проверка_сигнала" });
    expect(generator.fuelLeft).toBeCloseTo(94, 6);
  });

  it("«баланс тепла» предсказуемо меняет знак и величину с уровнем Обогрева", () => {
    const { generator } = make(100);
    generator.setHeating(0);
    const cold = generator.heatBalance();
    generator.setHeating(cfg.generator.heatingMax);
    const hot = generator.heatBalance();
    expect(cold).toBeLessThan(0);
    expect(hot).toBeGreaterThan(0);
    expect(hot).toBeGreaterThan(cold);
  });

  it("шторм над квадрантом вышки роняет эффективную температуру и баланс тепла", () => {
    const { generator, weather } = make(100);
    generator.setHeating(4);
    const calm = generator.heatBalance();
    weather.storm = true;
    expect(generator.heatBalance()).toBeLessThan(calm);
    expect(generator.effectiveTemperature()).toBeCloseTo(-20 - cfg.weather.stormTemperaturePenalty, 6);
  });

  it("на нуле топлива расход не уходит в минус, баланс тепла полностью отрицательный", () => {
    const { time, generator } = make(1);
    generator.setHeating(10);
    time.advance(10000);
    expect(generator.fuelLeft).toBe(0);
    expect(generator.heatBalance()).toBeLessThan(0);
  });
});

describe("Радист", () => {
  function make(heatBalance = 0) {
    const bus = new EventBus();
    const heat = { heatBalance: () => heatBalance };
    const radioman = new Radioman(cfg.radioman, heat, bus);
    const deaths: RadiomanDiedPayload[] = [];
    bus.on<RadiomanDiedPayload>(EV.RADIOMAN_DIED, (p) => deaths.push(p));
    return { bus, radioman, deaths };
  }

  function run(radioman: Radioman, minutes: number, step = cfg.radioman.tickMinutes) {
    for (let t = step; t <= minutes; t += step) radioman.tick(moment(t));
  }

  it("без событий Усталость и Голод растут монотонно, Тепло меняется линейно по балансу", () => {
    const { radioman } = make(0.02);
    const before = radioman.state;
    run(radioman, 600);
    const after = radioman.state;
    expect(after.fatigue).toBeGreaterThan(before.fatigue);
    expect(after.hunger).toBeGreaterThan(before.hunger);
    expect(after.warmth).toBeCloseTo(before.warmth + 0.02 * 600, 4);
  });

  it("«сон_завершён» роняет Усталость и немного поднимает Рассудок", () => {
    const { bus, radioman } = make(0);
    run(radioman, 600);
    const before = radioman.state;
    bus.emit(EV.SLEEP_FINISHED, { minutes: 480 });
    const after = radioman.state;
    expect(after.fatigue).toBeLessThan(before.fatigue);
    expect(after.sanity).toBeGreaterThan(before.sanity);
  });

  it("«нанести холод на N» переживает следующий тик", () => {
    const { bus, radioman } = make(0);
    run(radioman, 60);
    const before = radioman.state.warmth;
    bus.emit<ColdPayload>(EV.APPLY_COLD, { amount: 10 });
    expect(radioman.state.warmth).toBeCloseTo(before - 10, 6);
    run(radioman, 120);
    expect(radioman.state.warmth).toBeCloseTo(before - 10, 6);
  });

  it("«восстановить рассудок на X» не трогает остальные стоки", () => {
    const { bus, radioman } = make(0);
    run(radioman, 300);
    const before = radioman.state;
    bus.emit<SanityPayload>(EV.RESTORE_SANITY, { amount: 5 });
    const after = radioman.state;
    expect(after.sanity).toBeCloseTo(before.sanity + 5, 6);
    expect(after.fatigue).toBe(before.fatigue);
    expect(after.hunger).toBe(before.hunger);
    expect(after.warmth).toBe(before.warmth);
  });

  it("«снизить голод на X» снимает Голод", () => {
    const { bus, radioman } = make(0);
    run(radioman, 600);
    const before = radioman.state.hunger;
    bus.emit<ReduceHungerPayload>(EV.REDUCE_HUNGER, { amount: 35 });
    expect(radioman.state.hunger).toBeCloseTo(before - 35, 6);
  });

  it("отрицательный баланс тепла поднимает флаг «спать нельзя»", () => {
    const { radioman } = make(-0.05);
    expect(radioman.cannotSleep).toBe(false);
    run(radioman, 2000);
    expect(radioman.state.warmth).toBeLessThan(cfg.radioman.thresholds.cannotSleep);
    expect(radioman.cannotSleep).toBe(true);
  });

  it("Тепло ниже порога заморозки нужную длительность подряд убивает «заморозкой»", () => {
    const { radioman, deaths } = make(-0.2);
    run(radioman, 5000);
    expect(deaths).toHaveLength(1);
    expect(deaths[0]?.cause).toBe("заморозка");
  });

  it("высокие Усталость и Голод без критического холода убивают «рассудком»", () => {
    const { radioman, deaths } = make(0.05);
    run(radioman, 60 * 24 * 30);
    expect(deaths).toHaveLength(1);
    expect(deaths[0]?.cause).toBe("рассудок");
    expect(radioman.state.warmth).toBeGreaterThanOrEqual(cfg.radioman.thresholds.freezing);
  });

  it("«радист_умер» уходит ровно один раз, дальше Радист не тикает", () => {
    const { radioman, deaths } = make(-0.2);
    run(radioman, 20000);
    expect(deaths).toHaveLength(1);
    expect(radioman.isDead).toBe(true);
  });

  it("счётчик критического холода обнуляется, если Тепло поднялось хоть на миг", () => {
    const bus = new EventBus();
    let balance = -0.2;
    const radioman = new Radioman(cfg.radioman, { heatBalance: () => balance }, bus);
    const deaths: RadiomanDiedPayload[] = [];
    bus.on<RadiomanDiedPayload>(EV.RADIOMAN_DIED, (p) => deaths.push(p));

    for (let t = 5; t <= 2000; t += 5) {
      radioman.tick(moment(t));
      if (radioman.state.warmth < cfg.radioman.thresholds.freezing) {
        balance = 1; // резко отогрелись
      } else if (radioman.state.warmth > cfg.radioman.thresholds.freezing + 5) {
        balance = -0.2;
      }
    }
    expect(deaths).toHaveLength(0);
  });
});

describe("Сон", () => {
  function make(cannotSleep = false) {
    const bus = new EventBus();
    const time = new GameTime(dayCfg, bus);
    const sleep = new Sleep(cfg.sleep, time, { cannotSleep }, bus);
    const rewinds: unknown[] = [];
    const finished: unknown[] = [];
    bus.on(EV.REWIND_TO_HOUR, (p) => rewinds.push(p));
    bus.on(EV.SLEEP_FINISHED, (p) => finished.push(p));
    return { bus, time, sleep, rewinds, finished };
  }

  it("шлёт корректную перемотку и «сон_завершён» с фактической длительностью", () => {
    const { time, sleep, rewinds, finished } = make();
    time.advance(22 * 60); // 22:00
    const duration = sleep.sleepUntil(6);
    expect(duration).toBe(8 * 60);
    expect(rewinds).toEqual([{ targetMinute: 30 * 60 }]);
    expect(finished).toEqual([{ minutes: 8 * 60 }]);
  });

  it("отказывает при выборе часа дальше 12 часов вперёд, событий не шлёт", () => {
    const { time, sleep, rewinds, finished } = make();
    time.advance(8 * 60); // 08:00
    expect(sleep.refusalFor(21)).toBe("слишком_далеко");
    expect(sleep.sleepUntil(21)).toBe(0);
    expect(rewinds).toEqual([]);
    expect(finished).toEqual([]);
  });

  it("при флаге «спать нельзя» отказывает целиком", () => {
    const { sleep, rewinds, finished } = make(true);
    expect(sleep.refusalFor(6)).toBe("холодно");
    expect(sleep.sleepUntil(6)).toBe(0);
    expect(rewinds).toEqual([]);
    expect(finished).toEqual([]);
  });

  it("не хранит состояния между вызовами", () => {
    const { time, sleep } = make();
    time.advance(20 * 60);
    // Заглушка без Игрового цикла: перемотку никто не исполняет, значит один
    // и тот же вызов обязан дать один и тот же результат — состояния нет.
    expect(sleep.sleepUntil(2)).toBe(6 * 60);
    expect(sleep.sleepUntil(2)).toBe(6 * 60);
  });
});

describe("Приём пищи", () => {
  function make(portions = 3) {
    const bus = new EventBus();
    const meal = new Meal(cfg.meal, bus, portions);
    const minutes: SpendMinutesPayload[] = [];
    const hunger: ReduceHungerPayload[] = [];
    bus.on<SpendMinutesPayload>(EV.SPEND_MINUTES, (p) => minutes.push(p));
    bus.on<ReduceHungerPayload>(EV.REDUCE_HUNGER, (p) => hunger.push(p));
    return { bus, meal, minutes, hunger };
  }

  it("три порции — три успешных приёма, по одному событию каждого типа", () => {
    const { meal, minutes, hunger } = make(3);
    expect(meal.eat()).toBe(true);
    expect(meal.eat()).toBe(true);
    expect(meal.eat()).toBe(true);
    expect(meal.count).toBe(0);
    expect(minutes).toHaveLength(3);
    expect(hunger).toHaveLength(3);
    expect(hunger[0]?.amount).toBe(cfg.meal.hungerReduction);
  });

  it("на нуле порций действие недоступно и событий не шлёт", () => {
    const { meal, minutes, hunger } = make(0);
    expect(meal.available).toBe(false);
    expect(meal.eat()).toBe(false);
    expect(minutes).toHaveLength(0);
    expect(hunger).toHaveLength(0);
  });

  it("«добавить K порций» пополняет запас", () => {
    const { bus, meal } = make(0);
    bus.emit<RationsPayload>(EV.ADD_RATIONS, { portions: 4 });
    expect(meal.count).toBe(4);
    expect(meal.available).toBe(true);
  });
});

describe("Мостик", () => {
  function make(destruction = 10, volume = 200) {
    const bus = new EventBus();
    const journal = new Journal();
    const weather = new Weather(cfg.weather, createRng(1), cfg.party.gridCols, cfg.party.gridRows);
    const city = { destruction: () => destruction, supplyVolume: () => volume };
    const bridge = new Bridge(
      cfg.bridge,
      city,
      weather,
      journal,
      cfg.party.cityQuadrant,
      cfg.party.towerQuadrant,
      bus,
    );
    const minutes: SpendMinutesPayload[] = [];
    const sanity: SanityPayload[] = [];
    const cold: ColdPayload[] = [];
    const fuel: FuelPayload[] = [];
    const rations: RationsPayload[] = [];
    bus.on<SpendMinutesPayload>(EV.SPEND_MINUTES, (p) => minutes.push(p));
    bus.on<SanityPayload>(EV.RESTORE_SANITY, (p) => sanity.push(p));
    bus.on<ColdPayload>(EV.APPLY_COLD, (p) => cold.push(p));
    bus.on<FuelPayload>(EV.FUEL_REFILL, (p) => fuel.push(p));
    bus.on<RationsPayload>(EV.ADD_RATIONS, (p) => rations.push(p));
    return { bus, journal, bridge, minutes, sanity, cold, fuel, rations };
  }

  it("«Смотреть» отдаёт тир и сцену неба, наружу ничего не уходит", () => {
    const { bridge, minutes, sanity, cold } = make(10);
    const sight = bridge.look(moment(9 * 60));
    expect(sight.city).toBe(cfg.bridge.destructionTiers[0]?.label);
    expect(sight.sky.hour).toBe(9);
    expect(minutes).toHaveLength(0);
    expect(sanity).toHaveLength(0);
    expect(cold).toHaveLength(0);
  });

  it("тир ухудшается с ростом Разрушения", () => {
    expect(make(10).bridge.look(moment(0)).city).toBe(cfg.bridge.destructionTiers[0]?.label);
    expect(make(95).bridge.look(moment(0)).city).toBe(
      cfg.bridge.destructionTiers[cfg.bridge.destructionTiers.length - 1]?.label,
    );
  });

  it("«Остаться» в пределах безопасного времени шлёт одинаковый базовый холод", () => {
    const { bridge, minutes, sanity, cold } = make();
    bridge.stay();
    bridge.stay();
    bridge.stay();
    expect(minutes).toHaveLength(3);
    expect(sanity).toHaveLength(3);
    expect(cold.map((c) => c.amount)).toEqual([
      cfg.bridge.baseCold,
      cfg.bridge.baseCold,
      cfg.bridge.baseCold,
    ]);
  });

  it("сверх безопасного времени холод растёт, Рассудок восстанавливается на ту же величину", () => {
    const { bridge, sanity, cold } = make();
    for (let i = 0; i < 6; i++) bridge.stay();
    const last = cold[cold.length - 1]?.amount as number;
    expect(last).toBeGreaterThan(cfg.bridge.baseCold);
    expect(new Set(sanity.map((s) => s.amount)).size).toBe(1);
  });

  it("уход с экрана обнуляет счётчик", () => {
    const { bridge } = make();
    bridge.stay();
    bridge.stay();
    expect(bridge.streakMinutes).toBeGreaterThan(0);
    bridge.leave();
    expect(bridge.streakMinutes).toBe(0);
  });

  it("такт поставки делит объём на топливо и порции по пропорции", () => {
    const { bridge, fuel, rations } = make(10, 200);
    bridge.tick(moment(cfg.bridge.supplyHour * 60));
    expect(fuel).toHaveLength(1);
    expect(fuel[0]?.amount).toBeCloseTo(200 * cfg.bridge.fuelShare, 6);
    expect(rations[0]?.portions).toBe(
      Math.floor((200 - 200 * cfg.bridge.fuelShare) / cfg.bridge.rationVolume),
    );
    expect(bridge.lastDelivery?.volume).toBe(200);
  });

  it("по факту «город мёртв» включается надгробие и поставки прекращаются", () => {
    const { bridge, journal, fuel } = make();
    journal.write({ time: 0, eventType: CITY_DEAD, subject: "город", place: "D4", status: "мёртв" });
    bridge.tick(moment(cfg.bridge.supplyHour * 60));
    expect(bridge.isTombstone).toBe(true);
    expect(bridge.look(moment(0)).city).toBe("мёртвый город");
    expect(fuel).toHaveLength(0);
  });

  it("«Остаться» не блокируется — Мостик о Тепле вообще не спрашивает", () => {
    const { bridge } = make();
    const spy = vi.fn();
    expect(() => {
      for (let i = 0; i < 50; i++) bridge.stay();
      spy();
    }).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });
});
