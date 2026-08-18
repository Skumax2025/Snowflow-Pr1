/**
 * UI Snowflow.
 *
 * Ни одной строки игровой логики: интерфейс только читает состояние ядра
 * и отправляет команды. Собственных игровых данных не хранит — его память
 * это выбранный сигнал, режим метки и состояние часов.
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

interface HealthReport {
  keyPresent: boolean;
  keyHint: string | null;
  model: string;
  reachable: boolean;
  status: number | null;
  detail: string;
  latencyMs: number | null;
}

/** Единственное состояние интерфейса: что выбрано на экране. */
const ui = {
  disclaimerAcknowledged: false,
  selectedSignal: null as SignalId | null,
  lastAttempt: "",
  markMode: "шторм" as "шторм" | "чисто" | "активен" | "мёртв" | "пост" | "стереть",
  wakeHour: 7,
  details: null as RevealedDetails | null,
  speed: cfg.ui.startPaused ? 0 : 1,
  health: null as HealthReport | null,
  healthPending: false,
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

/** Кнопка-переключатель: выбранная подсвечивается, а не гасится. */
function toggle(label: string, onClick: () => void, active: boolean): HTMLButtonElement {
  const b = button(label, onClick);
  if (active) b.classList.add("выбрано");
  return b;
}

// ── Часы реального времени ────────────────────────────────────────────────
//
// Ядро headless и само себя не тикает: часы живут здесь и шлют ровно то же
// «потратить N минут», которое шлют действия игрока. Пауза нужна, чтобы
// читать газету и переносить сводку на карту, не теряя вахту.

let clockTimer: number | null = null;

function applySpeed(): void {
  if (clockTimer !== null) {
    window.clearInterval(clockTimer);
    clockTimer = null;
  }
  if (ui.speed <= 0) return;

  clockTimer = window.setInterval(() => {
    if (!game.loop.isRunning) {
      applyPause();
      render();
      return;
    }
    game.loop.advance(cfg.ui.gameMinutesPerTick * ui.speed);
    render();
  }, cfg.ui.tickMs);
}

function applyPause(): void {
  ui.speed = 0;
  if (clockTimer !== null) {
    window.clearInterval(clockTimer);
    clockTimer = null;
  }
}

// ── Панели ────────────────────────────────────────────────────────────────

function panelTime(): HTMLElement {
  const now = game.time.moment;
  const speedButtons = cfg.ui.speeds.map((speed) =>
    toggle(speed === 0 ? "пауза" : `×${speed}`, () => {
      ui.speed = speed;
      applySpeed();
    }, ui.speed === speed),
  );

  return panel("Вахта", [
    el("div", {
      className: "часы",
      textContent: `День ${now.day} · ${hhmm(now.totalMinutes)} · ${now.isNight ? "ночь" : "день"}`,
    }),
    el("div", { className: "строка" }, speedButtons),
    el("div", {
      className: "тусклый",
      textContent: ui.speed === 0 ? "время остановлено" : `${cfg.ui.gameMinutesPerTick * ui.speed} игровых минут за ${cfg.ui.tickMs} мс`,
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
  const slider = el("input", {
    id: "обогрев",
    type: "range",
    min: "0",
    max: String(cfg.generator.heatingMax),
    value: String(level),
  });
  slider.addEventListener("input", () => {
    game.generator.setHeating(Number(slider.value));
    refreshLabel("обогрев-подпись", `Обогрев ${game.generator.heatingLevel}`);
    refreshLabel("баланс-подпись", `баланс тепла ${game.generator.heatBalance().toFixed(3)}/мин`);
  });

  return panel("Генератор", [
    bar("Топливо", game.generator.fuelLeft, cfg.party.startingFuel, "var(--тепло)"),
    el("div", { className: "строка" }, [
      el("span", { id: "обогрев-подпись", textContent: `Обогрев ${level}` }),
      el("span", {
        id: "баланс-подпись",
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

/** Точечное обновление подписи — чтобы не перерисовывать панель под курсором. */
function refreshLabel(id: string, text: string): void {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

function panelReception(): HTMLElement {
  const maxFrequency = cfg.party.bands.reduce((acc, b) => Math.max(acc, b.to), 0);

  const tuner = el("input", {
    id: "тюнер",
    type: "range",
    min: "0",
    max: String(maxFrequency),
    step: "1",
    value: String(game.reception.tunerPosition),
  });
  const exact = el("input", {
    id: "частота",
    type: "number",
    min: "0",
    max: String(maxFrequency),
    step: "1",
    value: String(game.reception.tunerPosition),
  });

  const syncTuner = (value: number) => {
    game.reception.setTuner(value);
    const position = game.reception.tunerPosition;
    tuner.value = String(position);
    exact.value = String(position);
    refreshLabel("диапазон-подпись", `${position} · ${game.reception.bandAt(position) ?? "вне диапазонов"}`);
  };

  tuner.addEventListener("input", () => syncTuner(Number(tuner.value)));
  exact.addEventListener("input", () => syncTuner(Number(exact.value)));

  const step = (delta: number) =>
    button(delta > 0 ? `+${delta}` : String(delta), () => game.reception.setTuner(game.reception.tunerPosition + delta));

  const jump = (label: string, frequency: number) =>
    button(label, () => game.reception.setTuner(frequency));

  const position = game.reception.tunerPosition;

  return panel("Радиостанция", [
    el("div", {
      id: "диапазон-подпись",
      className: "крупно",
      textContent: `${position} · ${game.reception.bandAt(position) ?? "вне диапазонов"}`,
    }),
    tuner,
    el("div", { className: "строка" }, [exact, step(-20), step(-5), step(5), step(20)]),
    el("div", {}, [
      jump("метео", cfg.party.meteoFrequency),
      jump("ретрансляторы", cfg.party.relayFrequency),
      ...cfg.party.bands.map((b) => jump(b.band, b.from + Math.floor((b.to - b.from) / 2))),
    ]),
    button(
      cfg.reception.attemptMinutes > 0
        ? `Слушать здесь (${cfg.reception.attemptMinutes} мин)`
        : "Слушать здесь",
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
      textContent: `окно приёма ±${cfg.reception.windowWidth} · в эфире сейчас ${game.broadcast.liveSignals().length}`,
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
  const area = el("textarea", {
    id: "рапорт",
    value: game.terminal.text,
    placeholder: "текст рапорта",
  });
  // Полная перерисовка на каждый символ убивала фокус и делала ввод
  // невозможным: здесь обновляется только модель и подпись стоимости.
  area.addEventListener("input", () => {
    game.terminal.setDraft(area.value);
    const cost = game.terminal.currentCost;
    refreshLabel("стоимость-рапорта", `отправка: ${cost.minutes.toFixed(1)} мин, ${cost.fuel.toFixed(1)} топлива`);
    const send = document.getElementById("отправить") as HTMLButtonElement | null;
    if (send) send.disabled = !game.terminal.canSend || game.ending.isOver;
  });

  const cost = game.terminal.currentCost;
  const send = button("Отправить", () => game.terminal.send(), !game.terminal.canSend || game.ending.isOver);
  send.id = "отправить";

  return panel("Терминал", [
    area,
    el("div", {
      id: "стоимость-рапорта",
      className: "тусклый",
      textContent: `отправка: ${cost.minutes.toFixed(1)} мин, ${cost.fuel.toFixed(1)} топлива`,
    }),
    send,
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
      const cell = el("div", {
        className: classes.join(" "),
        textContent: label,
        title: history.length > 0 ? history.map((h) => `${hhmm(h.observedAt)} ${h.status}`).join("\n") : "",
      });
      cell.addEventListener("click", () => {
        if (ui.markMode === "стереть") game.map.clearQuadrant(quadrant);
        else if (ui.markMode === "шторм" || ui.markMode === "чисто") game.map.markStorm(quadrant, ui.markMode);
        else if (ui.markMode === "пост") game.map.markPost(quadrant);
        else game.map.markRelay(quadrant, ui.markMode);
        render();
      });
      grid.append(cell);
    }
  }

  const modes = (["шторм", "чисто", "активен", "мёртв", "пост", "стереть"] as const).map((mode) =>
    toggle(mode, () => {
      ui.markMode = mode;
    }, ui.markMode === mode),
  );

  const meteo = game.map.digest("метео");
  const relays = game.map.digest("ретрансляторы");

  return panel("Карта", [
    el("div", { className: "тусклый", textContent: "выбери тип метки, затем кликай по квадрантам" }),
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
    issue.watchTimer ? el("div", { className: "тусклый", textContent: issue.watchTimer }) : el("div"),
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
    button(`Остаться (${cfg.bridge.stayMinutes} мин)`, () => game.bridge.stay(), game.ending.isOver),
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
  const select = el("select", { id: "час-пробуждения" });
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
    button(`Поесть (${cfg.meal.minutes} мин)`, () => game.meal.eat(), !game.meal.available || game.ending.isOver),
    el("div", { className: "тусклый", textContent: game.meal.available ? "" : "нечего есть" }),
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
          voices.slice(-8).map((v) => el("li", { textContent: `${hhmm(v.atMinute)} — ${v.text}` })),
        ),
  ]);
}

/** Диагностика: доедет ли рапорт до модели или партия идёт в деградации. */
function panelHealth(): HTMLElement {
  const report = ui.health;
  const lines: Array<Node | string> = [];

  if (ui.healthPending) {
    lines.push(el("div", { className: "тусклый", textContent: "проверяю…" }));
  } else if (!report) {
    lines.push(
      el("div", {
        className: "тусклый",
        textContent: "статус связи неизвестен. Без связи игра работает: разбор рапорта уходит в деградированный режим.",
      }),
    );
  } else {
    lines.push(
      el("div", {
        className: report.reachable ? "хорошо" : "плохо",
        textContent: report.reachable ? "связь есть" : "связи нет",
      }),
      el("div", { className: "тусклый", textContent: report.detail }),
      el("div", {
        className: "тусклый",
        textContent:
          `модель ${report.model} · ключ ${report.keyPresent ? (report.keyHint ?? "задан") : "не задан"}` +
          (report.status !== null ? ` · ответ ${report.status}` : "") +
          (report.latencyMs !== null ? ` · ${report.latencyMs} мс` : ""),
      }),
    );
  }

  return panel("Связь с Gemini", [
    ...lines,
    button("Проверить связь", () => {
      ui.healthPending = true;
      void fetch("/api/health")
        .then((r) => r.json() as Promise<HealthReport>)
        .then((data) => {
          ui.health = data;
        })
        .catch(() => {
          ui.health = {
            keyPresent: false,
            keyHint: null,
            model: cfg.proxy.model,
            reachable: false,
            status: null,
            detail: "Эндпоинт /api/health недоступен. В режиме npm run dev он поднимается плагином, на Vercel — платформой.",
            latencyMs: null,
          };
        })
        .finally(() => {
          ui.healthPending = false;
          render();
        });
    }, ui.healthPending),
  ]);
}

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

function render(): void {
  // Часы перерисовывают экран дважды в секунду, а игрок в это время печатает
  // рапорт или ведёт ползунок. Фокус и каретку приходится восстанавливать
  // руками: иначе ввод физически невозможен.
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const activeId = active?.id || null;
  const selectionStart = active?.selectionStart ?? null;
  const selectionEnd = active?.selectionEnd ?? null;
  const scroll = window.scrollY;

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
    panelHealth(),
  );

  if (activeId) {
    const restored = document.getElementById(activeId) as HTMLInputElement | null;
    if (restored) {
      restored.focus();
      if (selectionStart !== null && typeof restored.setSelectionRange === "function") {
        try {
          restored.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
        } catch {
          // Числовые поля селекцию не поддерживают — не беда.
        }
      }
    }
  }
  window.scrollTo(0, scroll);
}

// Дисклеймер показывается один раз за партию, перед первым открытием поля
// ввода — решение принадлежит Терминалу, UI только показывает текст.
const disclaimerText = game.terminal.openInput();

// Ядро шлёт уведомление о готовом выпуске; UI только перерисовывается.
game.bus.on("выпуск_готов", () => render());

render();
applySpeed();
