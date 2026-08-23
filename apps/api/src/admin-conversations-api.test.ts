import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AdminPermission } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";
import { resolveAttachmentPath } from "./admin-conversations-api.js";

describe("путь к файлу вложения", () => {
  it("собирает путь внутри папки вложений", () => {
    assert.equal(
      resolveAttachmentPath("/var/lib/telegrambot/conversation-files", "2026/08/abc.ogg"),
      "/var/lib/telegrambot/conversation-files/2026/08/abc.ogg"
    );
  });

  it("не выпускает за папку — даже если такой путь пришёл из базы", () => {
    // Путь кладём в базу мы сами, и сегодня он безопасен. Проверка нужна на день, когда
    // туда попадёт то, чего мы не ждали: тогда она — единственное, что стоит между
    // панелью и файлами сервера.
    for (const evil of [
      "../../../etc/passwd",
      "2026/../../etc/passwd",
      "/etc/passwd",
      "2026/08/../../../../root/.ssh/id_rsa"
    ]) {
      assert.equal(
        resolveAttachmentPath("/var/lib/telegrambot/conversation-files", evil),
        null,
        `путь ${evil} не должен выходить за папку`
      );
    }
  });

  it("без настроенной папки не отдаёт ничего", () => {
    // Скачивание выключено — файлов нет, и собирать путь от корня диска нельзя.
    assert.equal(resolveAttachmentPath("", "2026/08/abc.ogg"), null);
    assert.equal(resolveAttachmentPath("   ", "2026/08/abc.ogg"), null);
  });

  it("сама папка — не файл вложения", () => {
    assert.equal(
      resolveAttachmentPath("/var/lib/telegrambot/conversation-files", ""),
      null
    );
  });
});

/**
 * Отдача файла целиком, через настоящее приложение.
 *
 * Ради этого теста он и написан: первая версия ручки ставила заголовки по-экспрессовски
 * (`response.setHeader`), а api работает на Fastify — вызов падал с TypeError, браузер
 * получал 500 и показывал сломанную картинку. Ни типы, ни линтер этого не видели:
 * `@Res()` в Nest не типизирован, и на что он указывает, знает только адаптер.
 */
