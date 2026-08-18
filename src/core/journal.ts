/**
 * Журнал фактов — сырой лог всего, что произошло в симулируемом мире.
 *
 * Не оценивает и не решает, кто мог это услышать. Видимость здесь не хранится
 * принципиально — её на лету считает Генератор эфира. Погода в Журнал не пишет.
 * Ретеншн: всё хранится всю партию, ничего не чистится.
 */

import type { FactId, Quadrant } from "./types.js";

/** Единственное значение тега архетипа на сегодня — «агрессивное». */
export type ArchetypeTag = "агрессивное" | null;

export interface FactRecord {
  readonly id: FactId;
  /** Метка времени партии, минуты. */
  readonly time: number;
  readonly eventType: string;
  /** Кто именно: «Склад №4», «Конвой №7», «Фракция:Противники»… */
  readonly subject: string;
  /** Обязателен для всех источников — иначе запись нечем озвучить. */
  readonly place: Quadrant;
  readonly status: string;
  readonly participants: string[];
  readonly archetypeTag: ArchetypeTag;
}

export interface FactDraft {
  time: number;
  eventType: string;
  subject: string;
  place: Quadrant;
  status: string;
  participants?: string[];
  archetypeTag?: ArchetypeTag;
}

export interface FactQuery {
  /** Включительно. */
  fromTime?: number;
  /** Исключительно. */
  toTime?: number;
  place?: Quadrant;
  subject?: string;
  eventType?: string;
  archetypeTag?: ArchetypeTag;
}

/** Тип агрегатной записи, которую пишет Город на каждое «вердикт_рапорта». */
export const REPORT_PROCESSED = "рапорт_обработан";
/** Факт, по которому Мостик, Газета и Финал узнают о смерти Города. */
export const CITY_DEAD = "город_мёртв";

export class Journal {
  private records: FactRecord[] = [];
  private counter = 0;

  /**
   * Дополнительная полезная нагрузка агрегатных записей «рапорт обработан»:
   * список {категория, id_факта|null} по каждому claim. Хранится рядом с
   * записью, а не в её полях, чтобы формат записи оставался плоским и общим.
   */
  private payloads = new Map<FactId, unknown>();

  write(draft: FactDraft, payload?: unknown): FactRecord {
    this.counter += 1;
    const record: FactRecord = {
      id: `f${this.counter}`,
      time: draft.time,
      eventType: draft.eventType,
      subject: draft.subject,
      place: draft.place,
      status: draft.status,
      participants: draft.participants ?? [],
      archetypeTag: draft.archetypeTag ?? null,
    };
    this.records.push(record);
    if (payload !== undefined) this.payloads.set(record.id, payload);
    return record;
  }

  payloadOf(id: FactId): unknown {
    return this.payloads.get(id);
  }

  byId(id: FactId): FactRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  query(filter: FactQuery = {}): FactRecord[] {
    return this.records.filter((r) => {
      if (filter.fromTime !== undefined && r.time < filter.fromTime) return false;
      if (filter.toTime !== undefined && r.time >= filter.toTime) return false;
      if (filter.place !== undefined && r.place !== filter.place) return false;
      if (filter.subject !== undefined && r.subject !== filter.subject) return false;
      if (filter.eventType !== undefined && r.eventType !== filter.eventType) return false;
      if (filter.archetypeTag !== undefined && r.archetypeTag !== filter.archetypeTag) return false;
      return true;
    });
  }

  /** Точечный поиск факта «город мёртв» — Мостик, Газета, Финал. */
  hasCityDead(): boolean {
    return this.records.some((r) => r.eventType === CITY_DEAD);
  }

  /** Поле «место» свежих записей — читают Фракции и Режиссёр. */
  recentPlaces(fromTime: number): Quadrant[] {
    const places: Quadrant[] = [];
    for (const r of this.records) {
      if (r.time >= fromTime) places.push(r.place);
    }
    return places;
  }

  get all(): readonly FactRecord[] {
    return this.records;
  }

  get size(): number {
    return this.records.length;
  }
}
