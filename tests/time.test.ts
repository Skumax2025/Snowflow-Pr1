/**
 * «Первый срез» заметки «Время», один к одному.
 *
 * Счётчик минут тикает от тестовой заглушки, которая дёргает «потратить N минут»
 * без всякой другой системы. Проверяется: день увеличивается при пересечении
 * полуночи, событие «новый день» стреляет ровно один раз за переход, флаг
 * ночь/день переключается на границе заката/рассвета.
 */

import { describe, expect, it } from "vitest";
import { EventBus } from "../src/core/bus.js";
import { EV, type NewDayPayload, type SpendMinutesPayload } from "../src/core/events.js";
import { DailySchedule, GameTime, Schedule } from "../src/core/time.js";
import { loadConfig } from "../src/config/index.js";

const cfg = loadConfig();
const dayCfg = {
  minutesPerDay: cfg.party.minutesPerDay,
  dawnHour: cfg.party.dawnHour,
  duskHour: cfg.party.duskHour,
};

/** Тестовая заглушка: единственный источник «потратить N минут». */
function makeStub() {
  const bus = new EventBus();
  const time = new GameTime(dayCfg, bus);
  const days: number[] = [];
  bus.on<NewDayPayload>(EV.NEW_DAY, (p) => days.push(p.day));
  bus.on<SpendMinutesPayload>(EV.SPEND_MINUTES, (p) => time.advance(p.minutes));
  const spend = (minutes: number) =>
    bus.emit<SpendMinutesPayload>(EV.SPEND_MINUTES, { minutes, source: "заглушка" });
  return { bus, time, days, spend };
}

describe("Время", () => {
  it("хранит счётчик минут и выводит день, час, минуту", () => {
    const { time, spend } = makeStub();
    expect(time.moment).toMatchObject({ totalMinutes: 0, day: 1, hour: 0, minute: 0 });
    spend(90);
    expect(time.moment).toMatchObject({ totalMinutes: 90, day: 1, hour: 1, minute: 30 });
  });

  it("увеличивает номер дня при пересечении полуночи", () => {
    const { time, spend } = makeStub();
    spend(23 * 60 + 59);
    expect(time.moment.day).toBe(1);
    spend(1);
    expect(time.moment.day).toBe(2);
  });

  it("испускает «начался новый день» ровно один раз за переход", () => {
    const { days, spend } = makeStub();
    spend(23 * 60);
    expect(days).toEqual([]);
    spend(60);
    expect(days).toEqual([2]);
    spend(30);
    expect(days).toEqual([2]);
    spend(24 * 60);
    expect(days).toEqual([2, 3]);
  });

  it("испускает событие на каждый переход, если приращение длиннее суток", () => {
    const { days, spend } = makeStub();
    spend(3 * 24 * 60);
    expect(days).toEqual([2, 3, 4]);
  });

  it("переключает флаг ночь/день на границе заката и рассвета", () => {
    const { time, spend } = makeStub();
    expect(time.moment.isNight).toBe(true); // 00:00
    spend(cfg.party.dawnHour * 60);
    expect(time.moment.isNight).toBe(false); // рассвет
    spend((cfg.party.duskHour - cfg.party.dawnHour) * 60 - 1);
    expect(time.moment.isNight).toBe(false);
    spend(1);
    expect(time.moment.isNight).toBe(true); // закат
  });

  it("не хранит таймер поражения — партия не заканчивается по счётчику", () => {
    const { time, spend } = makeStub();
    spend(100 * 24 * 60);
    expect(time.moment.day).toBe(101);
  });

  it("считает ближайшее наступление часа", () => {
    const { time, spend } = makeStub();
    spend(9 * 60);
    expect(time.nextOccurrenceOfHour(12)).toBe(12 * 60);
    expect(time.nextOccurrenceOfHour(8)).toBe(24 * 60 + 8 * 60);
  });
});

describe("Расписание", () => {
  it("срабатывает ровно столько раз, сколько интервалов прошло", () => {
    const s = new Schedule(30, 0);
    expect(s.due(0)).toBe(1);
    expect(s.due(29)).toBe(0);
    expect(s.due(30)).toBe(1);
    expect(s.due(150)).toBe(4);
  });

  it("суточный якорь срабатывает раз в сутки в свой час", () => {
    const s = new DailySchedule(7);
    expect(s.due({ totalMinutes: 0, day: 1, hour: 6, minute: 0, isNight: true })).toBe(false);
    expect(s.due({ totalMinutes: 0, day: 1, hour: 7, minute: 0, isNight: false })).toBe(true);
    expect(s.due({ totalMinutes: 0, day: 1, hour: 9, minute: 0, isNight: false })).toBe(false);
    expect(s.due({ totalMinutes: 0, day: 2, hour: 8, minute: 0, isNight: false })).toBe(true);
  });
});
