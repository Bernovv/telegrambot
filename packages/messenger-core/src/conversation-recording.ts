import type {
  IncomingConversationMessage,
  OutgoingConversationMessage,
  RecordedConversationMessage
} from "@ticket-platform/application";

/**
 * Кто записывает переписку — с точки зрения канала.
 *
 * Транспорту незачем знать ни про базу, ни про службу записи целиком: его дело — сказать,
 * что пришло и что ушло. Отсюда узкий порт, который реализует `ConversationLog` из
 * приложения, и отсюда же `null` в ответе: запись могла не удаться, и это не повод
 * прерывать разговор с человеком.
 */
export interface ConversationRecorder {
  recordIncoming(
    message: IncomingConversationMessage
  ): Promise<RecordedConversationMessage | null>;
  recordOutgoing(
    message: OutgoingConversationMessage
  ): Promise<RecordedConversationMessage | null>;
}

export type {
  AttachmentKind,
  IncomingAttachment,
  IncomingConversationMessage,
  OutgoingConversationMessage,
  RecordedConversationMessage
} from "@ticket-platform/application";
