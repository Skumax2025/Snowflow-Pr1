/**
 * UI Snowflow.
 *
 * Ни одной строки игровой логики: интерфейс только читает состояние ядра
 * и отправляет команды. Собственных игровых данных не хранит — вся его
 * память это позиция тюнера в поле ввода и выбранный сигнал.
 *
 * Визуальный уровень намеренно минимальный: заливки цветом и текстовые
 * подписи, без спрайтов, анимаций и шрифтовых изысков.
 */

import { loadConfig } from "../config/index.js";
import { createGame, type Game } from "../core/game.js";
import type { RevealedDetails } from "../core/signalCheck.js";
import type { SignalId } from "../core/types.js";

const cfg = loadConfig();
const game: Game = createGame(cfg);
void game.anomalyFilter.loadCache();

/** Единственное состояние интерфейса: что выбрано на экране. */
const ui = {
  disclaimerAcknowledged: false,
  selectedSignal: null as SignalId | null,
  lastAttempt: "" as string,
  markMode: "шторм" as "шторм" | "чисто" | "активен" | "мёртв" | "пост",
  wakeHour: 7,
  details: null as RevealedDetails | null,
};

const app = document.getElementById("app") as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

function bar(label: string, value: number, max: number, color: string): HTMLElement {
  const fill = el("div");
  fill.style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
  fill.style.background = color;
  return el("div", {}, [
    el("div", { className: "строка" }, [
      el("span", { textContent: label }),
      el("span", { className: "тусклый", textContent: value.toFixed(1) }),
    ]),
    el("div", { className: "бар" }, [fill]),
  ]);
}

function panel(title: string, children: Array<Node | string>, className = ""): HTMLElement {
  return el("section", { className }, [el("h2", { textContent: title }), ...children]);
}

