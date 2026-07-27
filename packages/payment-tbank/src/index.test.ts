import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTBankToken,
  TBankPaymentProvider,
  verifyTBankPaymentWebhook
} from "./index.js";

describe("T-Bank token contract", () => {
  it("matches the official Init token fixture and excludes nested values", () => {
    const token = createTBankToken({
      TerminalKey: "MerchantTerminalKey",
      Amount: 19200,
      OrderId: "00000",
      Description: "Подарочная карта на 1000 рублей",
      DATA: { Phone: "+71234567890" },
      Receipt: { Items: [] }
    }, "11111111111111");

    assert.equal(
      token,
      "72dd466f8ace0a37a1f740ce5fb78101712bc0665d91a8108c7c8a0ccd426db2"
    );
  });

  it("verifies the official notification fixture and rejects tampering", () => {
    const payload = {
      TerminalKey: "1234567890DEMO",
      OrderId: "000000",
      Success: true,
      Status: "AUTHORIZED",
      PaymentId: "0000000",
      ErrorCode: "0",
      Amount: 1111,
      CardId: "000000",
      Pan: "200000******0000",
      ExpDate: "1111",
      RebillId: "000000",
      Data: { ignored: "nested" },
      Token: "1c0964277d0213349243065a0d5b838b8e90d2d25f740d0f2767836e710e80c8"
    };

    const event = verifyTBankPaymentWebhook(
      payload,
      "1234567890DEMO",
      "11111111111"
    );

    assert.equal(event.providerPaymentId, "0000000");
    assert.equal(event.status, "AUTHORIZED");
    assert.equal(event.amountKopecks, 1111n);
    assert.match(event.payloadHash, /^[a-f0-9]{64}$/);
    assert.match(event.eventKey, /^[a-f0-9]{64}$/);
    assert.throws(
      () => verifyTBankPaymentWebhook(
        { ...payload, Amount: 1112 },
        "1234567890DEMO",
        "11111111111"
      ),
      /verification failed/
    );
  });

  it("accepts a real-world webhook where PaymentId is a JSON number", () => {
    const payloadWithoutToken = {
      TerminalKey: "1234567890DEMO",
      OrderId: "tb_000000_1",
      Success: true,
      Status: "CONFIRMED",
      PaymentId: 8934558028,
      ErrorCode: "0",
      Amount: 1000,
      CardId: 692658954,
      Pan: "220070******9183",
      ExpDate: "0935"
    };
    const token = createTBankToken(payloadWithoutToken, "11111111111");

    const event = verifyTBankPaymentWebhook(
      { ...payloadWithoutToken, Token: token },
      "1234567890DEMO",
      "11111111111"
    );

    assert.equal(event.providerPaymentId, "8934558028");
    assert.equal(event.status, "CONFIRMED");
  });
});

