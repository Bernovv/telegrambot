import {
  createHash,
  timingSafeEqual
} from "node:crypto";

export type TBankPaymentStatus =
  | "NEW"
  | "FORM_SHOWED"
  | "DEADLINE_EXPIRED"
  | "CANCELED"
  | "PREAUTHORIZING"
  | "AUTHORIZING"
  | "AUTHORIZED"
  | "AUTH_FAIL"
  | "REJECTED"
  | "3DS_CHECKING"
  | "3DS_CHECKED"
  | "REVERSING"
  | "PARTIAL_REVERSED"
  | "REVERSED"
  | "CONFIRMING"
  | "CONFIRMED"
  | "REFUNDING"
  | "PARTIAL_REFUNDED"
  | "REFUNDED";

export interface InitializePayment {
  readonly merchantOrderId: string;
  readonly amountKopecks: bigint;
  readonly description: string;
  readonly notificationUrl: string;
  readonly successUrl: string;
  readonly failUrl: string;
  readonly payType: "O";
}

export type PaymentInitialization =
  | {
      readonly initialized: true;
      readonly providerPaymentId: string;
      readonly paymentUrl: string;
      readonly providerStatus: "NEW";
    }
  | {
      readonly initialized: false;
      readonly errorCode: string;
      readonly retryable: boolean;
    };

export interface PaymentProvider {
  initializePayment(input: InitializePayment): Promise<PaymentInitialization>;
}

export interface TBankOrderPayment {
  readonly providerPaymentId: string;
  readonly amountKopecks: bigint;
  readonly status: TBankPaymentStatus;
  readonly success: boolean;
  readonly errorCode: string;
}

export type TBankOrderLookup =
  | {
      readonly found: true;
      readonly merchantOrderId: string;
      readonly payments: readonly TBankOrderPayment[];
      readonly responseHash: string;
    }
  | {
      readonly found: false;
      readonly errorCode: string;
      readonly retryable: boolean;
    };

export interface TBankOrderStateProvider {
  checkOrder(merchantOrderId: string): Promise<TBankOrderLookup>;
}

export interface RefundTBankPayment {
  readonly providerPaymentId: string;
  readonly merchantOrderId: string;
  readonly expectedOriginalAmountKopecks: bigint;
  readonly externalRequestId: string;
}

export type TBankRefundSubmission =
  | {
      readonly submitted: true;
      readonly providerPaymentId: string;
      readonly merchantOrderId: string;
      readonly providerStatus: TBankPaymentStatus;
      readonly originalAmountKopecks: bigint;
      readonly remainingAmountKopecks: bigint;
      readonly responseHash: string;
    }
  | {
      readonly submitted: false;
      readonly errorCode: string;
      readonly retryable: boolean;
      readonly uncertain: boolean;
    };

export interface TBankRefundProvider {
  refundFullPayment(input: RefundTBankPayment): Promise<TBankRefundSubmission>;
}

export interface VerifiedTBankPaymentEvent {
  readonly providerPaymentId: string;
  readonly merchantOrderId: string;
  readonly status: TBankPaymentStatus;
  readonly success: boolean;
  readonly errorCode: string;
  readonly amountKopecks: bigint;
  readonly payloadHash: string;
  readonly eventKey: string;
}

