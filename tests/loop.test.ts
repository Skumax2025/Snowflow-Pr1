/**
 * «Первый срез» заметки «Игровой цикл», один к одному.
 *
 * Заглушки вместо всех систем — каждая просто пишет в лог «меня тикнули
 * в момент T».
 */

import { describe, expect, it } from "vitest";
import { EventBus } from "../src/core/bus.js";
import { EV, type RewindPayload, type SpendMinutesPayload } from "../src/core/events.js";
import { GameLoop } from "../src/core/loop.js";
import { GameTime, Schedule } from "../src/core/time.js";
import { loadConfig } from "../src/config/index.js";
import type { Moment, Tickable } from "../src/core/types.js";

const cfg = loadConfig();

/** Заглушка системы: тикает по собственному интервалу, пишет момент в лог. */
class StubSystem implements Tickable {
  readonly log: number[] = [];
  private schedule: Schedule;

  constructor(
    readonly systemId: string,
    intervalMinutes: number,
  ) {
    this.schedule = new Schedule(intervalMinutes, intervalMinutes);
  }

  tick(now: Moment): void {
    const times = this.schedule.due(now.totalMinutes);
    for (let i = 0; i < times; i++) this.log.push(now.totalMinutes);
  }
}

function makeWorld(overrides?: { step?: number }) {
  const bus = new EventBus();
  const time = new GameTime(
    {
      minutesPerDay: cfg.party.minutesPerDay,
      dawnHour: cfg.party.dawnHour,
      duskHour: cfg.party.duskHour,
    },
    bus,
  );
  const loop = new GameLoop(time, bus, overrides?.step ?? cfg.party.loopStepMinutes);
  const weather = new StubSystem("погода", 30);
  const city = new StubSystem("город", 60);
  const radioman = new StubSystem("радист", 5);
  loop.register(weather);
  loop.register(city);
  loop.register(radioman);
  return { bus, time, loop, weather, city, radioman };
}

describe("Игровой цикл", () => {
  it("инициализирует системы по одному разу и держит фиксированный порядок", () => {
    const { loop } = makeWorld();
    expect(loop.order).toEqual(["погода", "город", "радист"]);
  });

  it("прогоняет 100 шагов лупа, не пропуская и не дублируя системы", () => {
    const { loop, weather, city, radioman } = makeWorld();
    loop.advance(100 * cfg.party.loopStepMinutes); // 500 минут
    expect(loop.steps).toBe(100);
    expect(weather.log.length).toBe(Math.floor(500 / 30));
    expect(city.log.length).toBe(Math.floor(500 / 60));
    expect(radioman.log.length).toBe(Math.floor(500 / 5));
  });

  it("перемотка сном даёт столько же тиков, сколько обычный ход времени", () => {
    const direct = makeWorld();
    direct.loop.advance(8 * 60);

    const slept = makeWorld();
    slept.bus.emit<RewindPayload>(EV.REWIND_TO_HOUR, { targetMinute: 8 * 60 });

    expect(slept.loop.steps).toBe(direct.loop.steps);
    expect(slept.weather.log).toEqual(direct.weather.log);
    expect(slept.city.log).toEqual(direct.city.log);
    expect(slept.radioman.log).toEqual(direct.radioman.log);
    // 8 часов, делённые на собственный интервал каждой системы.
    expect(slept.weather.log.length).toBe(16);
    expect(slept.city.log.length).toBe(8);
    expect(slept.radioman.log.length).toBe(96);
  });

  it("«потратить N минут» от действия игрока проходит через чанкер лупа", () => {
    const { bus, loop, radioman } = makeWorld();
    bus.emit<SpendMinutesPayload>(EV.SPEND_MINUTES, { minutes: 40, source: "терминал" });
    expect(loop.steps).toBe(8);
    expect(radioman.log.length).toBe(8);
  });

  it("повтор прогона даёт побитово ту же последовательность вызовов", () => {
    const a = makeWorld();
    const b = makeWorld();
    a.loop.advance(1000);
    b.loop.advance(1000);
    expect(a.weather.log).toEqual(b.weather.log);
    expect(a.city.log).toEqual(b.city.log);
    expect(a.radioman.log).toEqual(b.radioman.log);
  });

  it("останавливается по сигналу окончания партии", () => {
    const { bus, loop } = makeWorld();
    loop.advance(60);
    const before = loop.steps;
    bus.emit(EV.GAME_OVER, {});
    loop.advance(600);
    expect(loop.steps).toBe(before);
    expect(loop.isRunning).toBe(false);
  });
});
