/**
 * Форма конфигурации Snowflow.
 *
 * Архитектурный инвариант ГДД: «Данные вне логики. Все числа, веса, таблицы
 * событий, пороги — в конфигах. Добавление контента не требует правки
 * ветвлений.» Ни один модуль ядра не содержит игровых чисел; всё приходит сюда.
 */

import type { Accuracy, Band, FactionKind, Quadrant, StructureKind } from "../core/types.js";

// --- Пулы событий ---

export interface PoolModifier {
  /** Имя характеристики сущности-владельца. */
  stat: string;
  coef: number;
}

export interface PoolExternalModifier {
  /** Явно разрешённый внешний источник (мастер-концепт 6.7). */
  source: "погода" | "напряжённость";
  coef: number;
}

export interface PoolEffect {
  stat: string;
  delta: number;
}

export interface PoolFactTemplate {
  eventType: string;
  status: string;
  archetypeTag?: "агрессивное";
}

export interface PoolSpawn {
  /** Тип дочерней сущности; её пул ищется по этому имени. */
  kind: string;
  /** Диапазоны стартовых характеристик [min; max]. */
  stats: Record<string, [number, number]>;
}

export interface PoolEventRow {
  id: string;
  baseWeight: number;
  modifiers?: PoolModifier[];
  externalModifiers?: PoolExternalModifier[];
  effectOnSelf?: PoolEffect[];
  fact?: PoolFactTemplate;
  /** Явное событие наружу: имя события и адресат. */
  outbound?: { event: string; to: "город" | "режиссёр" | "маршрутизация_атаки" };
  spawn?: PoolSpawn;
  /** Терминальное событие удаляет сущность из реестра родителя. */
  terminal?: boolean;
  /** Сила атаки катается из этого диапазона, если событие — атака. */
  attackPower?: [number, number];
}

export interface PoolTable {
  /** Интервал тика в минутах; не меньше шага лупа. */
  tickMinutes: number;
  /** Вес опции «ничего не произошло». */
  idleWeight: number;
  events: PoolEventRow[];
}

// --- Конфиг партии (владеет Игровой цикл) ---

export interface ScenarioStructure {
  kind: StructureKind;
  quadrant: Quadrant;
  /** Целостность на старте. */
  integrity: number;
  /** Доменная характеристика: имя → значение. */
  domain?: Record<string, number>;
}

export interface BandRange {
  band: Band;
  from: number;
  to: number;
}

export interface PartyConfig {
  gridCols: number;
  gridRows: number;
  towerQuadrant: Quadrant;
  cityQuadrant: Quadrant;
  bands: BandRange[];
  meteoFrequency: number;
  relayFrequency: number;
  scenarioStructures: ScenarioStructure[];
  partyLengthDays: number;
  loopStepMinutes: number;
  seed: number;
  minutesPerDay: number;
  dawnHour: number;
  duskHour: number;
  startingRations: number;
  startingFuel: number;
}

// --- Мир ---

export interface WeatherConfig {
  tickMinutes: number;
  stormStartChance: number;
  stormEndChance: number;
  /** Базовая температура: base + суточная амплитуда + дрейф по дням. */
  baseTemperature: number;
  dailyAmplitude: number;
  /** Насколько холоднее становится к финалу, градусов за день. */
  driftPerDay: number;
  stormTemperaturePenalty: number;
}

