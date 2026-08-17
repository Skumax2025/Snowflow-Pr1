/**
 * Единый источник случайности: один сид — побитово идентичный прогон.
 */

import { describe, expect, it } from "vitest";
import { createRng, seedCorpus } from "../src/core/rng.js";

describe("ГСЧ", () => {
  it("один сид даёт идентичную последовательность", () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 200 }, () => a.next());
    const seqB = Array.from({ length: 200 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("разные сиды дают разные последовательности", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("держится в границах", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = rng.int(3, 9);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(9);
    }
  });

  it("взвешенный выбор уважает веса и игнорирует нулевые", () => {
    const rng = createRng(99);
    const counts = [0, 0, 0];
    for (let i = 0; i < 3000; i++) {
      const idx = rng.weightedIndex([1, 0, 9]);
      counts[idx] = (counts[idx] ?? 0) + 1;
    }
    expect(counts[1]).toBe(0);
    expect(counts[2]).toBeGreaterThan(counts[0] as number);
  });

  it("возвращает -1, если суммарный вес нулевой", () => {
    const rng = createRng(3);
    expect(rng.weightedIndex([0, 0, 0])).toBe(-1);
  });

  it("fork детерминирован и не совпадает с родителем", () => {
    const a = createRng(42).fork("погода");
    const b = createRng(42).fork("погода");
    const c = createRng(42).fork("пулы");
    expect(a.next()).toBe(b.next());
    expect(a.seed).not.toBe(c.seed);
  });

  it("корпус сидов Стенда воспроизводим и не вырожден", () => {
    const first = seedCorpus(20260817, 100);
    const second = seedCorpus(20260817, 100);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(100);
  });
});
