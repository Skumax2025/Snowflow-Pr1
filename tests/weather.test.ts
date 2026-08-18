/**
 * «Первый срез» заметки «Погода», один к одному.
 *
 * 1. Инициализировать сетку из одного квадранта.
 * 2. Прогнать N тиков с тестовым источником времени и фиксированным сидом.
 * 3. Проверить: в истории корректные пары (начало, конец) без пропусков и наложений.
 * 4. Запросить статус на произвольный момент из прошлого → совпадает с историей.
 * 5. Повторить прогон с тем же сидом → результат побитово идентичен.
 */

import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";
import { createRng } from "../src/core/rng.js";
import { Weather } from "../src/core/weather.js";
import type { Moment } from "../src/core/types.js";

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

/** Тестовый источник времени: равномерные шаги, без Игрового цикла. */
function run(seed: number, steps: number, cols = 1, rows = 1) {
  const weather = new Weather(cfg.weather, createRng(seed), cols, rows);
  for (let i = 1; i <= steps; i++) {
    weather.tick(moment(i * cfg.weather.tickMinutes));
  }
  return weather;
}

describe("Погода", () => {
  it("копит историю штормов корректными парами без наложений", () => {
    const weather = run(4242, 400);
    const intervals = [...weather.intervals];
    expect(intervals.length).toBeGreaterThan(0);

    for (const rec of intervals) {
      expect(rec.quadrant).toBe("A1");
      if (rec.end !== null) expect(rec.end).toBeGreaterThan(rec.start);
    }
    // Один квадрант: интервалы идут строго по возрастанию и не пересекаются.
    for (let i = 1; i < intervals.length; i++) {
      const prev = intervals[i - 1];
      const cur = intervals[i];
      expect(prev?.end).not.toBeNull();
      expect(cur?.start).toBeGreaterThanOrEqual(prev?.end as number);
    }
  });

  it("отвечает про произвольный момент в прошлом ровно тем, что в истории", () => {
    const weather = run(4242, 400);
    const rec = weather.intervals.find((r) => r.end !== null);
    expect(rec).toBeDefined();
    if (!rec || rec.end === null) return;

    expect(weather.wasStorm("A1", rec.start)).toBe(true);
    expect(weather.wasStorm("A1", rec.end - 1)).toBe(true);
    expect(weather.wasStorm("A1", rec.end)).toBe(false);
    expect(weather.wasStorm("A1", Math.max(0, rec.start - 1))).toBe(false);
  });

  it("повтор прогона с тем же сидом даёт побитово идентичный результат", () => {
    const a = run(777, 300, 6, 6);
    const b = run(777, 300, 6, 6);
    expect(JSON.stringify(a.intervals)).toBe(JSON.stringify(b.intervals));
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it("разные сиды дают разную историю", () => {
    const a = run(1, 300, 6, 6);
    const b = run(2, 300, 6, 6);
    expect(JSON.stringify(a.intervals)).not.toBe(JSON.stringify(b.intervals));
  });

  it("отдаёт базовую температуру как функцию дня и часа, не квадранта", () => {
    const weather = run(5, 1);
    const noon = weather.baseTemperature(moment(12 * 60));
    const midnight = weather.baseTemperature(moment(0));
    expect(noon).toBeGreaterThan(midnight);
    const later = weather.baseTemperature(moment(10 * 24 * 60 + 12 * 60));
    expect(later).toBeLessThan(noon);
  });

  it("не пишет в Журнал: у Погоды его вообще нет среди зависимостей", () => {
    const weather = run(5, 10);
    expect(Object.keys(weather)).not.toContain("journal");
  });
});
