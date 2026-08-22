import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import {
  AdminConversationsService,
  type AdminConversationsRepository,
  type PersonConversationsQuery
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
