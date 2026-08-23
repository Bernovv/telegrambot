import type { AttachmentKind } from "@ticket-platform/messenger-core";

/**
 * Что нашему коду нужно от WhatsApp — и ничего сверх этого.
 *
 * У MAX клиент протокола написан своими руками: официального API нет, а нужно нам шесть
 * вызовов. Здесь так нельзя. Переписка в WhatsApp шифруется сигнальным протоколом, ключи
 * живут в сессии и меняются после каждого сообщения; писать это самим — месяц работы и
 * своя криптография в проде. Поэтому берётся `baileys` — единственная чужая библиотека
 * канала.
 *
 * И ровно поэтому здесь стоит порт. Библиотека — это триста экспортов, протобуф и
 * собственная модель мира; знать о ней должен один файл (`client.ts`), а разбор входящих,
 * отправка ответов и скачивание вложений — работать против шести методов ниже. Так они
 * проверяются без сети и без живой сессии, а замена библиотеки (или переезд на платный
 * шлюз, если аккаунт когда-нибудь забанят) остаётся заменой одного файла.
 */

/** Состояние соединения. Тишина в ленте одинаково выглядит при обрыве и при затишье. */
export type WhatsAppConnectionState = "connecting" | "ready" | "closed" | "logged_out";

/** Кто мы: адрес аккаунта и его номер. */
export interface WhatsAppSelf {
  readonly jid: string;
  /** Только цифры, международный вид без плюса — так их отдаёт сам WhatsApp. */
  readonly phone: string;
}

export interface WhatsAppSendResult {
  readonly providerMessageId: string;
}

export interface WhatsAppFileToSend {
  readonly jid: string;
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly mimeType: string | null;
  readonly kind: AttachmentKind;
  readonly caption: string;
}

/** Есть ли такой номер в WhatsApp и по какому адресу с ним говорить. */
export interface WhatsAppLookup {
  readonly jid: string;
  readonly exists: boolean;
}

export interface WhatsAppSocket {
  self(): WhatsAppSelf | null;
  sendText(jid: string, text: string): Promise<WhatsAppSendResult>;
  sendFile(input: WhatsAppFileToSend): Promise<WhatsAppSendResult>;
  /**
   * Скачивает файл сообщения.
   *
   * На входе — обновление целиком, как его прислал мессенджер и как мы его записали.
   * Не идентификатор файла: у WhatsApp файл лежит на их складе зашифрованным, а ключ,
   * путь и контрольные суммы приходят внутри сообщения. Без них скачанное — это шум.
   */
  downloadMedia(payload: unknown): Promise<Uint8Array>;
  /** Номер в международном виде, с плюсом или без. `null` — спросить не удалось. */
  lookupPhone(phone: string): Promise<WhatsAppLookup | null>;
  close(): Promise<void>;
}
