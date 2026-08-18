/**
 * «Первый срез» заметки «Журнал фактов».
 *
 * Склад порождает одно событие «конвой вышел» → Журнал принимает и хранит
 * запись → её находят выборкой за последний час. Отдельно: запись с тегом
 * «агрессивное» находится выборкой по тегу.
 */

import { describe, expect, it } from "vitest";
import { Journal, CITY_DEAD } from "../src/core/journal.js";

describe("Журнал фактов", () => {
  it("принимает запись Склада и находит её выборкой по времени, субъекту и тегу", () => {
    const journal = new Journal();
    journal.write({
      time: 120,
      eventType: "конвой_вышел",
      subject: "склад:B2",
      place: "B2",
      status: "в_пути",
    });

    expect(journal.query({ fromTime: 60 })).toHaveLength(1);
    expect(journal.query({ subject: "склад:B2" })).toHaveLength(1);
    expect(journal.query({ eventType: "конвой_вышел" })).toHaveLength(1);
    expect(journal.query({ fromTime: 200 })).toHaveLength(0);
  });

  it("находит запись с тегом «агрессивное» выборкой по тегу", () => {
    const journal = new Journal();
    journal.write({ time: 10, eventType: "болтовня", subject: "пост:A4", place: "A4", status: "в_эфире" });
    journal.write({
      time: 20,
      eventType: "атака",
      subject: "фракция:противники",
      place: "D4",
      status: "нанесена",
      archetypeTag: "агрессивное",
    });

    const aggressive = journal.query({ archetypeTag: "агрессивное" });
    expect(aggressive).toHaveLength(1);
    expect(aggressive[0]?.eventType).toBe("атака");
  });

  it("выдаёт уникальные id и хранит записи всю партию", () => {
    const journal = new Journal();
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) {
      ids.add(journal.write({ time: i, eventType: "тик", subject: "s", place: "A1", status: "ок" }).id);
    }
    expect(ids.size).toBe(500);
    expect(journal.size).toBe(500);
    expect(journal.query({ fromTime: 0 })).toHaveLength(500);
  });

  it("отдаёт поле «место» свежих записей — то, что читают Фракции", () => {
    const journal = new Journal();
    journal.write({ time: 10, eventType: "a", subject: "s", place: "A1", status: "ок" });
    journal.write({ time: 100, eventType: "b", subject: "s", place: "D4", status: "ок" });
    expect(journal.recentPlaces(50)).toEqual(["D4"]);
  });

  it("хранит полезную нагрузку агрегатной записи рядом, не ломая плоский формат", () => {
    const journal = new Journal();
    const rec = journal.write(
      { time: 5, eventType: "рапорт_обработан", subject: "город", place: "D4", status: "обработан" },
      [{ category: "правда", factId: "f1" }],
    );
    expect(journal.payloadOf(rec.id)).toEqual([{ category: "правда", factId: "f1" }]);
    expect(rec).not.toHaveProperty("payload");
  });

  it("находит факт «город мёртв» точечным поиском", () => {
    const journal = new Journal();
    expect(journal.hasCityDead()).toBe(false);
    journal.write({ time: 1, eventType: CITY_DEAD, subject: "город", place: "D4", status: "мёртв" });
    expect(journal.hasCityDead()).toBe(true);
  });
});
