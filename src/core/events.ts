/**
 * Канонические имена событий (мастер-концепт, раздел 13 «Словарь»).
 *
 * Значение константы — русское каноническое имя, потому что словарь ГДД
 * русский и «одна сущность — одно имя». Идентификатор — английский, чтобы код
 * оставался читаемым. Соответствие зафиксировано в CONTRACTS.md, раздел 4.
 */

import type { Quadrant, FactId, SignalId } from "./types.js";

export const EV = {
  /** Действия Вышки и Стенда → Время (через чанкер Игрового цикла). */
  SPEND_MINUTES: "потратить_минуты",
  /** Сон → Игровой цикл → Время. */
  REWIND_TO_HOUR: "перемотать_до_часа",
  /** Время → все, у кого есть суточное расписание. */
  NEW_DAY: "начался_новый_день",

  /** Парсер → Город. */
  REPORT_VERDICT: "вердикт_рапорта",
  /** Парсер → Фильтр аномалий. */
  OFFTOPIC_FOUND: "офтопик_обнаружен",
  /** Терминал → Парсер. */
  REPORT_SENT: "рапорт_отправлен",

  /** Фракции (Противники) и Режиссёр → Город или Структура. */
  ATTACK: "атака_силой_N",
  /** Фракции → Режиссёр. */
  AGGRESSIVE_FIRED: "агрессивное_сработало",
  /** Конвой и Режиссёр → Город. */
  SUPPLY_DELIVERED: "поставка_доставлена",
  SUPPLY_LOST: "поставка_потеряна",

  /** Приём сигнала → Проверка сигнала (обычный) / Карта (сводка). */
  SIGNAL_CAUGHT: "сигнал_пойман",
  /** Галлюцинации → Генератор эфира. */
  MIX_PHANTOM_SIGNAL: "подмешать_фантомный_сигнал",

  /** Мостик → Генератор. */
  FUEL_REFILL: "пополнение_топлива",
  /** Проверка сигнала и Терминал → Генератор. */
  SPEND_FUEL: "потратить_топливо",
  /** Мостик → Приём пищи. */
  ADD_RATIONS: "добавить_порции",

  /** Приём пищи → Радист. */
  REDUCE_HUNGER: "снизить_голод",
  /** Сон → Радист. */
  SLEEP_FINISHED: "сон_завершён",
  /** Мостик → Радист. */
  RESTORE_SANITY: "восстановить_рассудок",
  /** Мостик → Радист. */
  APPLY_COLD: "нанести_холод",

  /** Радист → Финал. */
  RADIOMAN_DIED: "радист_умер",
  /** Финал → Игровой цикл. */
  GAME_OVER: "партия_окончена",

  /** Газета → UI (уведомление, само содержимое читается по запросу). */
  ISSUE_READY: "выпуск_готов",
} as const;

export type EventName = (typeof EV)[keyof typeof EV];

// --- Полезные нагрузки ---

export interface SpendMinutesPayload {
  minutes: number;
  /** Кто потратил — только для отладки и Стенда, логика на это не смотрит. */
  source: string;
}

export interface RewindPayload {
  /** Абсолютная метка партии в минутах, до которой перематываем. */
  targetMinute: number;
}

export interface NewDayPayload {
  day: number;
}

export type ClaimVerdictCategory = "правда" | "ложь" | "неточность";

export interface ClaimVerdict {
  claimId: string;
  category: ClaimVerdictCategory;
  factId: FactId | null;
}

export interface ReportTone {
  /** воодушевление 0..1 */
  inspiration: number;
  /** тревожность 0..1 */
  anxiety: number;
  /** конкретность 0..1 */
  specificity: number;
}

export interface ReportVerdictPayload {
  verdicts: ClaimVerdict[];
  tone: ReportTone;
}

export interface OfftopicPayload {
  text: string;
}

export interface ReportSentPayload {
  text: string;
}

export interface AttackPayload {
  /** Сила N. */
  power: number;
  /** Квадрант, на который атака была маршрутизирована. */
  quadrant: Quadrant;
  /** Адресат: «город», subject живой Структуры или «пустота». */
  target: string;
  /** Кто инициировал: «Фракции» или «Режиссёр» — для факта в Журнале. */
  origin: string;
}

export interface SupplyPayload {
  origin: string;
}

export interface SignalCaughtPayload {
  signalId: SignalId;
  frequency: number;
  band: string;
  signalKind: "обычный" | "сводка";
  /** Содержимое снимка — только у сводок. */
  digest?: unknown;
}

export interface FuelPayload {
  amount: number;
  source: string;
}

export interface RationsPayload {
  portions: number;
}

export interface ReduceHungerPayload {
  amount: number;
}

export interface SleepFinishedPayload {
  /** Фактическая длительность сна в минутах. */
  minutes: number;
}

export interface SanityPayload {
  amount: number;
}

export interface ColdPayload {
  amount: number;
}

export type DeathCause = "заморозка" | "рассудок";

export interface RadiomanDiedPayload {
  cause: DeathCause;
}
