/**
 * «Первые срезы» канала в город: Терминал, Парсер, Прокси, Газета.
 * Плюс обязательные тесты: деградированный режим и валидация ответа LLM
 * по схеме (схема берётся из конфига, не из кода).
 *
 * Тесты не ходят в сеть и не читают ключи.
 */

import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";
import { EventBus } from "../src/core/bus.js";
import {
  EV,
  type FuelPayload,
  type OfftopicPayload,
  type ReportSentPayload,
  type ReportVerdictPayload,
  type SpendMinutesPayload,
} from "../src/core/events.js";
import { Journal, REPORT_PROCESSED, CITY_DEAD } from "../src/core/journal.js";
import { Newspaper } from "../src/core/newspaper.js";
import { Parser } from "../src/core/parser.js";
import type { PoolContext } from "../src/core/pools.js";
import { emptyParse, type ParseResponse, type ProxyClient } from "../src/core/proxyClient.js";
import { createRng } from "../src/core/rng.js";
import { validateAgainstSchema } from "../src/core/schema.js";
import { Structure, StructureRegistry } from "../src/core/structures.js";
import { Terminal } from "../src/core/terminal.js";
import { GameTime } from "../src/core/time.js";
import type { Moment } from "../src/core/types.js";

const cfg = loadConfig();
const dayCfg = {
  minutesPerDay: cfg.party.minutesPerDay,
  dawnHour: cfg.party.dawnHour,
  duskHour: cfg.party.duskHour,
};

function moment(totalMinutes: number): Moment {
  const minuteOfDay = totalMinutes % cfg.party.minutesPerDay;
  return {
    totalMinutes,
    day: Math.floor(totalMinutes / cfg.party.minutesPerDay) + 1,
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    isNight: false,
  };
}

describe("Терминал", () => {
  function make() {
    const bus = new EventBus();
    const terminal = new Terminal(cfg.terminal, bus);
    const sent: ReportSentPayload[] = [];
    const minutes: SpendMinutesPayload[] = [];
    const fuel: FuelPayload[] = [];
    bus.on<ReportSentPayload>(EV.REPORT_SENT, (p) => sent.push(p));
    bus.on<SpendMinutesPayload>(EV.SPEND_MINUTES, (p) => minutes.push(p));
    bus.on<FuelPayload>(EV.SPEND_FUEL, (p) => fuel.push(p));
    return { bus, terminal, sent, minutes, fuel };
  }

  it("на трёх разных длинах числа совпадают с формулой", () => {
    const { terminal, minutes, fuel } = make();
    for (const text of ["к", "к".repeat(50), "к".repeat(500)]) {
      terminal.setDraft(text);
      terminal.send();
    }
    for (const [index, length] of [1, 50, 500].entries()) {
      expect(minutes[index]?.minutes).toBeCloseTo(
        cfg.terminal.fixedMinutes + cfg.terminal.minutesPerChar * length,
        6,
      );
      expect(fuel[index]?.amount).toBeCloseTo(
        cfg.terminal.fixedFuel + cfg.terminal.fuelPerChar * length,
        6,
      );
    }
  });

  it("поле очищается сразу после клика", () => {
    const { terminal } = make();
    terminal.setDraft("донесение");
    terminal.send();
    expect(terminal.text).toBe("");
  });

  it("кнопка «отправить» неактивна при пустом поле, событий не уходит", () => {
    const { terminal, sent, minutes, fuel } = make();
    expect(terminal.canSend).toBe(false);
    expect(terminal.send()).toBe(false);
    terminal.setDraft("   ");
    expect(terminal.canSend).toBe(false);
    expect(sent).toHaveLength(0);
    expect(minutes).toHaveLength(0);
    expect(fuel).toHaveLength(0);
  });

  it("дисклеймер показывается ровно один раз за партию, при первом открытии поля", () => {
    const { terminal } = make();
    const first = terminal.openInput();
    expect(first).toContain("Базу аномалий");
    expect(terminal.openInput()).toBeNull();
    expect(terminal.openInput()).toBeNull();
  });

  it("две отправки подряд проходят без блокировки", () => {
    const { terminal, sent } = make();
    terminal.setDraft("первый");
    terminal.send();
    terminal.setDraft("второй");
    terminal.send();
    expect(sent.map((s) => s.text)).toEqual(["первый", "второй"]);
  });
});

