import assert from "node:assert/strict";
import { test } from "node:test";
import type { TelegramAccountProxy } from "./options.js";
import { reconcileProxy, type ProxyStore, type StoredProxy } from "./proxy.js";

const socks5: TelegramAccountProxy = {
  kind: "socks5",
  host: "10.0.0.1",
  port: 1080,
  username: "crm",
  password: "secret"
};

class FakeProxyStore implements ProxyStore {
  readonly calls: string[] = [];
  private nextId = 100;

  constructor(private stored: StoredProxy[]) {}

  async list(): Promise<readonly StoredProxy[]> {
    return this.stored;
  }

  async add(proxy: TelegramAccountProxy): Promise<number> {
    const id = this.nextId++;
    this.calls.push(`add:${id}`);
    this.stored = [...this.stored, { id, enabled: true, proxy }];

    return id;
  }

  async enable(id: number): Promise<void> {
    this.calls.push(`enable:${id}`);
  }

  async disable(): Promise<void> {
    this.calls.push("disable");
  }

  async remove(id: number): Promise<void> {
    this.calls.push(`remove:${id}`);
  }
}

test("пустой список: прокси добавляется и сразу включается", async () => {
  const store = new FakeProxyStore([]);

  const result = await reconcileProxy(store, socks5);

  assert.equal(result.added, true);
  assert.equal(result.enabledId, 100);
  assert.equal(result.removed, 0);
  assert.deepEqual(store.calls, ["add:100"]);
});

test("тот же прокси уже включён: ничего не трогаем", async () => {
  const store = new FakeProxyStore([{ id: 7, enabled: true, proxy: socks5 }]);

  const result = await reconcileProxy(store, socks5);

  assert.deepEqual(result, { enabledId: 7, added: false, removed: 0 });
  assert.deepEqual(store.calls, []);
});

test("тот же прокси есть, но выключен: включаем, а не заводим второй", async () => {
  const store = new FakeProxyStore([{ id: 7, enabled: false, proxy: socks5 }]);

  const result = await reconcileProxy(store, socks5);

  assert.equal(result.added, false);
  assert.deepEqual(store.calls, ["enable:7"]);
});

test("сменился пароль: это другой прокси, старая запись уезжает", async () => {
  const store = new FakeProxyStore([
    { id: 7, enabled: true, proxy: { ...socks5, password: "старый" } }
  ]);

  const result = await reconcileProxy(store, socks5);

  assert.equal(result.added, true);
  assert.equal(result.removed, 1);
  assert.deepEqual(store.calls, ["add:100", "remove:7"]);
});

test("лишние записи от прошлых настроек удаляются", async () => {
  const store = new FakeProxyStore([
    { id: 1, enabled: false, proxy: { ...socks5, host: "старый.хост" } },
    { id: 2, enabled: true, proxy: socks5 },
    { id: 3, enabled: false, proxy: { kind: "mtproto", host: "m", port: 443, secret: "ab" } }
  ]);

  const result = await reconcileProxy(store, socks5);

  assert.equal(result.enabledId, 2);
  assert.equal(result.removed, 2);
  assert.deepEqual(store.calls, ["remove:1", "remove:3"]);
});

// Прокси убрали из `.env` — значит, ходить надо напрямую. Оставить запись «на всякий
// случай» здесь нельзя: TDLib помнит список сам и продолжил бы ходить через неё молча.
test("прокси убран из настроек: выключаем и чистим список", async () => {
  const store = new FakeProxyStore([{ id: 7, enabled: true, proxy: socks5 }]);

  const result = await reconcileProxy(store, null);

  assert.deepEqual(result, { enabledId: null, added: false, removed: 1 });
  assert.deepEqual(store.calls, ["disable", "remove:7"]);
});
