import QRCode from "qrcode";
import type {
  TicketPng,
  TicketPngRenderer
} from "@ticket-platform/application";

const TICKET_QR_SIZE = 512;
const MAXIMUM_PNG_BYTES = 2 * 1_024 * 1_024;

export class QrTicketPngRenderer implements TicketPngRenderer {
  async renderPng(publicToken: string): Promise<TicketPng> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(publicToken)) {
      throw new Error("Ticket public token is invalid");
    }

    const png = await QRCode.toBuffer(publicToken, {
      type: "png",
      width: TICKET_QR_SIZE,
      margin: 4,
      errorCorrectionLevel: "M",
      color: {
        dark: "#000000ff",
        light: "#ffffffff"
      },
      rendererOpts: {
        deflateLevel: 9,
        deflateStrategy: 3
      }
    });
    if (png.byteLength < 100 || png.byteLength > MAXIMUM_PNG_BYTES) {
      throw new Error("Rendered ticket PNG size is invalid");
    }

    return {
      bytes: new Uint8Array(png.buffer, png.byteOffset, png.byteLength),
      mimeType: "image/png",
      width: TICKET_QR_SIZE,
      height: TICKET_QR_SIZE
    };
  }
}
