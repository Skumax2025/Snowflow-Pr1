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
  ether: EtherMetrics;
}

/**
 * Метрика «не вымирает ли эфир» — открытый вопрос 22 мастер-концепта и п.5
 * заметки «Стенд симуляции», отложенный там до сборки Приёма сигнала.
 *
 * Меряем не «сколько сигналов сгенерировано за сутки», а то, что игрок реально
 * чувствует: доля времени, когда в эфире нет ни одного живого сигнала, и самое
 * длинное такое окно. Попытка настройки в мёртвый эфир — потерянное время
 * без выбора внутри него.
 */
export interface EtherMetrics {
  signalsGenerated: number;
  digestsPublished: number;
  /** Среднее число живых непойманных сигналов на замер. */
  meanLiveSignals: number;
  /** Доля замеров, где в эфире пусто. */
  silenceShare: number;
  /** Самая длинная тишина подряд, минуты, и минута её начала. */
  longestSilenceMinutes: number;
  longestSilenceStartMinute: number;
  /** Когда в эфире появился первый сигнал: разогрев мира с пустого Журнала. */
  firstSignalMinute: number | null;
  /** Сколько раз тишина держалась дольше окна из конфига. */
  deadEtherWindows: number;
  /** Сигналов по дням партии — видно, вымирает ли эфир к пятому дню. */
  signalsPerDay: number[];
}

export interface EtherSummary {
  meanSignalsPerRun: number;
  meanLiveSignals: number;
  meanSilenceShare: number;
  worstSilenceMinutes: number;
  runsWithDeadEther: number;
  /** Из них — те, где самая длинная тишина пришлась не на разогрев первых суток. */
  runsWithDeadEtherAfterWarmup: number;
  meanFirstSignalMinute: number;
  meanSignalsPerDay: number[];
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
  ether: EtherSummary;
  results: RunResult[];
}

export function runOne(cfg: SnowflowConfig, seed: number, runId: number): RunResult {
  const world = createWorld(cfg, seed, { withBroadcast: cfg.sim.includeBroadcast });
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

  // Замеры эфира берутся на каждом шаге: игрок может подойти к тюнеру в любой.
  let samples = 0;
  let liveSum = 0;
  let silentSamples = 0;
  let silenceRun = 0;
  let silenceRunStart = 0;
  let longestSilence = 0;
  let longestSilenceStart = 0;
  let firstSignalMinute: number | null = null;
  let deadWindows = 0;
  let inDeadWindow = false;
  const signalsPerDay: number[] = [];
  let seenSignalIds = 0;

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

    if (cfg.sim.includeBroadcast) {
      const live = world.broadcast.liveSignals().length;
      samples += 1;
      liveSum += live;
      if (live > 0 && firstSignalMinute === null) firstSignalMinute = world.time.totalMinutes;

      if (live === 0) {
        silentSamples += 1;
        if (silenceRun === 0) silenceRunStart = world.time.totalMinutes;
        silenceRun += step;
        if (silenceRun > longestSilence) {
          longestSilence = silenceRun;
          longestSilenceStart = silenceRunStart;
        }
        if (!inDeadWindow && silenceRun >= cfg.sim.deadEtherWindowMinutes) {
          deadWindows += 1;
          inDeadWindow = true;
        }
      } else {
        silenceRun = 0;
        inDeadWindow = false;
      }

      const day = Math.floor(world.time.totalMinutes / cfg.party.minutesPerDay);
      while (signalsPerDay.length <= day) signalsPerDay.push(0);
      const total = world.broadcast.generatedCount.обычный + world.broadcast.generatedCount.сводка;
      signalsPerDay[day] = (signalsPerDay[day] ?? 0) + (total - seenSignalIds);
      seenSignalIds = total;
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

  const ether: EtherMetrics = {
    signalsGenerated: world.broadcast.generatedCount.обычный,
    digestsPublished: world.broadcast.generatedCount.сводка,
    meanLiveSignals: samples === 0 ? 0 : liveSum / samples,
    silenceShare: samples === 0 ? 0 : silentSamples / samples,
    longestSilenceMinutes: longestSilence,
    longestSilenceStartMinute: longestSilenceStart,
    firstSignalMinute,
    deadEtherWindows: deadWindows,
    signalsPerDay,
  };

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
    ether,
  };
}

function summariseEther(results: RunResult[], minutesPerDay: number): EtherSummary {
  const runs = Math.max(1, results.length);
  const maxDays = results.reduce((acc, r) => Math.max(acc, r.ether.signalsPerDay.length), 0);
  const perDay: number[] = [];
  for (let day = 0; day < maxDays; day++) {
    let sum = 0;
    let seen = 0;
    for (const r of results) {
      const value = r.ether.signalsPerDay[day];
      if (value === undefined) continue;
      sum += value;
      seen += 1;
    }
    perDay.push(seen === 0 ? 0 : sum / seen);
  }

  return {
    meanSignalsPerRun: results.reduce((s, r) => s + r.ether.signalsGenerated, 0) / runs,
    meanLiveSignals: results.reduce((s, r) => s + r.ether.meanLiveSignals, 0) / runs,
    meanSilenceShare: results.reduce((s, r) => s + r.ether.silenceShare, 0) / runs,
    worstSilenceMinutes: results.reduce((s, r) => Math.max(s, r.ether.longestSilenceMinutes), 0),
    runsWithDeadEther: results.filter((r) => r.ether.deadEtherWindows > 0).length,
    runsWithDeadEtherAfterWarmup: results.filter(
      (r) => r.ether.deadEtherWindows > 0 && r.ether.longestSilenceStartMinute >= minutesPerDay,
    ).length,
    meanFirstSignalMinute:
      results.reduce((s, r) => s + (r.ether.firstSignalMinute ?? 0), 0) / runs,
    meanSignalsPerDay: perDay,
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
    ether: summariseEther(results, cfg.party.minutesPerDay),
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
  lines.push("эфир:");
  lines.push(`  сигналов за прогон:     ${summary.ether.meanSignalsPerRun.toFixed(1)}`);
  lines.push(`  живых сигналов в эфире: ${summary.ether.meanLiveSignals.toFixed(2)} в среднем`);
  lines.push(`  доля тишины:            ${(summary.ether.meanSilenceShare * 100).toFixed(1)}%`);
  lines.push(`  самая длинная тишина:   ${summary.ether.worstSilenceMinutes} мин`);
  lines.push(`  первый сигнал в эфире:  ${summary.ether.meanFirstSignalMinute.toFixed(0)} мин от старта`);
  lines.push(
    `  прогонов с мёртвым эфиром: ${summary.ether.runsWithDeadEther}` +
      `, из них после первых суток: ${summary.ether.runsWithDeadEtherAfterWarmup}`,
  );
  lines.push(
    `  сигналов по дням:       ${summary.ether.meanSignalsPerDay.map((v) => v.toFixed(0)).join(" ")}`,
  );
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
