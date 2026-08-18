/**
 * Загрузчик конфигов.
 *
 * Конфиг после инициализации доступен всем только на чтение (заметка
 * «Игровой цикл», п.2). Загрузчик делает глубокую копию значений по умолчанию,
 * накладывает частичные переопределения и замораживает результат.
 */

import { defaultConfig } from "./default.js";
import type { SnowflowConfig } from "./types.js";

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => deepClone(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepClone(v);
    }
    return out as T;
  }
  return value;
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (Array.isArray(patch)) return deepClone(patch) as unknown as T;
  if (patch && typeof patch === "object" && base && typeof base === "object" && !Array.isArray(base)) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      out[k] = deepMerge((base as Record<string, unknown>)[k], v);
    }
    return out as T;
  }
  return deepClone(patch) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

export function loadConfig(overrides?: DeepPartial<SnowflowConfig>): SnowflowConfig {
  const merged = deepMerge(deepClone(defaultConfig), overrides);
  return deepFreeze(merged);
}

export { defaultConfig };
export type { SnowflowConfig };
export * from "./types.js";
