export interface SendMessageCommand {
  readonly channelIdentityId: string;
  readonly text: string;
}

export interface SendResult {
  readonly providerMessageId: string;
}

export interface IncomingMessage {
  readonly updateId: string;
  readonly externalUserId: string;
  readonly payload: unknown;
}

export interface MessengerAdapter {
  sendMessage(command: SendMessageCommand): Promise<SendResult>;
  editMessage(command: SendMessageCommand): Promise<SendResult>;
  sendDocument(command: SendMessageCommand): Promise<SendResult>;
  answerCallback(callbackId: string): Promise<void>;
  buildDeepLink(payload: string): Promise<string>;
  validateIncomingUpdate(payload: unknown): IncomingMessage;
}

export * from "./phone-normalizer.js";
export * from "./conversation-controller.js";
export * from "./scenario-content.js";
export * from "./scenario-callback.js";
