/**
 * Шина событий ядра.
 *
 * Там, где контракт заметки говорит «шлёт событие», системы не вызывают друг
 * друга напрямую — они публикуют событие с каноническим именем из словаря
 * мастер-концепта (раздел 13). Прямые вызовы допустимы только там, где
 * контракт говорит «читает по запросу».
 *
 * Доставка синхронная и в порядке подписки: очередь событий делала бы прогон
 * зависимым от порядка вытеснения, а он должен быть побитово воспроизводим.
 */

export type EventHandler<P> = (payload: P) => void;

export interface BusRecord {
  readonly name: string;
  readonly payload: unknown;
}

export class EventBus {
  private handlers = new Map<string, Array<EventHandler<never>>>();
  private trace: BusRecord[] | null = null;

  on<P>(name: string, handler: EventHandler<P>): () => void {
    const list = this.handlers.get(name) ?? [];
    list.push(handler as EventHandler<never>);
    this.handlers.set(name, list);
    return () => {
      const current = this.handlers.get(name);
      if (!current) return;
      const idx = current.indexOf(handler as EventHandler<never>);
      if (idx >= 0) current.splice(idx, 1);
    };
  }

  emit<P>(name: string, payload: P): void {
    if (this.trace) this.trace.push({ name, payload });
    const list = this.handlers.get(name);
    if (!list || list.length === 0) return;
    // Копия: обработчик вправе отписаться прямо во время доставки.
    for (const handler of [...list]) {
      (handler as EventHandler<P>)(payload);
    }
  }

  /** Включает запись всех событий — используется тестами детерминизма и Стендом. */
  startTrace(): void {
    this.trace = [];
  }

  stopTrace(): BusRecord[] {
    const result = this.trace ?? [];
    this.trace = null;
    return result;
  }

  getTrace(): readonly BusRecord[] {
    return this.trace ?? [];
  }
}