function hhmm(minutes: number): string {
  const dayMinutes = ((minutes % cfg.party.minutesPerDay) + cfg.party.minutesPerDay) % cfg.party.minutesPerDay;
  const h = Math.floor(dayMinutes / 60);
  const m = Math.floor(dayMinutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function button(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el("button", { textContent: label, disabled });
  b.addEventListener("click", () => {
    onClick();
    render();
  });
  return b;
}

// ── Панели ────────────────────────────────────────────────────────────────

function panelTime(): HTMLElement {
  const now = game.time.moment;
  return panel("Вахта", [
    el("div", {
      textContent: `День ${now.day}, ${hhmm(now.totalMinutes)}, ${now.isNight ? "ночь" : "день"}`,
    }),
    el("div", {
      className: "тусклый",
      textContent: `вышка ${cfg.party.towerQuadrant} · город ${cfg.party.cityQuadrant} · сид ${cfg.party.seed}`,
    }),
  ]);
}

function panelRadioman(): HTMLElement {
  const s = game.radioman.state;
  return panel("Радист", [
    bar("Усталость", s.fatigue, 100, "var(--тревога)"),
    bar("Голод", s.hunger, 100, "var(--тревога)"),
    bar("Тепло", s.warmth, 100, "var(--тепло)"),
    bar("Рассудок", s.sanity, 100, "var(--ровно)"),
    el("div", {
      className: "тусклый",
      textContent: game.radioman.cannotSleep ? "слишком холодно, чтобы заснуть" : "",
    }),
  ]);
}

function panelGenerator(): HTMLElement {
  const level = game.generator.heatingLevel;
  const slider = el("input", { type: "range", min: "0", max: String(cfg.generator.heatingMax), value: String(level) });
  slider.addEventListener("input", () => {
    game.generator.setHeating(Number(slider.value));
    render();
  });
  return panel("Генератор", [
    bar("Топливо", game.generator.fuelLeft, cfg.party.startingFuel, "var(--тепло)"),
    el("div", { className: "строка" }, [
      el("span", { textContent: `Обогрев ${level}` }),
      el("span", {
        className: "тусклый",
        textContent: `баланс тепла ${game.generator.heatBalance().toFixed(3)}/мин`,
      }),
    ]),
    slider,
    el("div", {
      className: "тусклый",
      textContent: `снаружи ${game.generator.effectiveTemperature().toFixed(1)} °C`,
    }),
  ]);
}

function panelReception(): HTMLElement {
  const tuner = el("input", {
    type: "range",
    min: "0",
    max: String(cfg.party.bands.reduce((acc, b) => Math.max(acc, b.to), 0)),
    value: String(game.reception.tunerPosition),
  });
  tuner.addEventListener("input", () => {
    game.reception.setTuner(Number(tuner.value));
    render();
  });

  const position = game.reception.tunerPosition;
  const band = game.reception.bandAt(position) ?? "вне диапазонов";

  return panel("Радиостанция", [
    el("div", { className: "строка" }, [
      el("span", { textContent: `Частота ${position}` }),
      el("span", { className: "тусклый", textContent: band }),
    ]),
    tuner,
    button(
      `Попытка настройки (${cfg.reception.attemptMinutes} мин)`,
      () => {
        const result = game.reception.attempt();
        ui.lastAttempt =
          result.outcome === "заблокировано"
            ? "шторм над вышкой: приём заблокирован"
            : result.outcome === "промах"
              ? "тишина"
              : "сигнал пойман";
        if (result.outcome === "пойман") ui.selectedSignal = result.signalId;
      },
      game.reception.blocked || game.ending.isOver,
    ),
    el("div", { className: "тусклый", textContent: ui.lastAttempt }),
    el("div", {
      className: "тусклый",
      textContent: `известные частоты: метео ${cfg.party.meteoFrequency}, ретрансляторы ${cfg.party.relayFrequency}`,
    }),
  ]);
}

function panelCheck(): HTMLElement {
  const queue = game.signalCheck.queue;
  const buttons = queue.map((id) =>
    button(
      `Проверить ${id} (${cfg.signalCheck.minutes} мин, ${cfg.signalCheck.fuel} топлива)`,
      () => {
        ui.details = game.signalCheck.check(id);
        ui.selectedSignal = id;
      },
      game.ending.isOver,
    ),
  );

  const details = ui.details
    ? el("ul", {}, [
        el("li", { textContent: `что: ${ui.details.eventType.replace(/_/g, " ")}` }),
        el("li", { textContent: `заявленный квадрат: ${ui.details.declaredQuadrant}` }),
        el("li", { textContent: `заявленное расстояние: ${ui.details.declaredDistance}` }),
        el("li", { textContent: `заявленный путь: ${ui.details.declaredRoute}` }),
        el("li", { textContent: `заявленное время: ${hhmm(ui.details.declaredTimestamp)}` }),
        el("li", {
          textContent: `шторм-сверка: в тот момент в этом квадрате шторм ${
            ui.details.stormAtDeclaredMoment ? "был" : "не отмечен"
          }`,
        }),
      ])
    : el("div", { className: "тусклый", textContent: "ничего не проверено" });

  return panel("Проверка сигнала", [
    el("div", { className: "тусклый", textContent: `в очереди: ${queue.length}` }),
    ...buttons,
    details,
  ]);
}

function panelTerminal(): HTMLElement {
  const area = el("textarea", { value: game.terminal.text, placeholder: "текст рапорта" });
  area.addEventListener("input", () => {
    game.terminal.setDraft(area.value);
    render();
  });
  const cost = game.terminal.currentCost;

  return panel("Терминал", [
    area,
    el("div", {
      className: "тусклый",
      textContent: `отправка: ${cost.minutes.toFixed(1)} мин, ${cost.fuel.toFixed(1)} топлива`,
    }),
    button("Отправить", () => game.terminal.send(), !game.terminal.canSend || game.ending.isOver),
  ]);
}

function panelMap(): HTMLElement {
  const grid = el("div", { className: "сетка" });
  grid.style.gridTemplateColumns = `repeat(${cfg.party.gridCols}, 1fr)`;

  for (let row = 0; row < cfg.party.gridRows; row++) {
    for (let col = 0; col < cfg.party.gridCols; col++) {
      const quadrant = `${String.fromCharCode(65 + col)}${row + 1}`;
      const history = game.map.stormHistory(quadrant);
      const last = history[history.length - 1];
      const relay = game.map.relayStatus(quadrant);
      const classes = ["квадрант"];
      if (last?.status === "шторм") classes.push("шторм");
      if (last?.status === "чисто") classes.push("чисто");
      if (quadrant === cfg.party.towerQuadrant) classes.push("вышка");

      const label = `${quadrant}${relay === "активен" ? " Р" : relay === "мёртв" ? " ×" : ""}${
        game.map.hasPost(quadrant) ? " п" : ""
      }`;
      const cell = el("div", { className: classes.join(" "), textContent: label });
      cell.addEventListener("click", () => {
        if (ui.markMode === "шторм" || ui.markMode === "чисто") game.map.markStorm(quadrant, ui.markMode);
        else if (ui.markMode === "пост") game.map.markPost(quadrant);
        else game.map.markRelay(quadrant, ui.markMode);
        render();
      });
      grid.append(cell);
    }
  }

  const modes = (["шторм", "чисто", "активен", "мёртв", "пост"] as const).map((mode) =>
    button(ui.markMode === mode ? `[${mode}]` : mode, () => {
      ui.markMode = mode;
    }),
  );

  const meteo = game.map.digest("метео");
  const relays = game.map.digest("ретрансляторы");

  return panel("Карта", [
    el("div", { className: "тусклый", textContent: "тип метки, затем клик по квадранту" }),
    ...modes,
    grid,
    el("div", { className: "тусклый", textContent: "последние пойманные сводки:" }),
    el("div", {
      className: "тусклый",
      textContent: meteo
        ? `метео (${hhmm(meteo.caughtAt)}): ${(meteo.entries as Array<{ quadrant: string; storm: boolean }>)
            .filter((e) => e.storm)
            .map((e) => e.quadrant)
            .join(", ") || "штормов нет"}`
        : "метеосводка не поймана",
    }),
    el("div", {
      className: "тусклый",
      textContent: relays
        ? `ретрансляторы (${hhmm(relays.caughtAt)}): ${(relays.entries as Array<{ quadrant: string; alive: boolean }>)
            .map((e) => `${e.quadrant}${e.alive ? "+" : "−"}`)
            .join(" ")}`
        : "сводка ретрансляторов не поймана",
    }),
  ]);
}

function panelNewspaper(): HTMLElement {
  const issue = game.newspaper.latest();
  if (!issue) {
    return panel("Газета", [el("div", { className: "тусклый", textContent: "выпуска ещё не было" })]);
  }
  return panel("Газета", [
    el("div", { textContent: `Выпуск, день ${issue.day}` }),
    el("ul", { className: "лог" }, [
      ...issue.verdicts.map((line) => el("li", { textContent: line })),
      ...issue.digest.map((line) => el("li", { className: "тусклый", textContent: line })),
    ]),
    issue.watchTimer
      ? el("div", { className: "тусклый", textContent: issue.watchTimer })
      : el("div"),
  ]);
}

function panelBridge(): HTMLElement {
  const sight = game.bridge.look(game.time.moment);
  const supply = game.bridge.lastDelivery;
  return panel("Мостик", [
    el("div", { textContent: sight.city }),
    el("div", {
      className: "тусклый",
      textContent: `${sight.degraded ? "вид срезан штормом · " : ""}${
        sight.sky.storm ? "над вышкой метёт" : "над вышкой чисто"
      }, ${sight.sky.isNight ? "темно" : "светло"}`,
    }),
    button(
      `Остаться (${cfg.bridge.stayMinutes} мин)`,
      () => game.bridge.stay(),
      game.ending.isOver,
    ),
    button("Уйти с мостика", () => game.bridge.leave()),
    el("div", {
      className: "тусклый",
      textContent: supply
        ? `последняя поставка: ${supply.fuel.toFixed(0)} топлива, ${supply.portions} порций`
        : "поставок ещё не было",
    }),
  ]);
}

function panelRest(): HTMLElement {
  const select = el("select");
  for (let hour = 0; hour < 24; hour++) {
    const option = el("option", { value: String(hour), textContent: `${String(hour).padStart(2, "0")}:00` });
    if (hour === ui.wakeHour) option.selected = true;
    select.append(option);
  }
  select.addEventListener("change", () => {
    ui.wakeHour = Number(select.value);
    render();
  });

  const refusal = game.sleep.refusalFor(ui.wakeHour);

  return panel("Кровать и стол", [
    el("div", { className: "тусклый", textContent: "час пробуждения" }),
    select,
    button("Спать", () => game.sleep.sleepUntil(ui.wakeHour), refusal !== null || game.ending.isOver),
    el("div", {
      className: "тусклый",
      textContent:
        refusal === "холодно"
          ? "слишком холодно, чтобы заснуть"
          : refusal === "слишком_далеко"
            ? `не дальше ${cfg.sleep.maxHours} часов вперёд`
            : "",
    }),
    el("hr"),
    el("div", { textContent: `Порций еды: ${game.meal.count}` }),
    button(
      `Поесть (${cfg.meal.minutes} мин)`,
      () => game.meal.eat(),
      !game.meal.available || game.ending.isOver,
    ),
    el("div", {
      className: "тусклый",
      textContent: game.meal.available ? "" : "нечего есть",
    }),
  ]);
}

function panelVoices(): HTMLElement {
  const voices = game.hallucinations.heardVoices;
  return panel("Эфир между станций", [
    voices.length === 0
      ? el("div", { className: "тусклый", textContent: "тихо" })
      : el(
          "ul",
          { className: "лог" },
          voices
            .slice(-8)
            .map((v) => el("li", { textContent: `${hhmm(v.atMinute)} — ${v.text}` })),
        ),
  ]);
}

function panelEnding(): HTMLElement | null {
  const screen = game.ending.endScreen;
  if (!screen) return null;
  return panel(
    "Конец вахты",
    [
      el("div", { textContent: screen.text }),
      el("ul", {}, [
        el("li", { textContent: `дней прожито: ${screen.summary.days}` }),
        el("li", { textContent: `рапортов обработано: ${screen.summary.reports}` }),
        el("li", { textContent: `подтверждённых утверждений: ${screen.summary.confirmedClaims}` }),
        el("li", {
          textContent: `город на момент конца: ${Object.entries(screen.summary.cityCharacteristics)
            .map(([k, v]) => `${k} ${v.toFixed(0)}`)
            .join(", ")}`,
        }),
      ]),
      button("Начать новую партию", () => window.location.reload()),
    ],
    "финал",
  );
}

// ── Отрисовка ─────────────────────────────────────────────────────────────

function panelDisclaimer(): HTMLElement | null {
  if (!disclaimerText || ui.disclaimerAcknowledged) return null;
  return panel(
    "Прежде чем открыть поле рапорта",
    [
      el("div", { textContent: disclaimerText }),
      button("Понятно", () => {
        ui.disclaimerAcknowledged = true;
      }),
    ],
    "финал",
  );
}

function render(): void {
  app.replaceChildren();
  const disclaimer = panelDisclaimer();
  if (disclaimer) app.append(disclaimer);
  const ending = panelEnding();
  if (ending) app.append(ending);

  app.append(
    panelTime(),
    panelRadioman(),
    panelGenerator(),
    panelReception(),
    panelCheck(),
    panelTerminal(),
    panelMap(),
    panelNewspaper(),
    panelBridge(),
    panelRest(),
    panelVoices(),
  );
}

// Дисклеймер показывается один раз за партию, перед первым открытием поля
// ввода — решение принадлежит Терминалу, UI только показывает текст.
const disclaimerText = game.terminal.openInput();

// Ядро шлёт уведомление о готовом выпуске; UI только перерисовывается.
game.bus.on("выпуск_готов", () => render());

render();