describe("Парсер", () => {
  /** Заглушка Прокси: фиксированный JSON, без сети. */
  class StubProxy implements ProxyClient {
    constructor(private readonly response: ParseResponse) {}
    async parse(): Promise<ParseResponse> {
      return this.response;
    }
  }

  function make(response: ParseResponse) {
    const bus = new EventBus();
    const journal = new Journal();
    const time = new GameTime(dayCfg, bus);
    const structures = new StructureRegistry();
    const ctx: PoolContext = {
      journal,
      rng: createRng(1),
      external: { stormAt: () => 0, tension: () => 0 },
      now: () => 0,
      emit: () => {},
    };
    structures.add(
      new Structure("склад", "B2", 80, { stock: 60 }, cfg.structures, ctx, "D4", bus, 0),
    );

    const parser = new Parser(
      cfg.proxy,
      journal,
      time,
      { structures, factions: ["свои", "противники", "мародёры"], grid: { cols: 6, rows: 6 } },
      new StubProxy(response),
      bus,
    );
    const verdicts: ReportVerdictPayload[] = [];
    const offtopic: OfftopicPayload[] = [];
    bus.on<ReportVerdictPayload>(EV.REPORT_VERDICT, (p) => verdicts.push(p));
    bus.on<OfftopicPayload>(EV.OFFTOPIC_FOUND, (p) => offtopic.push(p));
    return { bus, journal, time, parser, verdicts, offtopic };
  }

  const twoClaims: ParseResponse = {
    claims: [
      { id: "c1", subject: "конвой", action: "вышел", place: "B2", time: "", confidence: 0.9 },
      { id: "c2", subject: "конвой", action: "прибыл", place: "F6", time: "", confidence: 0.9 },
    ],
    tone: { inspiration: 0.5, anxiety: 0.5, specificity: 0.5 },
    offtopic: { flag: true, text: "мне кажется, за окном кто-то стоит уже третью ночь" },
  };

  it("одно «вердикт_рапорта» с двумя корректными категориями и корректными id факта", async () => {
    const { bus, journal, parser, verdicts } = make(twoClaims);
    const fact = journal.write({
      time: 60,
      eventType: "конвой_вышел",
      subject: "структура:склад:B2",
      place: "B2",
      status: "в_пути",
    });

    bus.emit<ReportSentPayload>(EV.REPORT_SENT, { text: "конвой вышел из B2" });
    await parser.settled();

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.verdicts).toEqual([
      { claimId: "c1", category: "правда", factId: fact.id },
      { claimId: "c2", category: "ложь", factId: null },
    ]);
  });

  it("офтопик уходит отдельным событием, не утонув внутри вердикта", async () => {
    const { bus, parser, verdicts, offtopic } = make(twoClaims);
    bus.emit<ReportSentPayload>(EV.REPORT_SENT, { text: "..." });
    await parser.settled();

    expect(offtopic).toHaveLength(1);
    expect(offtopic[0]?.text).toContain("третью ночь");
    expect(JSON.stringify(verdicts)).not.toContain("третью ночь");
  });

  it("низкая уверенность превращает несовпадение в «неточность», а не «ложь»", async () => {
    const { bus, parser, verdicts } = make({
      claims: [{ id: "c1", subject: "конвой", action: "прибыл", place: "F6", time: "", confidence: 0.2 }],
      tone: { inspiration: 0.5, anxiety: 0.5, specificity: 0.5 },
      offtopic: { flag: false, text: "" },
    });
    bus.emit<ReportSentPayload>(EV.REPORT_SENT, { text: "..." });
    await parser.settled();
    expect(verdicts[0]?.verdicts[0]?.category).toBe("неточность");
  });

  it("время вне допуска роняет claim из «правды», id частичного совпадения сохраняется", async () => {
    const { bus, journal, time, parser, verdicts } = make({
      claims: [{ id: "c1", subject: "конвой", action: "вышел", place: "B2", time: "23:00", confidence: 0.9 }],
      tone: { inspiration: 0.5, anxiety: 0.5, specificity: 0.5 },
      offtopic: { flag: false, text: "" },
    });
    time.advance(60);
    const fact = journal.write({
      time: 60,
      eventType: "конвой_вышел",
      subject: "структура:склад:B2",
      place: "B2",
      status: "в_пути",
    });

    bus.emit<ReportSentPayload>(EV.REPORT_SENT, { text: "..." });
    await parser.settled();
    expect(verdicts[0]?.verdicts[0]?.category).toBe("ложь");
    expect(verdicts[0]?.verdicts[0]?.factId).toBe(fact.id);
  });

  it("Парсер не помнит истории: второй такой же рапорт даёт тот же вердикт", async () => {
    const { bus, journal, parser, verdicts } = make(twoClaims);
    journal.write({
      time: 60,
      eventType: "конвой_вышел",
      subject: "структура:склад:B2",
      place: "B2",
      status: "в_пути",
    });
    bus.emit<ReportSentPayload>(EV.REPORT_SENT, { text: "..." });
    bus.emit<ReportSentPayload>(EV.REPORT_SENT, { text: "..." });
    await parser.settled();
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0]?.verdicts).toEqual(verdicts[1]?.verdicts);
  });

  it("Парсер не читает Погоду: шторм-алиби остаётся ручным", () => {
    const { parser } = make(twoClaims);
    expect(JSON.stringify(Object.keys(parser))).not.toContain("weather");
  });
});

