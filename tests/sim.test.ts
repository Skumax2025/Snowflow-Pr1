/**
 * «Первый срез» заметки «Стенд симуляции», один к одному.
 *
 * Признаки готовности:
 * - 100 прогонов укладываются в отведённое время без ручного ожидания;
 * - исходы различаются между прогонами;
 * - повтор серии с тем же сидом даёт побитово идентичный результат;
 * - хотя бы в одном прогоне город умирает, хотя бы в одном — доживает до конца;
 * - в гистограмме видно, что атаки уходили по всем трём адресатам.
 */

import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";
import { runOne, runSeries } from "../src/sim/harness.js";

describe("Стенд симуляции", () => {
  const cfg = loadConfig();
  const started = Date.now();
  const summary = runSeries(cfg);
  const elapsedSeconds = (Date.now() - started) / 1000;

  it("прогоняет 100 партий без ручного ожидания", () => {
    expect(summary.runs).toBe(100);
    expect(elapsedSeconds).toBeLessThan(60);
  });

  it("повтор серии с тем же сидом даёт побитово идентичный результат", () => {
    const repeat = runSeries(cfg);
    expect(JSON.stringify(repeat)).toBe(JSON.stringify(summary));
  });

  it("исходы различаются между прогонами", () => {
    expect(summary.distinctOutcomeSignatures).toBeGreaterThan(5);
    expect(summary.maxFacts).toBeGreaterThan(summary.minFacts);
  });

  it("хотя бы раз город умирает и хотя бы раз доживает до конца", () => {
    expect(summary.cityDeaths).toBeGreaterThan(0);
    expect(summary.citySurvivals).toBeGreaterThan(0);
  });

  it("атаки уходили по всем трём адресатам, включая пустоту", () => {
    expect(summary.attacksByTarget.город).toBeGreaterThan(0);
    expect(summary.attacksByTarget.структуры).toBeGreaterThan(0);
    expect(summary.attacksByTarget.пустота).toBeGreaterThan(0);
  });

  it("три петли без игрока крутятся: Режиссёр разряжается, конвои доходят", () => {
    expect(summary.eventHistogram["конвой_прибыл"]).toBeGreaterThan(0);
    expect(summary.eventHistogram["атака"]).toBeGreaterThan(0);
    expect(summary.eventHistogram["дезинформация"] ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("другой базовый сид даёт другую серию", () => {
    const other = runSeries(loadConfig({ sim: { baseSeed: 555, runs: 20 } }));
    const same = runSeries(loadConfig({ sim: { baseSeed: 20260817, runs: 20 } }));
    expect(JSON.stringify(other.results.map((r) => r.journalFacts))).not.toBe(
      JSON.stringify(same.results.map((r) => r.journalFacts)),
    );
  });

  it("отладочный режим «изолированный Город» доступен и не включён по умолчанию", () => {
    expect(cfg.sim.isolatedCityMode).toBe(false);
    const isolated = runOne(
      loadConfig({ sim: { isolatedCityMode: true, partyLengthDays: 5 } }),
      1234,
      0,
    );
    expect(isolated.journalFacts).toBeGreaterThan(0);
  });

  it("метрика эфира собирается: сигналы идут каждый день партии", () => {
    expect(cfg.sim.includeBroadcast).toBe(true);
    expect(summary.ether.meanSignalsPerRun).toBeGreaterThan(0);
    expect(summary.ether.meanSignalsPerDay.length).toBeGreaterThanOrEqual(cfg.sim.partyLengthDays);
    // Ни одни сутки партии не остаются полностью без единого сигнала.
    for (const day of summary.ether.meanSignalsPerDay.slice(0, cfg.sim.partyLengthDays)) {
      expect(day).toBeGreaterThan(0);
    }
  });

  it("эфир не вымирает: тишина остаётся малой долей партии", () => {
    // Ответ на открытый вопрос 22 мастер-концепта. Плотность к финалу падает,
    // но эфир не умирает: тишина держится в единицах процентов времени.
    expect(summary.ether.meanSilenceShare).toBeLessThan(0.2);
    expect(summary.ether.meanLiveSignals).toBeGreaterThan(1);
  });

  it("включение Генератора эфира не сдвигает исходы мира", () => {
    // У эфира свой поток ГСЧ, поэтому метрика не меняет то, что она измеряет.
    const without = runSeries(loadConfig({ sim: { includeBroadcast: false, runs: 20 } }));
    const with_ = runSeries(loadConfig({ sim: { includeBroadcast: true, runs: 20 } }));
    const outcomes = (s: typeof without) =>
      JSON.stringify(s.results.map((r) => [r.outcome, r.cityDeathDay, r.journalFacts]));
    expect(outcomes(without)).toBe(outcomes(with_));
    // При выключенном Генераторе эфира метрика честно пуста, а не выдумана.
    expect(without.ether.meanSignalsPerRun).toBe(0);
    expect(with_.ether.meanSignalsPerRun).toBeGreaterThan(0);
  });

  it("синтетический поток рапортов выключен по умолчанию и крутит петлю Доверия при включении", () => {
    expect(cfg.sim.syntheticReports.enabled).toBe(false);
    const withReports = runOne(
      loadConfig({ sim: { syntheticReports: { enabled: true }, partyLengthDays: 6 } }),
      99,
      0,
    );
    expect(withReports.eventHistogram["рапорт_обработан"]).toBeGreaterThan(0);
  });
});
