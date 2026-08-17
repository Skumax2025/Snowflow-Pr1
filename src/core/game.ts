/**
 * Полная сборка партии — то, что Игровой цикл создаёт при старте.
 *
 * Мир поднимается тем же `createWorld`, что использует Стенд симуляции;
 * сверху добавляются Вышка, Эфир, канал в город, Стол и служебные системы.
 * Порядок регистрации в лупе — константа заметки «Игровой цикл», п.3:
 * Погода → Пулы Мира → Режиссёр → Генератор эфира → Газета → Мостик →
 * Радист → Галлюцинации (и Финал последним: он гасит луп).
 *
 * Ни одной строки игровой логики здесь нет — только проводка и константы
 * из конфига партии.
 */

import type { SnowflowConfig } from "../config/types.js";
import { AnomalyFilter, HttpAnomalyTransport, type AnomalyTransport } from "./anomalyFilter.js";
import { Bridge } from "./bridge.js";
import { Broadcast } from "./broadcast.js";
import { Ending } from "./ending.js";
import { Generator } from "./generator.js";
import { Hallucinations } from "./hallucinations.js";
import { GameMap } from "./map.js";
import { Meal } from "./meal.js";
import { Newspaper } from "./newspaper.js";
import { Parser } from "./parser.js";
import { HttpProxyClient, type ProxyClient } from "./proxyClient.js";
import { Radioman } from "./radioman.js";
import { Reception } from "./reception.js";
import { SignalCheck } from "./signalCheck.js";
import { Sleep } from "./sleep.js";
import { Terminal } from "./terminal.js";
import type { FactionKind } from "./types.js";
import { createWorld, type World } from "./world.js";

export interface Game extends World {
  generator: Generator;
  radioman: Radioman;
  sleep: Sleep;
  meal: Meal;
  bridge: Bridge;
  broadcast: Broadcast;
  reception: Reception;
  signalCheck: SignalCheck;
  terminal: Terminal;
  parser: Parser;
  newspaper: Newspaper;
  map: GameMap;
  hallucinations: Hallucinations;
  anomalyFilter: AnomalyFilter;
  ending: Ending;
}

export interface GameOptions {
  seed?: number;
  /** Подменяется в тестах: сети в тестах нет. */
  proxy?: ProxyClient;
  anomalyTransport?: AnomalyTransport;
}

export function createGame(cfg: SnowflowConfig, options: GameOptions = {}): Game {
  const world = createWorld(cfg, options.seed ?? cfg.party.seed);
  const { bus, time, loop, journal, weather, city, structures, rng } = world;

  const generator = new Generator(
    cfg.generator,
    time,
    weather,
    cfg.party.towerQuadrant,
    bus,
    cfg.party.startingFuel,
  );
  const radioman = new Radioman(cfg.radioman, generator, bus);
  const sleep = new Sleep(cfg.sleep, time, radioman, bus);
  const meal = new Meal(cfg.meal, bus, cfg.party.startingRations);
  const bridge = new Bridge(
    cfg.bridge,
    city,
    weather,
    journal,
    cfg.party.cityQuadrant,
    cfg.party.towerQuadrant,
    bus,
  );

  const broadcast = new Broadcast(
    cfg.broadcast,
    cfg.party,
    journal,
    structures,
    weather,
    rng.fork("эфир"),
    bus,
  );
  const reception = new Reception(
    cfg.reception,
    cfg.party,
    broadcast,
    weather,
    cfg.party.towerQuadrant,
    bus,
  );
  const signalCheck = new SignalCheck(cfg.signalCheck, broadcast, weather, bus);

  const terminal = new Terminal(cfg.terminal, bus);
  const parser = new Parser(
    cfg.proxy,
    journal,
    time,
    {
      structures,
      factions: ["свои", "противники", "мародёры"] as FactionKind[],
      grid: { cols: cfg.party.gridCols, rows: cfg.party.gridRows },
    },
    options.proxy ?? new HttpProxyClient(cfg.proxy),
    bus,
  );
  const newspaper = new Newspaper(cfg.newspaper, journal, rng.fork("газета"), bus);
  const map = new GameMap(cfg.party.gridCols, cfg.party.gridRows, time, bus);

  const anomalyFilter = new AnomalyFilter(
    cfg.anomalyFilter,
    options.anomalyTransport ?? new HttpAnomalyTransport(cfg.anomalyFilter),
    bus,
  );
  const hallucinations = new Hallucinations(
    cfg.hallucinations,
    radioman,
    anomalyFilter,
    rng.fork("галлюцинации"),
    bus,
  );
  const ending = new Ending(cfg.ending, journal, city, cfg.party.minutesPerDay, bus);

  // Мир уже зарегистрирован в лупе внутри createWorld; дальше — по порядку.
  loop.register(broadcast);
  loop.register(newspaper);
  loop.register(bridge);
  loop.register(radioman);
  loop.register(hallucinations);
  loop.register(ending);

  return {
    ...world,
    generator,
    radioman,
    sleep,
    meal,
    bridge,
    broadcast,
    reception,
    signalCheck,
    terminal,
    parser,
    newspaper,
    map,
    hallucinations,
    anomalyFilter,
    ending,
  };
}