describe("TBankPaymentProvider", () => {
  it("posts a signed Init request and validates the bound response", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const provider = new TBankPaymentProvider({
      baseUrl: "https://rest-api-test.tinkoff.ru/v2",
      terminalKey: "TBankTest",
      password: "test-password",
      fetchImplementation: async (input, init) => {
        assert.equal(input, "https://rest-api-test.tinkoff.ru/v2/Init");
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          Success: true,
          ErrorCode: "0",
          TerminalKey: "TBankTest",
          Status: "NEW",
          PaymentId: "3093639567",
          OrderId: "BP-000001-1",
          Amount: 239000,
          PaymentURL: "https://pay.tbank.ru/new/fU1ppgqa"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    const result = await provider.initializePayment({
      merchantOrderId: "BP-000001-1",
      amountKopecks: 239_000n,
      description: "Билет BP-000001",
      notificationUrl: "https://example.test/webhooks/payments/tbank",
      successUrl: "https://example.test/payment/success",
      failUrl: "https://example.test/payment/fail",
      payType: "O"
    });

    assert.deepEqual(result, {
      initialized: true,
      providerPaymentId: "3093639567",
      paymentUrl: "https://pay.tbank.ru/new/fU1ppgqa",
      providerStatus: "NEW"
    });
    assert.equal(requestBody?.Amount, 239000);
    assert.match(String(requestBody?.Token), /^[a-f0-9]{64}$/);
    assert.equal("Password" in (requestBody ?? {}), false);
  });

  it("fails closed for mismatched or unavailable provider responses", async () => {
    const mismatched = new TBankPaymentProvider({
      baseUrl: "https://rest-api-test.tinkoff.ru/v2",
      terminalKey: "TBankTest",
      password: "test-password",
      fetchImplementation: async () => new Response(JSON.stringify({
        Success: true,
        ErrorCode: "0",
        TerminalKey: "TBankTest",
        Status: "NEW",
        PaymentId: "3093639567",
        OrderId: "another-order",
        Amount: 239000,
        PaymentURL: "https://pay.tbank.ru/new/fU1ppgqa"
      }), { status: 200 })
    });
    const unavailable = new TBankPaymentProvider({
      baseUrl: "https://rest-api-test.tinkoff.ru/v2",
      terminalKey: "TBankTest",
      password: "test-password",
      fetchImplementation: async () => {
        throw new Error("socket timeout");
      }
    });
    const input = {
      merchantOrderId: "BP-000001-1",
      amountKopecks: 239_000n,
      description: "Билет BP-000001",
      notificationUrl: "https://example.test/webhooks/payments/tbank",
      successUrl: "https://example.test/payment/success",
      failUrl: "https://example.test/payment/fail",
      payType: "O" as const
    };

    assert.deepEqual(await mismatched.initializePayment(input), {
      initialized: false,
      errorCode: "RESPONSE_MISMATCH",
      retryable: true
    });
    assert.deepEqual(await unavailable.initializePayment(input), {
      initialized: false,
      errorCode: "NETWORK_ERROR",
      retryable: true
    });
  });

  it("checks an order by merchant ID and validates every returned payment", async () => {
    const requests: { readonly url: string; readonly body: Record<string, unknown> }[] = [];
    const provider = new TBankPaymentProvider({
      baseUrl: "https://rest-api-test.tinkoff.ru/v2",
      terminalKey: "TBankTest",
      password: "password",
      fetchImplementation: async (url, init) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        });
        return Response.json({
          TerminalKey: "TBankTest",
          OrderId: "tb_order_1",
          Success: true,
          ErrorCode: "0",
          Payments: [{
            PaymentId: "124671934",
            Amount: 13660,
            Status: "CONFIRMED",
            Success: "true",
            ErrorCode: 0
          }]
        });
      }
    });

    const result = await provider.checkOrder("tb_order_1");

    assert.equal(result.found, true);
    if (result.found) {
      assert.equal(result.payments[0]?.providerPaymentId, "124671934");
      assert.equal(result.payments[0]?.amountKopecks, 13660n);
      assert.match(result.responseHash, /^[a-f0-9]{64}$/);
    }
    assert.equal(requests[0]?.url, "https://rest-api-test.tinkoff.ru/v2/CheckOrder");
    assert.match(String(requests[0]?.body.Token), /^[a-f0-9]{64}$/);
  });

  it("returns an empty order safely and rejects a foreign order binding", async () => {
    const empty = new TBankPaymentProvider({
      baseUrl: "https://rest-api-test.tinkoff.ru/v2",
      terminalKey: "TBankTest",
      password: "password",
      fetchImplementation: async () => Response.json({
        TerminalKey: "TBankTest",
        OrderId: "tb_order_1",
        Success: true,
        ErrorCode: "0",
        Payments: []
      })
    });
    const foreign = new TBankPaymentProvider({
      baseUrl: "https://rest-api-test.tinkoff.ru/v2",
      terminalKey: "TBankTest",
      password: "password",
      fetchImplementation: async () => Response.json({
        TerminalKey: "TBankTest",
        OrderId: "foreign",
        Success: true,
        ErrorCode: "0",
        Payments: []
      })
    });

    const emptyResult = await empty.checkOrder("tb_order_1");
    assert.equal(emptyResult.found, true);
    if (emptyResult.found) {
      assert.deepEqual(emptyResult.payments, []);
    }
    assert.deepEqual(await foreign.checkOrder("tb_order_1"), {
      found: false,
      errorCode: "RESPONSE_MISMATCH",
      retryable: false
    });
  });

  it("routes malformed payment data to non-retryable review", async () => {
    const provider = new TBankPaymentProvider({
      baseUrl: "https://rest-api-test.tinkoff.ru/v2",
      terminalKey: "TBankTest",
      password: "password",
      fetchImplementation: async () => Response.json({
        TerminalKey: "TBankTest",
        OrderId: "tb_order_1",
        Success: true,
        ErrorCode: "0",
        Payments: [{
          PaymentId: "124671934",
          Status: "CONFIRMED",
          Success: "true"
        }]
      })
    });

    assert.deepEqual(await provider.checkOrder("tb_order_1"), {
      found: false,
      errorCode: "INVALID_RESPONSE",
      retryable: false
    });
  });

  it("submits a signed full refund without an amount or receipt", async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const provider = new TBankPaymentProvider({
      baseUrl: "https://rest-api-test.tinkoff.ru/v2",
      terminalKey: "TBankTest",
      password: "password",
      fetchImplementation: async (input, init) => {
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        });
        return Response.json({
          TerminalKey: "TBankTest",
          OrderId: "tb_order_1",
          Success: true,
          Status: "REFUNDED",
          OriginalAmount: 13660,
          NewAmount: 0,
          PaymentId: "124671934",
          ErrorCode: "0",
          ExternalRequestId: "7c4934c2-95e8-4a96-a28a-73b7762e3112"
        });
      }
    });

    const result = await provider.refundFullPayment({
      providerPaymentId: "124671934",
      merchantOrderId: "tb_order_1",
      expectedOriginalAmountKopecks: 13660n,
      externalRequestId: "7c4934c2-95e8-4a96-a28a-73b7762e3112"
    });

    assert.equal(result.submitted, true);
    if (result.submitted) {
      assert.equal(result.providerStatus, "REFUNDED");
      assert.equal(result.remainingAmountKopecks, 0n);
      assert.match(result.responseHash, /^[a-f0-9]{64}$/);
    }
    assert.equal(requests[0]?.url, "https://rest-api-test.tinkoff.ru/v2/Cancel");
    assert.equal(requests[0]?.body.Amount, undefined);
    assert.equal(requests[0]?.body.Receipt, undefined);
    assert.match(String(requests[0]?.body.Token), /^[a-f0-9]{64}$/);
  });

  it("fails closed for a mismatched or uncertain full refund response", async () => {
    const mismatched = new TBankPaymentProvider({
      baseUrl: "https://rest-api-test.tinkoff.ru/v2",
      terminalKey: "TBankTest",
      password: "password",
      fetchImplementation: async () => Response.json({
        TerminalKey: "TBankTest",
        OrderId: "foreign",
        Success: true,
        Status: "REFUNDED",
        OriginalAmount: 13660,
        NewAmount: 0,
        PaymentId: 124671934,
        ErrorCode: "0"
      })
    });
    const unavailable = new TBankPaymentProvider({
      baseUrl: "https://rest-api-test.tinkoff.ru/v2",
      terminalKey: "TBankTest",
      password: "password",
      fetchImplementation: async () => {
        throw new Error("timeout");
      }
    });
    const input = {
      providerPaymentId: "124671934",
      merchantOrderId: "tb_order_1",
      expectedOriginalAmountKopecks: 13660n,
      externalRequestId: "7c4934c2-95e8-4a96-a28a-73b7762e3112"
    };

    assert.deepEqual(await mismatched.refundFullPayment(input), {
      submitted: false,
      errorCode: "RESPONSE_MISMATCH",
      retryable: false,
      uncertain: true
    });
    assert.deepEqual(await unavailable.refundFullPayment(input), {
      submitted: false,
      errorCode: "NETWORK_ERROR",
      retryable: true,
      uncertain: true
    });
  });
});
