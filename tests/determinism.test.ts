/**
 * Обязательный тест детерминизма: один сид — побитово идентичный лог прогона.
 *
 * Проверяется на полной сборке партии, а не только на Мире: в лупе крутятся
 * все системы, включая Вышку, Эфир, Газету и Галлюцинации.
 */

import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";
import { createGame, type Game } from "../src/core/game.js";
import { emptyParse, type ParseResponse, type ProxyClient } from "../src/core/proxyClient.js";

const cfg = loadConfig();

/** Заглушка Прокси: в тестах сети нет и ключи не читаются. */
class OfflineProxy implements ProxyClient {
  async parse(): Promise<ParseResponse> {
    return emptyParse(cfg.proxy);
  }
}

function transcript(game: Game): string {
  const facts = game.journal.all.map(
    (f) => `${f.time}|${f.eventType}|${f.subject}|${f.place}|${f.status}|${f.archetypeTag ?? "-"}`,
  );
  const signals = game.broadcast.all.map(
    (s) => `${s.time}|${s.kind}|${s.band}|${s.frequency}|${s.accuracy}|${s.sourceQuadrant}|${s.eventType}`,
  );
  const issues = game.newspaper.all.map((i) => `${i.day}|${i.verdicts.length}|${i.digest.length}`);
  const radioman = game.radioman.state;
  return JSON.stringify({
    minutes: game.time.totalMinutes,
    steps: game.loop.steps,
    facts,
    signals,
    issues,
    weather: game.weather.intervals,
    city: game.city.characteristics,
    tension: game.director.value,
    radioman,
    fuel: game.generator.fuelLeft,
  });
}

function play(seed: number, days: number): Game {
  const game = createGame(cfg, { seed, proxy: new OfflineProxy() });
  const total = days * cfg.party.minutesPerDay;
  // Игрок «действует» детерминированно: попытка настройки каждый час.
  while (game.time.totalMinutes < total && game.loop.isRunning) {
    game.reception.attempt();
    if (game.time.totalMinutes % 240 < cfg.reception.attemptMinutes && game.meal.available) {
      game.meal.eat();
    }
    game.loop.advance(60);
  }
  return game;
}

describe("Детерминизм", () => {
  it("один сид — побитово идентичный лог прогона", () => {
    const a = play(4242, 5);
    const b = play(4242, 5);
    expect(transcript(a)).toBe(transcript(b));
  });

  it("разные сиды дают разные прогоны", () => {
    const a = play(1, 5);
    const b = play(2, 5);
    expect(transcript(a)).not.toBe(transcript(b));
  });

  it("порядок обхода систем в лупе фиксирован и совпадает с заметкой", () => {
    const game = createGame(cfg, { proxy: new OfflineProxy() });
    const order = game.loop.order;
    expect(order[0]).toBe("погода");
    expect(order[1]).toBe("город");
    expect(order.indexOf("режиссёр")).toBeGreaterThan(order.indexOf("фракция:противники"));
    expect(order.indexOf("генератор_эфира")).toBeGreaterThan(order.indexOf("режиссёр"));
    expect(order.indexOf("газета")).toBeGreaterThan(order.indexOf("генератор_эфира"));
    expect(order.indexOf("мостик")).toBeGreaterThan(order.indexOf("газета"));
    expect(order.indexOf("радист")).toBeGreaterThan(order.indexOf("мостик"));
    expect(order.indexOf("галлюцинации")).toBeGreaterThan(order.indexOf("радист"));
    expect(order[order.length - 1]).toBe("финал");
  });

  it("перемотка сном и обычный ход времени дают одинаковое состояние мира", () => {
    const slept = createGame(cfg, { seed: 77, proxy: new OfflineProxy() });
    slept.sleep.sleepUntil(8);

    const awake = createGame(cfg, { seed: 77, proxy: new OfflineProxy() });
    awake.loop.advance(8 * 60);

    expect(slept.time.totalMinutes).toBe(awake.time.totalMinutes);
    expect(slept.journal.all.length).toBe(awake.journal.all.length);
    expect(JSON.stringify(slept.weather.intervals)).toBe(JSON.stringify(awake.weather.intervals));
  });

  it("партия целиком доходит до конца и останавливается по смерти радиста", () => {
    // Обогрев выключен: радист гарантированно замерзает, луп обязан встать.
    const game = createGame(cfg, { seed: 5, proxy: new OfflineProxy() });
    game.generator.setHeating(0);
    for (let i = 0; i < 400 && game.loop.isRunning; i++) game.loop.advance(60);

    expect(game.ending.isOver).toBe(true);
    expect(game.ending.endScreen?.cause).toBe("заморозка");
    expect(game.loop.isRunning).toBe(false);
  });
});