export interface CityConfig {
  start: {
    panic: number;
    morale: number;
    trust: number;
    defence: number;
    population: number;
    integrity: number;
    supply: number;
  };
  pool: PoolTable;
  /** Скорость прироста Обороны за минуту: coefPanic*Паника + coefIntegrity*Целостность. */
  defenceRate: { coefPanic: number; coefIntegrity: number; cap: number };
  /** Разрушение (0–100) = weightIntegrity*(100-Целостность) + weightPopulation*(100-Население). */
  destruction: { weightIntegrity: number; weightPopulation: number };
  /** Объём поставки = coefSupply*Снабжение + coefTrust*Доверие, клэмп снизу полом. */
  supplyVolume: { coefSupply: number; coefTrust: number; floor: number };
  /** Потери Населения при пробитии, доля от превышения силы над Обороной. */
  breach: { populationLossPercent: number; integrityLoss: number; defenceLossFactor: number };
  /** Дельты характеристик по исходу поставки. */
  supplyEvent: { delivered: number; lost: number; lostPanic: number };
  /** Дельты Доверия и Морали по вердиктам. */
  verdict: {
    trustTruth: number;
    trustLie: number;
    trustInaccuracy: number;
    panicPerConfirmedThreat: number;
    moraleFromTone: number;
  };
  /** Риторическая насыщенность: рост за применение и спад за минуту. */
  rhetoric: { growthPerApply: number; decayPerMinute: number; halfSaturation: number };
  /** Пороги критических исходов — читаются только для фактов Журнала. */
  thresholds: { panicRiot: number; moraleCollapse: number; trustIgnored: number };
}

export interface StructuresConfig {
  pools: Record<StructureKind, PoolTable>;
  /** Пул дочерней сущности Конвой. */
  convoyPool: PoolTable;
}

export interface FactionsConfig {
  pools: Record<FactionKind, PoolTable>;
  /** Стартовая Агрессивность Противников. */
  aggressionStart: number;
  aggressionRange: [number, number];
  /** Окно «недавних» записей Журнала для выбора квадранта атаки, минуты. */
  recentWindowMinutes: number;
}

export interface DirectorConfig {
  tickMinutes: number;
  tensionStart: number;
  coefFromPanic: number;
  coefFromTrustDrop: number;
  dischargeAmount: number;
  branches: {
    supplyLost: number;
    disinformation: number;
    emergencyRaid: number;
  };
  raidPower: [number, number];
  /** Добавка к весу «агрессивных» событий: вес += coef * Напряжённость. */
  aggressiveWeightCoef: number;
}

export interface BroadcastConfig {
  tickMinutes: number;
  ttlMinutes: number;
  hearingRadius: Record<"ретранслятор" | "пост" | "база", number>;
  /** Диапазон по типу источника факта — таблица «Слышимость». */
  audibility: Record<string, Band>;
  /** Вероятность «неточности» у источника с пустым тегом. */
  inaccuracyChance: number;
  /** Вероятность «лжи» против «искажения» у записи с тегом «агрессивное». */
  lieChanceForAggressive: number;
  /** Расхождение заявленных деталей при точности ниже «правды». */
  divergence: { distanceSpread: number; timeSpreadMinutes: number; quadrantShift: number };
  meteoHour: number;
  relayHour: number;
  /** Типы событий, из которых собирается фантомный сигнал. */
  phantomEventTypes: string[];
  /** Возможные заявленные пути — контент, общий для настоящих и фантомов. */
  routes: string[];
}

// --- Вышка ---

export interface RadiomanConfig {
  start: { fatigue: number; hunger: number; warmth: number; sanity: number };
  tickMinutes: number;
  fatiguePerMinute: number;
  hungerPerMinute: number;
  /** Восстановление за минуту сна и множители за тепло/сытость. */
  sleep: { fatigueRecoveryPerMinute: number; sanityRecoveryPerMinute: number; comfortBonus: number };
  sanity: {
    fatigueWeight: number;
    hungerWeight: number;
    coldWeight: number;
    comfortWarmth: number;
  };
  thresholds: {
    cannotSleep: number;
    freezing: number;
    freezingDurationMinutes: number;
  };
}

export interface GeneratorConfig {
  heatingMax: number;
  heatingStart: number;
  /** Топлива в минуту на единицу Обогрева. */
  fuelPerHeatingPerMinute: number;
  /** Топлива в минуту на градус температурного дефицита. */
  fuelPerDeficitPerMinute: number;
  /** Комфортная температура: дефицит = комфорт − эффективная температура. */
  comfortTemperature: number;
  /** Баланс тепла = heatPerHeating*Обогрев − heatPerDeficit*дефицит. */
  heatPerHeating: number;
  heatPerDeficit: number;
}

export interface ReceptionConfig {
  windowWidth: number;
  attemptMinutes: number;
  tunerStart: number;
}

export interface SignalCheckConfig {
  minutes: number;
  fuel: number;
}

