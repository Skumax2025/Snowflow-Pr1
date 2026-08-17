/**
 * Стенд симуляции — headless-обвязка поверх того же Игрового цикла.
 *
 * Отличий от обычной игры ровно два: игрока нет, поэтому Стенд сам двигает
 * часы штатным «потратить N минут», и прогон повторяется N раз. Ни логика
 * тика, ни инициализация здесь не дублируются.
 *
 * Вышка и служебные системы не поднимаются: Стенд про них не знает.
 */

import type { SnowflowConfig } from "../config/types.js";
import { EV, type AttackPayload, type ReportVerdictPayload, type SpendMinutesPayload } from "../core/events.js";
import { createRng, seedCorpus } from "../core/rng.js";
import { createWorld } from "../core/world.js";

export interface RunResult {
  runId: number;
  seed: number;
  outcome: "город_жив" | "город_мёртв";
  cityDeathDay: number | null;
  cityCharacteristics: Record<string, number>;
  journalFacts: number;
  eventHistogram: Record<string, number>;
  attacksByTarget: { город: number; структуры: number; пустота: number };
  finalTension: number;
  daysSimulated: number;
}

export interface SeriesSummary {
  seedBase: number;
  runs: number;
  cityDeaths: number;
  citySurvivals: number;
  deathDays: number[];
  meanFacts: number;
  minFacts: number;
  maxFacts: number;
  attacksByTarget: { город: number; структуры: number; пустота: number };
  eventHistogram: Record<string, number>;
  distinctOutcomeSignatures: number;
  results: RunResult[];
}

export function runOne(cfg: SnowflowConfig, seed: number, runId: number): RunResult {
  const world = createWorld(cfg, seed);
  const attacks = { город: 0, структуры: 0, пустота: 0 };

  world.bus.on<AttackPayload>(EV.ATTACK, (p) => {
    if (p.target === "город") attacks.город += 1;
    else attacks.структуры += 1;
  });

  // Отладочный режим «изолированный Город»: синтетические атаки вместо
  // настоящих Фракций. По умолчанию выключен — два независимых источника
  // ударов разъезжались бы по балансу.
  const syntheticRng = createRng(seed ^ 0x5f5f);
  let nextSyntheticAttack = cfg.sim.syntheticAttacks.tickMinutes;
  let nextSyntheticReport = cfg.sim.syntheticReports.everyMinutes;

  const totalMinutes = cfg.sim.partyLengthDays * cfg.party.minutesPerDay;
  const step = cfg.sim.timeStepMinutes;
  let cityDeathMinute: number | null = null;

  while (world.time.totalMinutes < totalMinutes) {
    // Стенд двигает часы тем же событием, которым в игре их двигают действия.
    world.bus.emit<SpendMinutesPayload>(EV.SPEND_MINUTES, { minutes: step, source: "стенд" });

    if (cfg.sim.isolatedCityMode && world.time.totalMinutes >= nextSyntheticAttack) {
      nextSyntheticAttack += cfg.sim.syntheticAttacks.tickMinutes;
      if (syntheticRng.chance(cfg.sim.syntheticAttacks.chancePerTick)) {
        world.bus.emit<AttackPayload>(EV.ATTACK, {
          power: syntheticRng.int(
            cfg.sim.syntheticAttacks.powerRange[0],
            cfg.sim.syntheticAttacks.powerRange[1],
          ),
          quadrant: cfg.party.cityQuadrant,
          target: "город",
          origin: "стенд:синтетическая_атака",
        });
      }
    }

    // Синтетический поток рапортов: без него петля Доверие→Снабжение
    // в серии не крутится вообще. По умолчанию выключен.
    if (cfg.sim.syntheticReports.enabled && world.time.totalMinutes >= nextSyntheticReport) {
      nextSyntheticReport += cfg.sim.syntheticReports.everyMinutes;
      const recent = world.journal.query({
        fromTime: Math.max(0, world.time.totalMinutes - cfg.sim.syntheticReports.everyMinutes),
      });
      const truthful = syntheticRng.chance(cfg.sim.syntheticReports.truthShare);
      const fact = recent.length > 0 ? syntheticRng.pick(recent) : null;
      world.bus.emit<ReportVerdictPayload>(EV.REPORT_VERDICT, {
        verdicts: [
          truthful && fact
            ? { claimId: "sim", category: "правда", factId: fact.id }
            : { claimId: "sim", category: "ложь", factId: null },
        ],
        tone: { inspiration: 0.5, anxiety: 0.3, specificity: 0.5 },
      });
    }

    if (cityDeathMinute === null && world.journal.hasCityDead()) {
      cityDeathMinute = world.time.totalMinutes;
      break; // прогон останавливается досрочно, день смерти зафиксирован
    }
  }

  const histogram: Record<string, number> = {};
  for (const record of world.journal.all) {
    histogram[record.eventType] = (histogram[record.eventType] ?? 0) + 1;
  }
  attacks.пустота = histogram["атака_в_пустоту"] ?? 0;

  return {
    runId,
    seed,
    outcome: cityDeathMinute === null ? "город_жив" : "город_мёртв",
    cityDeathDay:
      cityDeathMinute === null ? null : Math.floor(cityDeathMinute / cfg.party.minutesPerDay) + 1,
    cityCharacteristics: world.city.characteristics,
    journalFacts: world.journal.size,
    eventHistogram: histogram,
    attacksByTarget: attacks,
    finalTension: world.director.value,
    daysSimulated: Math.floor(world.time.totalMinutes / cfg.party.minutesPerDay) + 1,
  };
}