describe("отдача вложения по HTTP", () => {
  it("отдаёт файл байт в байт и не портит его по дороге", async () => {
    const root = await mkdtemp(join(tmpdir(), "conversation-files-"));
    const bytes = new Uint8Array(512);
    for (let index = 0; index < bytes.length; index += 1) {
      // Байты выше 127: именно на них ломается ответ, прочитанный как текст.
      bytes[index] = (index * 7) % 256;
    }
    await mkdir(join(root, "2026", "08"), { recursive: true });
    await writeFile(join(root, "2026", "08", `${ATTACHMENT_ID}.jpg`), bytes);

    const app = await application(root, {
      attachmentId: ATTACHMENT_ID,
      storagePath: `2026/08/${ATTACHMENT_ID}.jpg`,
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.byteLength
    });

    try {
      const response = await injectFile(app, ATTACHMENT_ID);

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["content-type"], "image/jpeg");
      assert.deepEqual(new Uint8Array(response.rawPayload), bytes);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("отвечает «не найдено», когда файла ещё нет у нас", async () => {
    const root = await mkdtemp(join(tmpdir(), "conversation-files-"));
    const app = await application(root, null);

    try {
      assert.equal((await injectFile(app, ATTACHMENT_ID)).statusCode, 404);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("отвечает «не найдено», когда строка есть, а файла на диске нет", async () => {
    // Папку перенесли или почистили руками. Для панели это то же самое, что «нет файла».
    const root = await mkdtemp(join(tmpdir(), "conversation-files-"));
    const app = await application(root, {
      attachmentId: ATTACHMENT_ID,
      storagePath: `2026/08/${ATTACHMENT_ID}.jpg`,
      fileName: null,
      mimeType: "image/jpeg",
      sizeBytes: 10
    });

    try {
      assert.equal((await injectFile(app, ATTACHMENT_ID)).statusCode, 404);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("не выпускает за папку вложений", async () => {
    const root = await mkdtemp(join(tmpdir(), "conversation-files-"));
    await writeFile(join(root, "secret.txt"), "не для панели");
    const app = await application(root, {
      attachmentId: ATTACHMENT_ID,
      storagePath: "../secret.txt",
      fileName: null,
      mimeType: "text/plain",
      sizeBytes: 13
    });

    try {
      assert.equal((await injectFile(app, ATTACHMENT_ID)).statusCode, 404);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

const ATTACHMENT_ID = "01a02a91-4b11-70e6-8db0-3e4838c5e5c2";
const ADMIN_ID = "00000000-0000-4000-8000-000000000099";
const CONTACT_ID = "3f2a5c88-1f11-4a2e-9c4d-77b0a1e2c3d4";
const CONVERSATION_ID = "8c1d7e60-2a3b-4c5d-8e9f-0a1b2c3d4e5f";

async function application(
  directory: string,
  stored: {
    readonly attachmentId: string;
    readonly storagePath: string;
    readonly fileName: string | null;
    readonly mimeType: string | null;
    readonly sizeBytes: number | null;
  } | null
) {
  const app = await createApiApplication({
    appVersion: "test",
    bodyLimitBytes: 262_144,
    readiness: {
      async execute() {
        return {
          service: "api" as const,
          status: "healthy" as const,
          version: "test",
          checkedAt: "2026-08-23T10:00:00.000Z",
          components: []
        };
      }
    },
    adminAuth: {
      tokenVerifier: {
        async verify() {
          return {
            subject: "auth-1",
            assuranceLevel: "aal1" as const,
            issuedAt: new Date("2026-08-23T10:00:00.000Z")
          };
        }
      },
      authorizer: {
        async execute(_token: unknown, permission: AdminPermission) {
          return {
            adminId: ADMIN_ID,
            authSubject: "auth-1",
            roleCodes: ["sales_manager"],
            permission
          };
        }
      }
    },
    adminConversations: {
      async listInbox() {
        return {
          items: [],
          hasMore: false,
          counts: { all: 0, mine: 0, unread: 0, unlinked: 0 }
        };
      },
      async getConversation() {
        return { threads: [], messages: [], hasMore: false };
      },
      async markConversationRead() {
        return { marked: true };
      },
      async linkConversation() {
        return { status: "linked" as const, contactId: CONTACT_ID };
      },
      async getPersonConversations() {
        return { threads: [], messages: [], hasMore: false };
      },
      async sendReply() {
        return { status: "not_found" as const };
      },
      async openAttachment() {
        return stored;
      },
      async sendFile() {
        return { status: "not_found" as const };
      }
    },
    conversationFiles: { directory }
  });
  await app.init();
  return app;
}

/**
 * Маршруты списка диалогов.
 *
 * Проверяем не содержимое ответа — оно приходит из службы, у которой свои тесты, — а то,
 * что маршруты вообще попадают куда надо. Пути здесь пересекаются: `GET /conversations`
 * рядом с `GET /conversations/people/:id`, а `GET /:id/messages` — с `POST /:id/messages`.
 * Перепутанный порядок объявления в Nest ловится только настоящим запросом.
 */
describe("маршруты переписки", () => {
  it("отдаёт список диалогов с числами у отборов", async () => {
    const root = await mkdtemp(join(tmpdir(), "conversation-files-"));
    const app = await application(root, null);

    try {
      const response = await inject(app, "GET", "/api/v1/conversations?filter=unread");

      assert.equal(response.statusCode, 200);
      assert.deepEqual(JSON.parse(response.body), {
        items: [],
        hasMore: false,
        counts: { all: 0, mine: 0, unread: 0, unlinked: 0 }
      });
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("не путает список с перепиской человека", async () => {
    const root = await mkdtemp(join(tmpdir(), "conversation-files-"));
    const app = await application(root, null);

    try {
      const person = await inject(
        app,
        "GET",
        `/api/v1/conversations/people/${CONTACT_ID}`
      );
      const thread = await inject(
        app,
        "GET",
        `/api/v1/conversations/${CONVERSATION_ID}/messages`
      );

      assert.equal(person.statusCode, 200);
      assert.equal(thread.statusCode, 200);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("отвергает неизвестный отбор, а не молча показывает всё", async () => {
    // Молчаливая замена отбора на «все» — худший вид ошибки: менеджер видит полный список
    // там, где просил непрочитанные, и считает, что непрочитанных нет.
    const root = await mkdtemp(join(tmpdir(), "conversation-files-"));
    const app = await application(root, null);

    try {
      const response = await inject(app, "GET", "/api/v1/conversations?filter=whatever");

      assert.equal(response.statusCode, 400);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("отмечает диалог прочитанным", async () => {
    const root = await mkdtemp(join(tmpdir(), "conversation-files-"));
    const app = await application(root, null);

    try {
      const response = await inject(
        app,
        "POST",
        `/api/v1/conversations/${CONVERSATION_ID}/read`
      );

      assert.equal(response.statusCode, 201);
      assert.deepEqual(JSON.parse(response.body), { marked: true });
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("привязывает безымянный диалог к карточке", async () => {
    const root = await mkdtemp(join(tmpdir(), "conversation-files-"));
    const app = await application(root, null);

    try {
      const response = await inject(
        app,
        "POST",
        `/api/v1/conversations/${CONVERSATION_ID}/link`,
        { contactId: CONTACT_ID }
      );

      assert.equal(response.statusCode, 201);
      assert.deepEqual(JSON.parse(response.body), {
        status: "linked",
        contactId: CONTACT_ID
      });
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("не принимает привязку без внятного телефона", async () => {
    const root = await mkdtemp(join(tmpdir(), "conversation-files-"));
    const app = await application(root, null);

    try {
      const response = await inject(
        app,
        "POST",
        `/api/v1/conversations/${CONVERSATION_ID}/link`,
        { phone: "нет" }
      );

      assert.equal(response.statusCode, 400);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function inject(
  app: Awaited<ReturnType<typeof createApiApplication>>,
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>
) {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  const headers = { authorization: "Bearer token" };
  // Две ветки, а не расплывание объекта: у `inject` перегрузки, и на объединении типов
  // TypeScript выбирает не ту, после чего у ответа пропадает даже `statusCode`.
  if (payload === undefined) {
    return await fastify.inject({ method, url, headers });
  }
  return await fastify.inject({ method, url, headers, payload });
}

async function injectFile(
  app: Awaited<ReturnType<typeof createApiApplication>>,
  attachmentId: string
) {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  return await fastify.inject({
    method: "GET",
    url: `/api/v1/conversations/attachments/${attachmentId}/file`,
    headers: { authorization: "Bearer token" }
  });
}