export interface TerminalConfig {
  fixedMinutes: number;
  minutesPerChar: number;
  fixedFuel: number;
  fuelPerChar: number;
  disclaimer: string;
}

export interface MealConfig {
  minutes: number;
  hungerReduction: number;
}

export interface BridgeConfig {
  stayMinutes: number;
  sanityRestore: number;
  baseCold: number;
  safeMinutes: number;
  coldEscalation: number;
  destructionTiers: Array<{ upTo: number; label: string }>;
  supplyHour: number;
  supplyPeriodDays: number;
  fuelShare: number;
  rationVolume: number;
}

export interface SleepConfig {
  maxHours: number;
}

export interface HallucinationsConfig {
  criticalSanity: number;
  tickMinutes: number;
  phantomBaseChance: number;
  voiceBaseChance: number;
  escalationCoef: number;
  voiceFormat: "текст" | "звук" | "текст+действие";
}

export interface NewspaperConfig {
  hour: number;
  watchTimerChance: number;
  watchTimerFlavor: string[];
  verdictTemplates: Record<string, string>;
  eventTemplates: Record<string, string>;
  farewellIssue: string;
}

export interface EndingConfig {
  tickMinutes: number;
  routes: Record<string, string>;
}

export interface AnomalyFilterConfig {
  endpointWrite: string;
  endpointRead: string;
  rateLimitPerIp: number;
  /** Локальный сид-пул на случай, когда сеть недоступна (деградация). */
  seedMessages: string[];
}

export interface ProxyConfig {
  endpoint: string;
  timeoutSeconds: number;
  rateLimitPerIp: number;
  model: string;
  /** Пустой разбор — единый класс исходов при любом сбое. */
  emptyParse: {
    claims: never[];
    tone: { inspiration: number; anxiety: number; specificity: number };
    offtopic: { flag: false; text: "" };
  };
  systemPrompt: string;
  /** JSON-схема ответа модели. Лежит в конфиге, не в коде. */
  responseSchema: SchemaNode;
  /** Допуски сверки claim ↔ Журнал. */
  matching: {
    timeToleranceMinutes: number;
    confidenceThreshold: number;
  };
}

/** Минимальный диалект JSON-схемы, которого хватает для ответа модели. */
export interface SchemaNode {
  type: "object" | "array" | "string" | "number" | "boolean";
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

export interface SimConfig {
  baseSeed: number;
  runs: number;
  partyLengthDays: number;
  timeStepMinutes: number;
  isolatedCityMode: boolean;
  /**
   * Тикает ли Генератор эфира в серии. Метрика «не вымирает ли эфир» была
   * отложена в заметке «Стенд симуляции» до сборки Приёма сигнала; он собран.
   */
  includeBroadcast: boolean;
  /**
   * Сколько минут подряд без единого живого сигнала считается мёртвым эфиром.
   * Игрок узнаёт об этом единственным способом — попыткой настройки, поэтому
   * порог осмысленно мерить в стоимостях попытки.
   */
  deadEtherWindowMinutes: number;
  syntheticAttacks: {
    chancePerTick: number;
    powerRange: [number, number];
    tickMinutes: number;
  };
  /** Синтетический поток рапортов — по умолчанию выключен. */
  syntheticReports: {
    enabled: boolean;
    everyMinutes: number;
    truthShare: number;
  };
  outputFormat: "json" | "console";
}

export interface SnowflowConfig {
  party: PartyConfig;
  weather: WeatherConfig;
  city: CityConfig;
  structures: StructuresConfig;
  factions: FactionsConfig;
  director: DirectorConfig;
  broadcast: BroadcastConfig;
  radioman: RadiomanConfig;
  generator: GeneratorConfig;
  reception: ReceptionConfig;
  signalCheck: SignalCheckConfig;
  terminal: TerminalConfig;
  meal: MealConfig;
  bridge: BridgeConfig;
  sleep: SleepConfig;
  hallucinations: HallucinationsConfig;
  newspaper: NewspaperConfig;
  ending: EndingConfig;
  anomalyFilter: AnomalyFilterConfig;
  proxy: ProxyConfig;
  sim: SimConfig;
}

export type { Accuracy };