export interface TBankPaymentProviderOptions {
  readonly baseUrl: string;
  readonly terminalKey: string;
  readonly password: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

export class TBankPaymentProvider
implements PaymentProvider, TBankOrderStateProvider, TBankRefundProvider {
  private readonly baseUrl: string;
  private readonly terminalKey: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: TBankPaymentProviderOptions) {
    this.baseUrl = validateBaseUrl(options.baseUrl);
    this.terminalKey = boundedSecret(options.terminalKey, "T-Bank terminal key", 64);
    this.password = boundedSecret(options.password, "T-Bank password", 200);
    this.timeoutMs = options.timeoutMs ?? 8_000;
    if (
      !Number.isSafeInteger(this.timeoutMs)
      || this.timeoutMs < 1_000
      || this.timeoutMs > 30_000
    ) {
      throw new Error("T-Bank timeout must be between 1000 and 30000 milliseconds");
    }
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async initializePayment(input: InitializePayment): Promise<PaymentInitialization> {
    validateInitialization(input);
    const bodyWithoutToken = {
      TerminalKey: this.terminalKey,
      Amount: Number(input.amountKopecks),
      OrderId: input.merchantOrderId,
      Description: input.description,
      PayType: input.payType,
      Language: "ru",
      NotificationURL: input.notificationUrl,
      SuccessURL: input.successUrl,
      FailURL: input.failUrl
    };
    const body = {
      ...bodyWithoutToken,
      Token: createTBankToken(bodyWithoutToken, this.password)
    };

    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/Init`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      return {
        initialized: false,
        errorCode: "NETWORK_ERROR",
        retryable: true
      };
    }
    if (!response.ok) {
      return {
        initialized: false,
        errorCode: `HTTP_${response.status}`,
        retryable: response.status >= 500 || response.status === 429
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        initialized: false,
        errorCode: "INVALID_RESPONSE",
        retryable: true
      };
    }

    return parseInitializationResponse(
      payload,
      input,
      this.terminalKey
    );
  }

  verifyWebhook(payload: unknown): VerifiedTBankPaymentEvent {
    return verifyTBankPaymentWebhook(payload, this.terminalKey, this.password);
  }

  async checkOrder(merchantOrderId: string): Promise<TBankOrderLookup> {
    if (!/^[A-Za-z0-9._-]{1,50}$/.test(merchantOrderId)) {
      throw new Error("T-Bank merchant order ID is invalid");
    }
    const bodyWithoutToken = {
      TerminalKey: this.terminalKey,
      OrderId: merchantOrderId
    };
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/CheckOrder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...bodyWithoutToken,
          Token: createTBankToken(bodyWithoutToken, this.password)
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      return { found: false, errorCode: "NETWORK_ERROR", retryable: true };
    }
    if (!response.ok) {
      return {
        found: false,
        errorCode: `HTTP_${response.status}`,
        retryable: response.status >= 500 || response.status === 429
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { found: false, errorCode: "INVALID_RESPONSE", retryable: true };
    }
    try {
      return parseCheckOrderResponse(payload, merchantOrderId, this.terminalKey);
    } catch {
      return { found: false, errorCode: "INVALID_RESPONSE", retryable: false };
    }
  }

  async refundFullPayment(
    input: RefundTBankPayment
  ): Promise<TBankRefundSubmission> {
    validateRefund(input);
    const bodyWithoutToken = {
      TerminalKey: this.terminalKey,
      PaymentId: input.providerPaymentId,
      ExternalRequestId: input.externalRequestId
    };
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/Cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...bodyWithoutToken,
          Token: createTBankToken(bodyWithoutToken, this.password)
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      return {
        submitted: false,
        errorCode: "NETWORK_ERROR",
        retryable: true,
        uncertain: true
      };
    }
    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      return {
        submitted: false,
        errorCode: `HTTP_${response.status}`,
        retryable,
        uncertain: retryable
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        submitted: false,
        errorCode: "INVALID_RESPONSE",
        retryable: true,
        uncertain: true
      };
    }
    try {
      return parseRefundResponse(payload, input, this.terminalKey);
    } catch {
      return {
        submitted: false,
        errorCode: "RESPONSE_MISMATCH",
        retryable: false,
        uncertain: true
      };
    }
  }
}

export function createTBankToken(
  payload: Readonly<Record<string, unknown>>,
  password: string
): string {
  const pairs = canonicalScalarPairs(payload, password);
  const concatenated = pairs.map(([, value]) => value).join("");
  return createHash("sha256").update(concatenated, "utf8").digest("hex");
}

export function verifyTBankPaymentWebhook(
  payload: unknown,
  terminalKey: string,
  password: string
): VerifiedTBankPaymentEvent {
  const record = asRecord(payload, "T-Bank webhook must be an object");
  const token = stringField(record, "Token", 64);
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    throw new Error("T-Bank webhook token is invalid");
  }
  const expected = createTBankToken(record, password);
  if (!safeHexEqual(token, expected)) {
    throw new Error("T-Bank webhook token verification failed");
  }

  const receivedTerminalKey = stringField(record, "TerminalKey", 64);
  if (receivedTerminalKey !== terminalKey) {
    throw new Error("T-Bank webhook terminal is invalid");
  }
  const providerPaymentId = digitsField(record, "PaymentId", 20);
  const merchantOrderId = stringField(record, "OrderId", 50);
  if (!/^[A-Za-z0-9._-]{1,50}$/.test(merchantOrderId)) {
    throw new Error("T-Bank webhook merchant order ID is invalid");
  }
  const status = parseStatus(record.Status);
  const success = booleanField(record, "Success");
  const errorCode = stringField(record, "ErrorCode", 20);
  const amount = integerField(record, "Amount", 9_999_999_999);
  const payloadHash = hashScalarPayload(record);

  return {
    providerPaymentId,
    merchantOrderId,
    status,
    success,
    errorCode,
    amountKopecks: BigInt(amount),
    payloadHash,
    eventKey: createHash("sha256")
      .update(`tbank-webhook:v1:${providerPaymentId}:${status}:${payloadHash}`)
      .digest("hex")
  };
}

function parseInitializationResponse(
  payload: unknown,
  input: InitializePayment,
  terminalKey: string
): PaymentInitialization {
  const record = asRecord(payload, "T-Bank Init response must be an object");
  const success = booleanField(record, "Success");
  const errorCode = stringField(record, "ErrorCode", 20);
  if (!success || errorCode !== "0") {
    return {
      initialized: false,
      errorCode: safeErrorCode(errorCode),
      retryable: errorCode === "9999"
    };
  }
  if (
    stringField(record, "TerminalKey", 64) !== terminalKey
    || stringField(record, "OrderId", 50) !== input.merchantOrderId
    || integerField(record, "Amount", 9_999_999_999) !== Number(input.amountKopecks)
    || record.Status !== "NEW"
  ) {
    return {
      initialized: false,
      errorCode: "RESPONSE_MISMATCH",
      retryable: true
    };
  }

  const providerPaymentId = digitsField(record, "PaymentId", 20);
  const paymentUrl = httpsUrlField(record, "PaymentURL", 2_048);
  return {
    initialized: true,
    providerPaymentId,
    paymentUrl,
    providerStatus: "NEW"
  };
}

function parseCheckOrderResponse(
  payload: unknown,
  merchantOrderId: string,
  terminalKey: string
): TBankOrderLookup {
  const record = asRecord(payload, "T-Bank CheckOrder response must be an object");
  const success = booleanField(record, "Success");
  const errorCode = stringField(record, "ErrorCode", 20);
  if (!success || errorCode !== "0") {
    return {
      found: false,
      errorCode: safeErrorCode(errorCode),
      retryable: errorCode === "9999"
    };
  }
  if (
    stringField(record, "TerminalKey", 64) !== terminalKey
    || stringField(record, "OrderId", 50) !== merchantOrderId
    || !Array.isArray(record.Payments)
    || record.Payments.length > 20
  ) {
    return { found: false, errorCode: "RESPONSE_MISMATCH", retryable: false };
  }

  const payments = record.Payments.map((item) => {
    const payment = asRecord(item, "T-Bank CheckOrder payment must be an object");
    const successValue = stringField(payment, "Success", 5);
    if (successValue !== "true" && successValue !== "false") {
      throw new Error("T-Bank CheckOrder payment success is invalid");
    }
    const itemErrorCode = payment.ErrorCode === undefined
      ? "0"
      : String(integerField(payment, "ErrorCode", 9_999_999_999));
    return {
      providerPaymentId: digitsField(payment, "PaymentId", 20),
      amountKopecks: BigInt(integerField(payment, "Amount", 9_999_999_999)),
      status: parseStatus(payment.Status),
      success: successValue === "true",
      errorCode: itemErrorCode
    };
  });
  const canonical = {
    terminalKey,
    merchantOrderId,
    payments: payments.map((payment) => ({
      providerPaymentId: payment.providerPaymentId,
      amountKopecks: payment.amountKopecks.toString(),
      status: payment.status,
      success: payment.success,
      errorCode: payment.errorCode
    }))
  };
  return {
    found: true,
    merchantOrderId,
    payments,
    responseHash: createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex")
  };
}

function parseRefundResponse(
  payload: unknown,
  input: RefundTBankPayment,
  terminalKey: string
): TBankRefundSubmission {
  const record = asRecord(payload, "T-Bank Cancel response must be an object");
  const success = booleanField(record, "Success");
  const errorCode = stringField(record, "ErrorCode", 20);
  if (!success || errorCode !== "0") {
    return {
      submitted: false,
      errorCode: safeErrorCode(errorCode),
      retryable: errorCode === "9999",
      uncertain: errorCode === "9999"
    };
  }
  const providerPaymentId = paymentIdField(record, "PaymentId", 20);
  const merchantOrderId = stringField(record, "OrderId", 50);
  const originalAmount = integerField(record, "OriginalAmount", 9_999_999_999);
  const remainingAmount = integerField(record, "NewAmount", 9_999_999_999);
  const externalRequestId = record.ExternalRequestId === undefined
    ? null
    : stringField(record, "ExternalRequestId", 255);
  if (
    stringField(record, "TerminalKey", 64) !== terminalKey
    || providerPaymentId !== input.providerPaymentId
    || merchantOrderId !== input.merchantOrderId
    || BigInt(originalAmount) !== input.expectedOriginalAmountKopecks
    || remainingAmount > originalAmount
    || (
      externalRequestId !== null
      && externalRequestId !== input.externalRequestId
    )
  ) {
    return {
      submitted: false,
      errorCode: "RESPONSE_MISMATCH",
      retryable: false,
      uncertain: true
    };
  }
  const providerStatus = parseStatus(record.Status);
  const canonical = {
    terminalKey,
    merchantOrderId,
    providerPaymentId,
    providerStatus,
    originalAmountKopecks: String(originalAmount),
    remainingAmountKopecks: String(remainingAmount),
    externalRequestId
  };
  return {
    submitted: true,
    providerPaymentId,
    merchantOrderId,
    providerStatus,
    originalAmountKopecks: BigInt(originalAmount),
    remainingAmountKopecks: BigInt(remainingAmount),
    responseHash: createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex")
  };
}

function validateInitialization(input: InitializePayment): void {
  if (!/^[A-Za-z0-9._-]{1,50}$/.test(input.merchantOrderId)) {
    throw new Error("T-Bank merchant order ID is invalid");
  }
  if (
    input.amountKopecks < 1n
    || input.amountKopecks > 9_999_999_999n
  ) {
    throw new Error("T-Bank payment amount is invalid");
  }
  if (
    !input.description.trim()
    || input.description.length > 140
    || input.payType !== "O"
  ) {
    throw new Error("T-Bank payment description or type is invalid");
  }
  validateHttpsUrl(input.notificationUrl, 250, "notification");
  validateHttpsUrl(input.successUrl, 250, "success");
  validateHttpsUrl(input.failUrl, 250, "failure");
}

function validateRefund(input: RefundTBankPayment): void {
  if (
    !/^\d{1,20}$/.test(input.providerPaymentId)
    || !/^[A-Za-z0-9._-]{1,50}$/.test(input.merchantOrderId)
    || input.expectedOriginalAmountKopecks < 1n
    || input.expectedOriginalAmountKopecks > 9_999_999_999n
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(input.externalRequestId)
  ) {
    throw new Error("T-Bank full refund input is invalid");
  }
}

function validateBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("T-Bank API base URL is invalid");
  }
  const allowedHosts = new Set([
    "securepay.tinkoff.ru",
    "rest-api-test.tinkoff.ru"
  ]);
  if (
    url.protocol !== "https:"
    || !allowedHosts.has(url.hostname)
    || url.port
    || url.pathname.replace(/\/+$/, "") !== "/v2"
    || url.search
    || url.hash
  ) {
    throw new Error("T-Bank API base URL is not allowed");
  }
  return `${url.origin}/v2`;
}

function canonicalScalarPairs(
  payload: Readonly<Record<string, unknown>>,
  password: string
): readonly (readonly [string, string])[] {
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (key === "Token" || value === null || value === undefined) {
      continue;
    }
    if (
      typeof value === "string"
      || typeof value === "boolean"
      || (typeof value === "number" && Number.isFinite(value))
      || typeof value === "bigint"
    ) {
      pairs.push([key, String(value)]);
    }
  }
  pairs.push(["Password", boundedSecret(password, "T-Bank password", 200)]);
  pairs.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return pairs;
}

function hashScalarPayload(payload: Readonly<Record<string, unknown>>): string {
  const scalars = Object.entries(payload)
    .filter(([key, value]) => key !== "Token" && isScalar(value))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => [key, value] as const);
  return createHash("sha256").update(JSON.stringify(scalars)).digest("hex");
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function parseStatus(value: unknown): TBankPaymentStatus {
  if (typeof value !== "string" || !TBANK_PAYMENT_STATUSES.has(value)) {
    throw new Error("T-Bank webhook status is invalid");
  }
  return value as TBankPaymentStatus;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function boundedSecret(value: string, name: string, maximum: number): string {
  if (!value || value.length > maximum) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function stringField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  maximumLength: number
): string {
  const value = record[key];
  if (typeof value !== "string" || !value || value.length > maximumLength) {
    throw new Error(`T-Bank ${key} is invalid`);
  }
  return value;
}

function digitsField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  maximumLength: number
): string {
  const value = stringField(record, key, maximumLength);
  if (!new RegExp(`^\\d{1,${maximumLength}}$`).test(value)) {
    throw new Error(`T-Bank ${key} is invalid`);
  }
  return value;
}

function paymentIdField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  maximumLength: number
): string {
  const value = record[key];
  if (typeof value === "string") {
    return digitsField(record, key, maximumLength);
  }
  if (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
  ) {
    return String(value);
  }
  throw new Error(`T-Bank ${key} is invalid`);
}

function booleanField(
  record: Readonly<Record<string, unknown>>,
  key: string
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`T-Bank ${key} is invalid`);
  }
  return value;
}

function integerField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  maximum: number
): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`T-Bank ${key} is invalid`);
  }
  return value as number;
}

function httpsUrlField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  maximumLength: number
): string {
  const value = stringField(record, key, maximumLength);
  validateHttpsUrl(value, maximumLength, key);
  return value;
}

function validateHttpsUrl(value: string, maximumLength: number, name: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`T-Bank ${name} URL is invalid`);
  }
  if (
    value.length > maximumLength
    || url.protocol !== "https:"
    || Boolean(url.username)
    || Boolean(url.password)
  ) {
    throw new Error(`T-Bank ${name} URL is invalid`);
  }
}

function safeHexEqual(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received.toLowerCase(), "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}

function safeErrorCode(value: string): string {
  return /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : "PROVIDER_ERROR";
}

const TBANK_PAYMENT_STATUSES = new Set<string>([
  "NEW",
  "FORM_SHOWED",
  "DEADLINE_EXPIRED",
  "CANCELED",
  "PREAUTHORIZING",
  "AUTHORIZING",
  "AUTHORIZED",
  "AUTH_FAIL",
  "REJECTED",
  "3DS_CHECKING",
  "3DS_CHECKED",
  "REVERSING",
  "PARTIAL_REVERSED",
  "REVERSED",
  "CONFIRMING",
  "CONFIRMED",
  "REFUNDING",
  "PARTIAL_REFUNDED",
  "REFUNDED"
]);