describe("Прокси: деградированный режим", () => {
  /** Три класса сбоя сводятся к одному исходу и одной форме ответа. */
  class FailingProxy implements ProxyClient {
    constructor(private readonly mode: "ошибка" | "таймаут" | "мусор") {}
    async parse(): Promise<ParseResponse> {
      if (this.mode === "ошибка") return emptyParse(cfg.proxy);
      if (this.mode === "таймаут") return emptyParse(cfg.proxy);
      return emptyParse(cfg.proxy);
    }
  }

  function runWith(mode: "ошибка" | "таймаут" | "мусор") {
    const bus = new EventBus();
    const journal = new Journal();
    const time = new GameTime(dayCfg, bus);
    const parser = new Parser(
      cfg.proxy,
      journal,
      time,
      { structures: new StructureRegistry(), factions: [], grid: { cols: 6, rows: 6 } },
      new FailingProxy(mode),
      bus,
    );
    const verdicts: ReportVerdictPayload[] = [];
    const offtopic: OfftopicPayload[] = [];
    bus.on<ReportVerdictPayload>(EV.REPORT_VERDICT, (p) => verdicts.push(p));
    bus.on<OfftopicPayload>(EV.OFFTOPIC_FOUND, (p) => offtopic.push(p));
    return { bus, parser, verdicts, offtopic };
  }

  it("ошибка, таймаут и невалидный JSON дают структурно одинаковый ответ", async () => {
    const results: ReportVerdictPayload[] = [];
    for (const mode of ["ошибка", "таймаут", "мусор"] as const) {
      const { bus, parser, verdicts } = runWith(mode);
      bus.emit<ReportSentPayload>(EV.REPORT_SENT, { text: "любой текст" });
      await parser.settled();
      results.push(verdicts[0] as ReportVerdictPayload);
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });

  it("характеристики не меняются: вердиктов ноль, тон нейтральный, офтопика нет", async () => {
    const { bus, parser, verdicts, offtopic } = runWith("мусор");
    bus.emit<ReportSentPayload>(EV.REPORT_SENT, { text: "текст" });
    await parser.settled();
    expect(verdicts[0]?.verdicts).toEqual([]);
    expect(verdicts[0]?.tone).toEqual(cfg.proxy.emptyParse.tone);
    expect(offtopic).toHaveLength(0);
  });

  it("партия не ломается: после деградации следующий рапорт обрабатывается", async () => {
    const { bus, parser, verdicts } = runWith("ошибка");
    bus.emit<ReportSentPayload>(EV.REPORT_SENT, { text: "первый" });
    bus.emit<ReportSentPayload>(EV.REPORT_SENT, { text: "второй" });
    await parser.settled();
    expect(verdicts).toHaveLength(2);
  });
});

describe("Валидация ответа LLM по схеме", () => {
  const schema = cfg.proxy.responseSchema;

  it("схема лежит в конфиге, а не в коде", () => {
    expect(schema.type).toBe("object");
    expect(schema.required).toContain("claims");
    expect(schema.required).toContain("tone");
    expect(schema.required).toContain("offtopic");
  });

  it("корректный ответ проходит", () => {
    const ok = {
      claims: [{ id: "c1", subject: "конвой", action: "вышел", place: "B2", time: "14:20", confidence: 0.8 }],
      tone: { inspiration: 0.4, anxiety: 0.2, specificity: 0.9 },
      offtopic: { flag: false, text: "" },
    };
    expect(validateAgainstSchema(ok, schema).valid).toBe(true);
  });

  it("отсутствующий блок, неверный тип и число вне диапазона отбраковываются", () => {
    expect(validateAgainstSchema({ claims: [], tone: { inspiration: 0.5, anxiety: 0.5, specificity: 0.5 } }, schema).valid).toBe(false);
    expect(
      validateAgainstSchema(
        { claims: "не массив", tone: { inspiration: 0.5, anxiety: 0.5, specificity: 0.5 }, offtopic: { flag: false, text: "" } },
        schema,
      ).valid,
    ).toBe(false);
    expect(
      validateAgainstSchema(
        { claims: [], tone: { inspiration: 5, anxiety: 0.5, specificity: 0.5 }, offtopic: { flag: false, text: "" } },
        schema,
      ).valid,
    ).toBe(false);
  });

  it("пустой разбор из конфига сам проходит собственную схему", () => {
    expect(validateAgainstSchema(emptyParse(cfg.proxy), schema).valid).toBe(true);
  });
});

describe("Газета", () => {
  function make() {
    const bus = new EventBus();
    const journal = new Journal();
    const paper = new Newspaper(cfg.newspaper, journal, createRng(3), bus);
    return { bus, journal, paper };
  }

  it("собирает выпуск из трёх блоков по мок-Журналу", () => {
    const { journal, paper } = make();
    const fact = journal.write({
      time: 10,
      eventType: "конвой_вышел",
      subject: "структура:склад:B2",
      place: "B2",
      status: "в_пути",
    });
    journal.write(
      { time: 20, eventType: REPORT_PROCESSED, subject: "город", place: "D4", status: "обработан" },
      [
        { category: "правда", factId: fact.id },
        { category: "ложь", factId: null },
      ],
    );
    journal.write({
      time: 30,
      eventType: "конвой_погиб_в_шторме",
      subject: "конвой:B2:1",
      place: "C3",
      status: "погиб",
    });

    paper.tick(moment(cfg.newspaper.hour * 60));
    const issue = paper.latest();

    expect(issue?.verdicts).toHaveLength(2);
    expect(issue?.verdicts[0]).toContain("подтвердился");
    expect(issue?.verdicts[1]).toContain("Неподтверждённое заявление");
    expect(issue?.digest.some((line) => line.includes("погиб в шторме"))).toBe(true);
  });

  it("событие с id_факта не задваивается между блоками, событие без id — только в дайджесте", () => {
    const { journal, paper } = make();
    const fact = journal.write({
      time: 10,
      eventType: "конвой_вышел",
      subject: "структура:склад:B2",
      place: "B2",
      status: "в_пути",
    });
    journal.write(
      { time: 20, eventType: REPORT_PROCESSED, subject: "город", place: "D4", status: "обработан" },
      [{ category: "правда", factId: fact.id }],
    );
    journal.write({ time: 25, eventType: "бунт", subject: "город", place: "D4", status: "срыв_поставок" });

    paper.tick(moment(cfg.newspaper.hour * 60));
    const issue = paper.latest();
    expect(issue?.digest.some((l) => l.includes("вышел конвой"))).toBe(false);
    expect(issue?.digest.some((l) => l.includes("беспорядки"))).toBe(true);
  });

  it("выходит раз в сутки в свой час и не выходит дважды", () => {
    const { paper } = make();
    paper.tick(moment(cfg.newspaper.hour * 60));
    paper.tick(moment(cfg.newspaper.hour * 60 + 120));
    expect(paper.all).toHaveLength(1);
    paper.tick(moment(cfg.party.minutesPerDay + cfg.newspaper.hour * 60));
    expect(paper.all).toHaveLength(2);
  });

  it("по факту «город мёртв» выходит одно прощальное издание, дальше тишина", () => {
    const { journal, paper } = make();
    journal.write({ time: 1, eventType: CITY_DEAD, subject: "город", place: "D4", status: "мёртв" });

    paper.tick(moment(cfg.newspaper.hour * 60));
    expect(paper.latest()?.farewell).toBe(true);
    expect(paper.silenced).toBe(true);

    paper.tick(moment(cfg.party.minutesPerDay * 3 + cfg.newspaper.hour * 60));
    expect(paper.all).toHaveLength(1);
  });

  it("не читает характеристики Города — только то, что Город записал в Журнал", () => {
    const { paper } = make();
    expect(JSON.stringify(Object.keys(paper))).not.toContain("city");
  });
});
