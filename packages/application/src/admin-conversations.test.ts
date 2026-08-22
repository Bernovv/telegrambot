import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import {
  AdminConversationsService,
  SendConversationReplyService,
  type AdminConversationsRepository,
  type ConversationReplyRepository,
  type PersonConversationsQuery,
  type QueueReplyInput,
  type QueueReplyResult
} from "./admin-conversations.js";

const CONTACT = "11111111-1111-4111-8111-111111111111";

function actor(permission: string): AdminRequestActor {
  return {
    adminId: "22222222-2222-4222-8222-222222222222",
    authSubject: "subject",
    roleCodes: ["sales_manager"],
    permission: permission as AdminRequestActor["permission"]
  };
}

class Repository implements AdminConversationsRepository {
  queries: PersonConversationsQuery[] = [];

  async getPersonConversations(query: PersonConversationsQuery) {
    this.queries.push(query);
    return { threads: [], messages: [], hasMore: false };
  }
}

function service(): { readonly repository: Repository; readonly instance: AdminConversationsService } {
  const repository = new Repository();
  return { repository, instance: new AdminConversationsService(repository) };
}

describe("переписка в панели", () => {
  it("требует своё право, а не право на базу контактов", async () => {
    // Карточка человека и содержание его личных разговоров — разные вещи, и день, когда
    // второе захотят открыть не всем, наступает раньше, чем кажется.
    const { instance } = service();

    await assert.rejects(
      () => instance.getPersonConversations({ actor: actor("outreach.read"), contactId: CONTACT }),
      /permission is invalid/
    );
  });

  it("отдаёт ленту тому, у кого право есть", async () => {
    const { repository, instance } = service();

    await instance.getPersonConversations({
      actor: actor("conversations.read"),
      contactId: CONTACT
    });

    assert.equal(repository.queries[0]?.contactId, CONTACT);
    assert.equal(repository.queries[0]?.limit, 50);
  });

  it("не пускает запрос за страницей в тысячу реплик", async () => {
    const { repository, instance } = service();

    await instance.getPersonConversations({
      actor: actor("conversations.read"),
      contactId: CONTACT,
      limit: 5_000
    });

    assert.equal(repository.queries[0]?.limit, 200);
  });

  it("пустой поиск — это отсутствие поиска, а не поиск пустой строки", async () => {
    // Иначе очищенный фильтр отдал бы всю ленту как «найденное» и сбил бы счётчик.
    const { repository, instance } = service();

    await instance.getPersonConversations({
      actor: actor("conversations.read"),
      contactId: CONTACT,
      search: "   "
    });

    assert.equal(repository.queries[0]?.search, null);
  });

  it("отвергает чужой идентификатор вместо того, чтобы искать по нему", async () => {
    const { instance } = service();

    await assert.rejects(
      () => instance.getPersonConversations({
        actor: actor("conversations.read"),
        contactId: "не-uuid"
      }),
      /contact id is invalid/
    );
  });
});

describe("ответ менеджера", () => {
  class ReplyRepository implements ConversationReplyRepository {
    calls: QueueReplyInput[] = [];

    async queueReply(input: QueueReplyInput): Promise<QueueReplyResult> {
      this.calls.push(input);
      return { status: "queued", messageId: input.messageId };
    }
  }

  function replyService(): {
    readonly repository: ReplyRepository;
    readonly instance: SendConversationReplyService;
  } {
    const repository = new ReplyRepository();
    let counter = 0;
    return {
      repository,
      instance: new SendConversationReplyService(repository, {
        newId: () => {
          counter += 1;
          return `message-${counter}`;
        }
      })
    };
  }

  const CONVERSATION = "33333333-3333-4333-8333-333333333333";
  const now = new Date("2026-08-23T15:00:00.000Z");

  it("требует право писать, а не только читать", async () => {
    // Читать переписку и отвечать в неё — разные права намеренно: первое можно дать
    // шире, второе говорит от имени компании.
    const { instance } = replyService();

    await assert.rejects(
      () => instance.execute({
        actor: actor("conversations.read"),
        conversationId: CONVERSATION,
        text: "привет",
        now
      }),
      /permission is invalid/
    );
  });

  it("ставит ответ в очередь и обрезает пробелы по краям", async () => {
    const { repository, instance } = replyService();

    const result = await instance.execute({
      actor: actor("conversations.write"),
      conversationId: CONVERSATION,
      text: "  Детский билет 1500 ₽  ",
      now
    });

    assert.equal(result.status, "queued");
    assert.equal(repository.calls[0]?.body, "Детский билет 1500 ₽");
    assert.equal(repository.calls[0]?.takeOver, false);
  });

  it("не пускает в очередь пустой ответ и слишком длинный", async () => {
    // Отправка, которая заведомо не пройдёт, иначе легла бы в ленту ответом и три часа
    // притворялась бы, что вот-вот дойдёт.
    const { instance } = replyService();

    await assert.rejects(
      () => instance.execute({
        actor: actor("conversations.write"),
        conversationId: CONVERSATION,
        text: "   ",
        now
      }),
      /reply text is invalid/
    );
    await assert.rejects(
      () => instance.execute({
        actor: actor("conversations.write"),
        conversationId: CONVERSATION,
        text: "я".repeat(4_001),
        now
      }),
      /reply text is invalid/
    );
  });

  it("перехват чужого диалога передаётся вниз только когда его попросили", async () => {
    const { repository, instance } = replyService();

    await instance.execute({
      actor: actor("conversations.write"),
      conversationId: CONVERSATION,
      text: "отвечаю я",
      takeOver: true,
      now
    });

    assert.equal(repository.calls[0]?.takeOver, true);
  });
});
