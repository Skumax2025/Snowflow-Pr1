/**
 * Точка входа Стенда симуляции: `npm run sim`.
 *
 * Флаги: --runs=N --seed=N --days=N --isolated --reports --json
 */

import { loadConfig, type DeepPartial } from "../config/index.js";
import type { SnowflowConfig } from "../config/types.js";
import { formatSummary, runSeries } from "./harness.js";

function parseArgs(argv: string[]): DeepPartial<SnowflowConfig> {
  const sim: Record<string, unknown> = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "runs" && value) sim.runs = Number(value);
    if (key === "seed" && value) sim.baseSeed = Number(value);
    if (key === "days" && value) sim.partyLengthDays = Number(value);
    if (key === "step" && value) sim.timeStepMinutes = Number(value);
    if (key === "isolated") sim.isolatedCityMode = true;
    if (key === "reports") sim.syntheticReports = { enabled: true };
    if (key === "json") sim.outputFormat = "json";
  }
  return { sim } as DeepPartial<SnowflowConfig>;
}

const cfg = loadConfig(parseArgs(process.argv.slice(2)));
const started = Date.now();
const summary = runSeries(cfg);
const elapsed = ((Date.now() - started) / 1000).toFixed(2);

if (cfg.sim.outputFormat === "json") {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  process.stdout.write(`${formatSummary(summary)}\n\nсерия заняла ${elapsed} с\n`);
}
