/**
 * Терминал — единственный канал влияния игрока на мир, кроме настройки радио.
 *
 * Печатание времени не тратит: весь расход применяется одним куском в момент
 * отправки. Отправка — точка невозврата без окна подтверждения и без
 * состояния загрузки: Терминал не видит и не ждёт ответа Парсера.
 */

import type { TerminalConfig } from "../config/types.js";
import type { EventBus } from "./bus.js";
import { EV, type FuelPayload, type ReportSentPayload, type SpendMinutesPayload } from "./events.js";

export class Terminal {
  private draft = "";
  private disclaimerShown = false;

  constructor(
    private readonly cfg: TerminalConfig,
    private readonly bus: EventBus,
  ) {}

  /**
   * Открытие поля ввода. Дисклеймер показывается один раз за партию — перед
   * самым первым открытием, а не перед первой отправкой.
   */
  openInput(): string | null {
    if (this.disclaimerShown) return null;
    this.disclaimerShown = true;
    return this.cfg.disclaimer;
  }

  setDraft(text: string): void {
    this.draft = text;
  }

  get text(): string {
    return this.draft;
  }

  /** Пустой рапорт: кнопка «отправить» неактивна, пока поле пустое. */
  get canSend(): boolean {
    return this.draft.trim().length > 0;
  }

  costOf(text: string): { minutes: number; fuel: number } {
    const length = text.length;
    return {
      minutes: this.cfg.fixedMinutes + this.cfg.minutesPerChar * length,
      fuel: this.cfg.fixedFuel + this.cfg.fuelPerChar * length,
    };
  }

  /** Ориентировочная стоимость текущего черновика — для UI. */
  get currentCost(): { minutes: number; fuel: number } {
    return this.costOf(this.draft);
  }

  send(): boolean {
    if (!this.canSend) return false;
    const text = this.draft;
    const cost = this.costOf(text);

    // Три события синхронно на одном клике; порядок между собой не важен.
    this.bus.emit<ReportSentPayload>(EV.REPORT_SENT, { text });
    this.bus.emit<FuelPayload>(EV.SPEND_FUEL, { amount: cost.fuel, source: "терминал" });
    this.bus.emit<SpendMinutesPayload>(EV.SPEND_MINUTES, { minutes: cost.minutes, source: "терминал" });

    this.draft = "";
    return true;
  }
}
