import {
  createHash,
  createHmac
} from "node:crypto";
import type { OrderReferenceGenerator } from "./orders.js";

export class HmacOrderReferenceGenerator implements OrderReferenceGenerator {
  private readonly secret: Buffer;

  constructor(
    secret: string,
    private readonly numberPrefix: string
  ) {
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("Order token secret must contain at least 32 bytes");
    }
    if (!/^[A-Z0-9]{2,6}$/.test(numberPrefix)) {
      throw new Error("Order number prefix must contain 2-6 uppercase letters or digits");
    }

    this.secret = Buffer.from(secret, "utf8");
  }

  orderNumber(orderId: string, createdAt: Date): string {
    const date = createdAt.toISOString().slice(0, 10).replaceAll("-", "");
    const compactId = orderId.replaceAll("-", "").toUpperCase();

    if (!/^[A-F0-9]{24,32}$/.test(compactId)) {
      throw new Error("Order ID must be a UUID-compatible hexadecimal identifier");
    }

    return `${this.numberPrefix}-${date}-${compactId.slice(-24)}`;
  }

  publicToken(orderId: string): { readonly token: string; readonly sha256: string } {
    const token = createHmac("sha256", this.secret)
      .update(`order:${orderId}`)
      .digest("base64url");

    return {
      token,
      sha256: createHash("sha256").update(token).digest("hex")
    };
  }
}
