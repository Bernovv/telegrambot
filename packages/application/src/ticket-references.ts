import {
  createHash,
  createHmac
} from "node:crypto";
import type { TicketReferenceGenerator } from "./payment-confirmation.js";

export class HmacTicketReferenceGenerator implements TicketReferenceGenerator {
  private readonly secret: Buffer;

  constructor(secret: string) {
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("Ticket token secret must contain at least 32 bytes");
    }

    this.secret = Buffer.from(secret, "utf8");
  }

  ticketNumber(orderNumber: string, ordinal: number): string {
    if (!/^[A-Z0-9-]{6,40}$/.test(orderNumber)) {
      throw new Error("Order number cannot be used as a ticket prefix");
    }
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 99_999) {
      throw new Error("Ticket ordinal must be an integer between 1 and 99999");
    }

    return `${orderNumber}-T${ordinal.toString().padStart(3, "0")}`;
  }

  publicToken(ticketId: string): { readonly token: string; readonly sha256: string } {
    const compactId = ticketId.replaceAll("-", "");
    if (!/^[a-fA-F0-9]{24,32}$/.test(compactId)) {
      throw new Error("Ticket ID must be a UUID-compatible hexadecimal identifier");
    }

    const token = createHmac("sha256", this.secret)
      .update(`ticket:${ticketId}`)
      .digest("base64url");

    return {
      token,
      sha256: createHash("sha256").update(token).digest("hex")
    };
  }
}
