import type { ChannelIdentity } from "./identity.js";

// Кто и что может делать в боте до того, как поделился телефоном.
//
// Правило заказчика: без номера доступны только «Программа и тарифы» и FAQ. Всё остальное —
// покупка, партнёрская программа, бонусы, связь с менеджером — открывается после того, как
// человек поделился контактом.
//
// Проверка отделена от сценария покупки намеренно: в orders.ts телефон уже проверяется, но
// это последний рубеж, на котором заказ просто не создастся. Человек к этому моменту успевает
// выбрать тариф, ввести количество и упереться в отказ — а узнать об условии он должен раньше.

export type TelegramPhoneStatus = "unknown" | "imported" | "verified" | "rejected";

export interface TelegramPhoneStatusRepository {
  /** Возвращает null, если такого пользователя в базе ещё нет. */
  findPhoneStatus(identity: ChannelIdentity): Promise<TelegramPhoneStatus | null>;
}

export interface TelegramPhoneAccessResult {
  readonly unlocked: boolean;
}

export class CheckTelegramPhoneAccessService {
  constructor(private readonly repository: TelegramPhoneStatusRepository) {}

  async execute(query: ChannelIdentity): Promise<TelegramPhoneAccessResult> {
    const status = await this.repository.findPhoneStatus(query);
    return { unlocked: isPhoneUsable(status) };
  }
}

// Тот же критерий, что и в HandleTelegramStartService: `imported` — это номер, пришедший из
// старой базы, он тоже считается известным. Незнакомый пользователь (null) телефона точно не
// давал.
export function isPhoneUsable(status: TelegramPhoneStatus | null): boolean {
  return status === "verified" || status === "imported";
}
