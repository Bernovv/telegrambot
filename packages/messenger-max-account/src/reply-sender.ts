import type { AttachmentKind, ConversationReplySender } from "@ticket-platform/application";
import { MaxOpcode } from "./protocol.js";
import type { MaxAccountInvoker } from "./directory.js";

/**
 * Ответ менеджера, ушедший от имени аккаунта компании.
 *
 * В отличие от Telegram, где TDLib отвечает заготовкой и настоящую судьбу присылает
 * позже, MAX отвечает на отправку сразу и по делу: в ответе лежит готовое сообщение с его
 * номером. Ждать второго подтверждения незачем — его не будет.
 *
 * Своё поле `cid` в каждом сообщении — не украшение. Это идентификатор попытки на нашей
 * стороне: если ответ потерялся по дороге, а очередь повторит отправку, MAX по одинаковому
 * `cid` поймёт, что это тот же самый текст, и не покажет человеку два одинаковых сообщения.
 */

/** Предел текста у MAX. Тот же, что стоит в панели. */
const TEXT_LIMIT = 4_000;

export function createMaxAccountReplySender(
  client: MaxAccountInvoker,
  options: { readonly cid?: () => number } = {}
): ConversationReplySender {
  const nextCid = options.cid ?? defaultCid;

  async function send(
    chatId: string,
    text: string,
    attaches: readonly Readonly<Record<string, unknown>>[]
  ): Promise<{ readonly providerMessageId: string }> {
    const frame = await client.invoke(MaxOpcode.messageSend, {
      chatId: chatIdOf(chatId),
      message: {
        text: text.slice(0, TEXT_LIMIT),
        cid: nextCid(),
        elements: [],
        attaches
      },
      notify: true
    });

    const message = frame.payload?.["message"];
    const id = typeof message === "object" && message !== null
      ? (message as Record<string, unknown>)["id"]
      : undefined;

    return {
      providerMessageId: typeof id === "number" || typeof id === "string" ? String(id) : ""
    };
  }

  return {
    async sendText(recipientId, text) {
      return await send(recipientId, text, []);
    },

    /**
     * Картинка. Двухшаговая, как у них всё: сначала спрашиваем адрес загрузки, потом
     * кладём туда файл обычной формой и только потом отправляем сообщение с полученным
     * токеном.
     */
    async sendFile(input) {
      if (input.kind !== "photo") {
        throw new Error("Аккаунт MAX пока отправляет только изображения");
      }
      const photoToken = await uploadPhoto(client, input.bytes, input.fileName);

      // MAX не принимает сообщение с пустым текстом — то же правило, что у бота.
      return await send(
        input.recipientId,
        input.caption === "" ? " " : input.caption,
        [{ _type: "PHOTO", photoToken }]
      );
    },

    /**
     * Что канал умеет отправлять.
     *
     * Пока только картинки — ровно как бот. У аккаунта есть и загрузка файлов, но она у
     * них устроена сложнее: адрес, загрузка кусками и ожидание отдельного события
     * «файл готов». Писать это вслепую, не проверив на живом аккаунте, значит завести
     * молчаливо ломающийся путь именно там, где менеджер ждёт доставки. Появится после
     * проверки канала.
     */
    supportsFileKind(kind: AttachmentKind) {
      return kind === "photo";
    }
  };
}

/**
 * Загрузка картинки.
 *
 * Номер картинки MAX прячет в самом адресе загрузки — параметром `photoIds`, — а токен
 * возвращает в ответе, разложенный по этому же номеру. Отсюда разбор адреса: без него
 * непонятно, какой из токенов наш.
 */
async function uploadPhoto(
  client: MaxAccountInvoker,
  bytes: Uint8Array,
  fileName: string
): Promise<string> {
  const frame = await client.invoke(MaxOpcode.photoUpload, {
    count: 1,
    type: 0,
    uploaderType: 0,
    profile: false
  });
  const url = frame.payload?.["url"];
  if (typeof url !== "string" || url === "") {
    throw new Error("MAX не дал адреса для загрузки картинки");
  }
  const photoId = new URL(url).searchParams.get("photoIds");

  const form = new FormData();
  form.append("file", new Blob([bytes]), safeName(fileName));
  const response = await fetch(url, { method: "POST", body: form });
  if (!response.ok) {
    throw new Error(`MAX не принял картинку, код ${String(response.status)}`);
  }
  const uploaded: unknown = await response.json();
  const photos = typeof uploaded === "object" && uploaded !== null
    ? (uploaded as Record<string, unknown>)["photos"]
    : undefined;
  if (typeof photos !== "object" || photos === null) {
    throw new Error("MAX принял картинку, но не вернул токен");
  }
  const entries = photos as Record<string, unknown>;
  const entry = (photoId !== null ? entries[photoId] : undefined) ?? Object.values(entries)[0];
  const token = typeof entry === "object" && entry !== null
    ? (entry as Record<string, unknown>)["token"]
    : undefined;
  if (typeof token !== "string" || token === "") {
    throw new Error("MAX принял картинку, но не вернул токен");
  }

  return token;
}

/**
 * Номер чата у MAX — целое число. Отправка «куда-то ещё» невозможна: адресат берётся из
 * диалога, а диалог мы завели сами, когда записывали входящее.
 */
function chatIdOf(recipientId: string): number {
  const chatId = Number(recipientId);
  if (!Number.isSafeInteger(chatId) || chatId === 0) {
    throw new Error(`Не похоже на чат MAX: ${recipientId}`);
  }

  return chatId;
}

function safeName(fileName: string): string {
  const cleaned = fileName.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-100);

  return cleaned === "" ? "image" : cleaned;
}

/**
 * `cid` — число, растущее со временем. Их клиент кладёт туда метку времени, и мы делаем
 * так же: два ответа в одну миллисекунду разводятся случайным хвостом.
 */
function defaultCid(): number {
  return Date.now() * 100 + Math.floor(Math.random() * 100);
}