export function runSeries(cfg: SnowflowConfig): SeriesSummary {
  // Корпус сидов детерминированно порождается из базового: случайные сиды
  // не используются, набор воспроизводим между запусками.
  const seeds = seedCorpus(cfg.sim.baseSeed, cfg.sim.runs);
  const results = seeds.map((seed, index) => runOne(cfg, seed, index));

  const summary: SeriesSummary = {
    seedBase: cfg.sim.baseSeed,
    runs: results.length,
    cityDeaths: results.filter((r) => r.outcome === "город_мёртв").length,
    citySurvivals: results.filter((r) => r.outcome === "город_жив").length,
    deathDays: results.filter((r) => r.cityDeathDay !== null).map((r) => r.cityDeathDay as number),
    meanFacts: results.reduce((sum, r) => sum + r.journalFacts, 0) / Math.max(1, results.length),
    minFacts: Math.min(...results.map((r) => r.journalFacts)),
    maxFacts: Math.max(...results.map((r) => r.journalFacts)),
    attacksByTarget: results.reduce(
      (acc, r) => ({
        город: acc.город + r.attacksByTarget.город,
        структуры: acc.структуры + r.attacksByTarget.структуры,
        пустота: acc.пустота + r.attacksByTarget.пустота,
      }),
      { город: 0, структуры: 0, пустота: 0 },
    ),
    eventHistogram: results.reduce<Record<string, number>>((acc, r) => {
      for (const [type, count] of Object.entries(r.eventHistogram)) {
        acc[type] = (acc[type] ?? 0) + count;
      }
      return acc;
    }, {}),
    distinctOutcomeSignatures: new Set(
      results.map((r) => `${r.outcome}:${r.cityDeathDay}:${Math.round(r.cityCharacteristics.population ?? 0)}`),
    ).size,
    results,
  };

  return summary;
}

export function formatSummary(summary: SeriesSummary): string {
  const lines: string[] = [];
  lines.push(`Стенд симуляции — серия из ${summary.runs} прогонов, базовый сид ${summary.seedBase}`);
  lines.push("");
  lines.push(`город умер:   ${summary.cityDeaths}`);
  lines.push(`город выжил:  ${summary.citySurvivals}`);
  if (summary.deathDays.length > 0) {
    const sorted = [...summary.deathDays].sort((a, b) => a - b);
    lines.push(
      `день смерти:  мин ${sorted[0]}, макс ${sorted[sorted.length - 1]}, медиана ${sorted[Math.floor(sorted.length / 2)]}`,
    );
  }
  lines.push(
    `фактов Журнала: среднее ${summary.meanFacts.toFixed(1)}, мин ${summary.minFacts}, макс ${summary.maxFacts}`,
  );
  lines.push(
    `атаки: в Город ${summary.attacksByTarget.город}, в Структуры ${summary.attacksByTarget.структуры}, в пустоту ${summary.attacksByTarget.пустота}`,
  );
  lines.push(`различимых исходов: ${summary.distinctOutcomeSignatures}`);
  lines.push("");
  lines.push("гистограмма событий:");
  const sortedHistogram = Object.entries(summary.eventHistogram).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedHistogram) {
    lines.push(`  ${type.padEnd(28)} ${count}`);
  }
  lines.push("");
  lines.push("построчно по прогонам:");
  for (const r of summary.results) {
    const pop = (r.cityCharacteristics.population ?? 0).toFixed(1);
    lines.push(
      `  #${String(r.runId).padStart(3)} сид ${String(r.seed).padStart(10)} ${r.outcome.padEnd(12)}` +
        ` день ${String(r.cityDeathDay ?? "—").padStart(3)} население ${pop.padStart(6)}` +
        ` фактов ${String(r.journalFacts).padStart(4)} напряжённость ${r.finalTension.toFixed(1)}`,
    );
  }
  return lines.join("\n");
}
