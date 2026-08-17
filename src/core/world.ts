/**
 * Сборка Мира — то, что Игровой цикл создаёт при инициализации партии.
 *
 * Здесь нет ни одного игрового числа: всё приходит из конфига партии.
 * Порядок регистрации систем в лупе — константа из заметки «Игровой цикл»:
 * Погода → Пулы событий сущностей Мира → Режиссёр → …
 *
 * Стенд симуляции переиспользует ровно эту сборку, поднимая только Мир.
 */

import type { SnowflowConfig } from "../config/types.js";
import { EventBus } from "./bus.js";
import { City } from "./city.js";
import { Director } from "./director.js";
import { Faction } from "./factions.js";
import { Journal } from "./journal.js";
import { GameLoop } from "./loop.js";
import type { PoolContext } from "./pools.js";
import { createRng, type Rng } from "./rng.js";
import { Structure, StructureRegistry } from "./structures.js";
import { GameTime } from "./time.js";
import { allQuadrants, type FactionKind, type Quadrant } from "./types.js";
import { Weather } from "./weather.js";

export interface World {
  cfg: SnowflowConfig;
  bus: EventBus;
  time: GameTime;
  loop: GameLoop;
  rng: Rng;
  journal: Journal;
  weather: Weather;
  city: City;
  structures: StructureRegistry;
  factions: Map<FactionKind, Faction>;
  director: Director;
  quadrants: Quadrant[];
  poolContext: PoolContext;
}

export function createWorld(cfg: SnowflowConfig, seed = cfg.party.seed): World {
  const bus = new EventBus();
  const time = new GameTime(
    {
      minutesPerDay: cfg.party.minutesPerDay,
      dawnHour: cfg.party.dawnHour,
      duskHour: cfg.party.duskHour,
    },
    bus,
  );
  const loop = new GameLoop(time, bus, cfg.party.loopStepMinutes);
  const journal = new Journal();
  const quadrants = allQuadrants(cfg.party.gridCols, cfg.party.gridRows);

  // Единый источник случайности. Потоки Погоды и Пулов разведены fork-ом,
  // чтобы добавление квадранта в сетку не сдвигало розыгрыши пулов.
  const rng = createRng(seed);
  const weatherRng = rng.fork("погода");
  const poolRng = rng.fork("пулы");

  const weather = new Weather(cfg.weather, weatherRng, cfg.party.gridCols, cfg.party.gridRows);
  const structures = new StructureRegistry();

  // Режиссёр создаётся ниже, но Пулы читают Напряжённость по запросу — ссылка
  // разрешается лениво, чтобы не заводить фиктивную зависимость в конструкторе.
  let director: Director | null = null;

  const poolContext: PoolContext = {
    journal,
    rng: poolRng,
    external: {
      stormAt: (q) => (weather.isStorm(q) ? 1 : 0),
      tension: () => director?.value ?? 0,
    },
    emit: (event, payload) => bus.emit(event, payload),
  };

  const city = new City(cfg.city, poolContext, cfg.party.cityQuadrant, bus);

  cfg.party.scenarioStructures.forEach((row, index) => {
    structures.add(
      new Structure(
        row.kind,
        row.quadrant,
        row.integrity,
        row.domain ?? {},
        cfg.structures,
        poolContext,
        cfg.party.cityQuadrant,
        bus,
        index,
      ),
    );
  });

  const routing = {
    cityQuadrant: () => cfg.party.cityQuadrant,
    structures,
    allQuadrants: quadrants,
    now: () => time.totalMinutes,
  };

  const factions = new Map<FactionKind, Faction>();
  (["свои", "противники", "мародёры"] as FactionKind[]).forEach((kind, index) => {
    factions.set(kind, new Faction(kind, cfg.factions, poolContext, routing, bus, index));
  });

  director = new Director(cfg.director, bus, journal, rng.fork("режиссёр"), {
    panic: () => city.panic,
    trustDelta: () => city.trustDelta,
    cityQuadrant: () => cfg.party.cityQuadrant,
    structures,
    allQuadrants: quadrants,
  });

  // Порядок обхода — константа заметки «Игровой цикл», п.3.
  loop.register(weather);
  loop.register(city);
  for (const structure of structures.items) loop.register(structure);
  for (const faction of factions.values()) loop.register(faction);
  loop.register(director);

  return {
    cfg,
    bus,
    time,
    loop,
    rng,
    journal,
    weather,
    city,
    structures,
    factions,
    director,
    quadrants,
    poolContext,
  };
}
