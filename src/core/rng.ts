/**
 * Единый источник случайности.
 *
 * ГДД, мастер-концепт 6.7: «Пулы событий и Погода принимают сид снаружи.
 * В обычной игре его передаёт Игровой цикл, в серии — Стенд симуляции.»
 *
 * Никакой системе не разрешено вызывать Math.random(). Генератор инжектируется.
 */

export interface Rng {
  /** [0;1) */
  next(): number;
  /** Целое в [min; max], границы включительно. */
  int(min: number, max: number): number;
  /** Вещественное в [min; max). */
  float(min: number, max: number): number;
  /** Событие с вероятностью p. */
  chance(p: number): boolean;
  /** Равновероятный элемент. Бросает на пустом списке — молчаливый undefined хуже. */
  pick<T>(items: readonly T[]): T;
  /** Взвешенный выбор по индексу: возвращает индекс, а не элемент. */
  weightedIndex(weights: readonly number[]): number;
  /** Производный поток, детерминированно выведенный из текущего сида и метки. */
  fork(label: string): Rng;
  /** Сид, которым поток был создан. */
  readonly seed: number;
}

/** Хэш строки в 32-битное целое (FNV-1a). Нужен для fork(). */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Смешивание двух сидов в один (SplitMix32 finalizer). */
export function mixSeed(a: number, b: number): number {
  let z = (a ^ Math.imul(b ^ (b >>> 15), 0x2c1b3c6d)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/**
 * mulberry32 — 32-битный ГПСЧ. Выбран как самый короткий детерминированный
 * генератор с приемлемым качеством: одна строка состояния, побитовая
 * воспроизводимость между запусками и платформами.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    seed: seed >>> 0,
    next,
    int(min, max) {
      if (max < min) return min;
      return min + Math.floor(next() * (max - min + 1));
    },
    float(min, max) {
      return min + next() * (max - min);
    },
    chance(p) {
      if (p <= 0) return false;
      if (p >= 1) return true;
      return next() < p;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new Error("Rng.pick: пустой список");
      }
      return items[Math.floor(next() * items.length)] as T;
    },
    weightedIndex(weights) {
      let total = 0;
      for (const w of weights) total += w > 0 ? w : 0;
      if (total <= 0) return -1;
      let roll = next() * total;
      for (let i = 0; i < weights.length; i++) {
        const w = weights[i] ?? 0;
        if (w <= 0) continue;
        roll -= w;
        if (roll < 0) return i;
      }
      // Числовой хвост: вернуть последний положительный вес.
      for (let i = weights.length - 1; i >= 0; i--) {
        if ((weights[i] ?? 0) > 0) return i;
      }
      return -1;
    },
    fork(label) {
      return createRng(mixSeed(seed, hashString(label)));
    },
  };

  return rng;
}

/**
 * Корпус сидов для Стенда симуляции: детерминированно порождается из базового.
 * Случайные сиды не используются — набор воспроизводим между запусками.
 */
export function seedCorpus(baseSeed: number, count: number): number[] {
  const seeds: number[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push(mixSeed(baseSeed, hashString(`прогон:${i}`)));
  }
  return seeds;
}
