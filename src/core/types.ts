/**
 * Общие типы ядра. Ядро headless: ни одного упоминания DOM, окна и рендера.
 */

/** Квадрант, формат буква+цифра — канон закреплён заметкой «Погода». */
export type Quadrant = string;

export type FactId = string;
export type SignalId = string;

/** Момент партии, отдаваемый Временем. */
export interface Moment {
  /** Минут с начала партии. */
  totalMinutes: number;
  /** Номер дня партии, с 1. */
  day: number;
  hour: number;
  minute: number;
  isNight: boolean;
}

/** Система, которую тикает Игровой цикл. Порядок обхода задан лупом. */
export interface Tickable {
  readonly systemId: string;
  tick(now: Moment): void;
}

/** Диапазон вещания. Канон: Гражданский / Военный / Посты. */
export type Band = "гражданский" | "военный" | "посты";

/** Точность сигнала. Проверка сигнала это поле принципиально не читает. */
export type Accuracy = "правда" | "неточность" | "искажение" | "ложь";

export type StructureKind = "пост" | "база" | "склад" | "ретранслятор";

export type FactionKind = "свои" | "противники" | "мародёры";

/** Разбор координаты «D4» → {col: 3, row: 3} (нумерация с нуля). */
export function parseQuadrant(q: Quadrant): { col: number; row: number } {
  const letter = q.charCodeAt(0) - "A".charCodeAt(0);
  const digits = Number.parseInt(q.slice(1), 10);
  return { col: letter, row: Number.isNaN(digits) ? 0 : digits - 1 };
}

export function makeQuadrant(col: number, row: number): Quadrant {
  return `${String.fromCharCode("A".charCodeAt(0) + col)}${row + 1}`;
}

/** Расстояние по сетке (чебышёвское): радиус слышимости считается им же. */
export function quadrantDistance(a: Quadrant, b: Quadrant): number {
  const pa = parseQuadrant(a);
  const pb = parseQuadrant(b);
  return Math.max(Math.abs(pa.col - pb.col), Math.abs(pa.row - pb.row));
}

export function allQuadrants(cols: number, rows: number): Quadrant[] {
  const result: Quadrant[] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      result.push(makeQuadrant(c, r));
    }
  }
  return result;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
