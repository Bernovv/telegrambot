/**
 * Перенос боевых данных MAX в общую базу.
 *
 * Это единственный необратимый шаг объединения, поэтому здесь два правила.
 *
 * **По умолчанию — сухой прогон.** Скрипт делает всю работу целиком, а в конце откатывает
 * транзакцию. Это не «проверка вхолостую», где половину шагов пропускают: база по-настоящему
 * проверяет каждый чек-констрейнт и каждый внешний ключ, а потом всё исчезает. Прогон,
 * который прошёл, значит, что данные действительно помещаются.
 *
 * **Повтор ничего не портит.** Идентификаторы целевых строк выводятся из идентификаторов
 * исходных детерминированно (uuid v5 от постоянного пространства имён), и каждая вставка
 * идёт с `on conflict do nothing`. Прогнать импорт дважды — то же самое, что прогнать один
 * раз; прогнать после частичного сбоя — дописать недостающее.
 *
 *   node --env-file=.env --import tsx scripts/max-import.ts            # сухой прогон
 *   node --env-file=.env --import tsx scripts/max-import.ts --apply    # запись
 *
 * Нужны две строки подключения: `MAX_DATABASE_URL` — база MAX-бота (читается),
 * `DATABASE_DIRECT_URL` — общая база (пишется).
 *
 * Чего скрипт не делает намеренно:
 *
 * - **Не переносит проводки кошелька построчно.** Переносится итоговый баланс одной
 *   транзакцией `MIGRATION_OPENING_BALANCE` — тип для этого и заведён. Историю начислений
 *   в MAX можно прочитать в старой базе, а смешивать две истории в одной ленте значит
 *   получить ленту, которой нельзя верить.
 * - **Не переносит билеты.** В MAX их не было вовсе.
 * - **Не трогает исходную базу.** Ни одной записи в неё.
 */
import { createHash } from "node:crypto";
import pg from "pg";

/** Пространство имён для выведенных идентификаторов. Менять нельзя: от него зависит повтор. */
const NAMESPACE = "6f0a1f52-3a8e-4a3b-9f2a-1c1d9e5b7a10";

/** Учётная запись, от имени которой заведены перенесённые строки. Миграция 20260822160000. */
const IMPORT_ADMIN_ID = "00000000-0000-4000-8000-000000000002";

/** Как тарифы MAX называются в общем каталоге. */
const PRODUCT_CODES: Readonly<Record<string, string>> = {
  standard: "adult_standard",
  vip: "adult_vip",
  family_standard: "family_standard",
  family_vip: "family_vip"
};

/** Статусы заказа MAX в статусы общей схемы. */
const ORDER_STATUSES: Readonly<Record<string, string>> = {
  draft: "draft",
  awaiting_offer: "awaiting_offer",
  pending_payment: "awaiting_payment",
  awaiting_payment: "awaiting_payment",
  payment_processing: "payment_processing",
  paid: "paid",
  cancelled: "cancelled",
  expired: "expired",
  refunded: "refunded",
  partially_refunded: "partially_refunded"
};

interface Options {
  readonly apply: boolean;
  readonly eventSlug: string;
}

interface Counters {
  [step: string]: { inserted: number; skipped: number };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const source = new pg.Client({ connectionString: required("MAX_DATABASE_URL") });
  const target = new pg.Client({ connectionString: required("DATABASE_DIRECT_URL") });
  await source.connect();
  await target.connect();

  const counters: Counters = {};
  const warnings: string[] = [];

  try {
    await target.query("begin");

    const event = await resolveEvent(target, options.eventSlug);
    const catalog = await resolveCatalog(target, event.id);
    console.log(`Мероприятие: ${event.title} (${options.eventSlug})`);
    console.log(`Тарифы в каталоге: ${[...catalog.keys()].join(", ")}\n`);

    await importUsers(source, target, counters);
    await importContacts(source, target, counters);
    await importWallets(source, target, counters, warnings);
    await importReferrals(source, target, counters, warnings);
    // Документы и версии оферты — до заказов: у заказа с принятой офертой обязана быть
    // ссылка на редакцию, с которой согласились, иначе согласие висит в воздухе.
    await importOfferVersions(source, target, counters);
    await importOrders(source, target, event, catalog, counters, warnings);
    await importOfferAcceptances(source, target, counters, warnings);

    report(counters, warnings);
    await reconcile(source, target);

    if (options.apply) {
      await target.query("commit");
      console.log("\nЗаписано.");
    } else {
      await target.query("rollback");
      console.log("\nСухой прогон: всё откачено, в общей базе ничего не изменилось.");
      console.log("Записать по-настоящему — тот же запуск с ключом --apply.");
    }
  } catch (error) {
    await target.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await source.end();
    await target.end();
  }
}

/**
 * Мероприятие, к которому относятся заказы MAX.
 *
 * Ищется по слагу и обязано существовать: собирать снимки заказа не из чего, если каталога
 * нет, а придумывать их — значит записать покупателю цену, которой не было.
 */
async function resolveEvent(
  target: pg.Client,
  slug: string
): Promise<{ readonly id: string; readonly title: string }> {
  const found = await target.query<{ id: string; title: string }>(
    "select id, title from public.events where slug = $1::text",
    [slug]
  );
  const event = found.rows[0];
  if (!event) {
    throw new Error(`Мероприятие со слагом ${slug} не найдено в общей базе`);
  }
  return event;
}

interface CatalogEntry {
  readonly productId: string;
  readonly title: string;
  readonly pricingRuleId: string;
}

/**
 * Каталог мероприятия по кодам тарифов.
 *
 * Правило цены нужно как ссылка: колонка обязательная. Берётся правило с наименьшим
 * минимальным количеством — то, по которому продают в одиночку. Цену при этом берём не из
 * него, а из самого заказа MAX: важно, сколько человек заплатил, а не сколько стоит сейчас.
 */
async function resolveCatalog(
  target: pg.Client,
  eventId: string
): Promise<Map<string, CatalogEntry>> {
  const rows = await target.query<{
    code: string;
    product_id: string;
    title: string;
    pricing_rule_id: string | null;
  }>(
    `select product.code, product.id as product_id, product.title,
            (
              select rule.id from public.pricing_rules rule
               where rule.product_id = product.id and rule.is_active
               order by rule.minimum_quantity, rule.created_at
               limit 1
            ) as pricing_rule_id
       from public.ticket_products product
      where product.event_id = $1::uuid and product.is_active`,
    [eventId]
  );

  const catalog = new Map<string, CatalogEntry>();
  for (const row of rows.rows) {
    if (row.pricing_rule_id === null) {
      throw new Error(`У тарифа ${row.code} нет активного правила цены — заказ не собрать`);
    }
    catalog.set(row.code, {
      productId: row.product_id,
      title: row.title,
      pricingRuleId: row.pricing_rule_id
    });
  }
  return catalog;
}

/** Человек и его опознаватель в MAX. */
async function importUsers(
  source: pg.Client,
  target: pg.Client,
  counters: Counters
): Promise<void> {
  const users = await source.query<{
    id: string;
    max_user_id: string;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    phone_verified: boolean;
    phone: string | null;
    is_blocked: boolean;
    bot_state: string;
    created_at: Date;
    updated_at: Date;
  }>(`select id, max_user_id, username, first_name, last_name, phone_verified, phone,
             is_blocked, bot_state, created_at, updated_at
        from users order by created_at`);

  for (const user of users.rows) {
    const userId = derive("user", user.id);
    // Телефон в MAX хранится на самом человеке, и его наличие — это и есть «известен».
    // `verified` ставим только тем, кто подтвердил его кнопкой: остальным — `imported`.
    const phoneStatus = user.phone === null
      ? "unknown"
      : user.phone_verified ? "verified" : "imported";

    await count(counters, "люди", target.query(
      `insert into public.users (
         id, display_name, first_name, last_name, phone_status,
         registered_at, last_seen_at, is_blocked, metadata, created_at, updated_at
       ) values ($1::uuid, $2::text, $3::text, $4::text, $5::text,
                 $6::timestamptz, $7::timestamptz, $8::boolean, $9::jsonb, $6, $7)
       on conflict (id) do nothing`,
      [
        userId,
        displayName(user.first_name, user.last_name, user.username),
        user.first_name,
        user.last_name,
        phoneStatus,
        user.created_at,
        user.updated_at,
        user.is_blocked,
        JSON.stringify({ importedFrom: "max", maxUserId: user.id })
      ]
    ));

    await count(counters, "опознаватели MAX", target.query(
      `insert into public.messenger_identities (
         id, user_id, channel, external_user_id, username, username_normalized,
         first_seen_at, last_seen_at, is_bot_blocked
       ) values ($1::uuid, $2::uuid, 'max', $3::text, $4::text, $5::text,
                 $6::timestamptz, $7::timestamptz, $8::boolean)
       on conflict (channel, external_user_id) do nothing`,
      [
        derive("identity", user.id),
        userId,
        user.max_user_id,
        user.username,
        user.username === null ? null : user.username.replace(/^@+/, "").toLowerCase(),
        user.created_at,
        user.updated_at,
        // `stopped` и `dialog_removed` в MAX значат ровно то же, что «заблокировал бота».
        user.bot_state !== "active"
      ]
    ));
  }
}

/**
 * Телефоны.
 *
 * Источник — `max_contact`, а не `import`: человек нажал кнопку в мессенджере, а не приехал
 * таблицей. На источнике телефона держится ответ, есть ли у нас основание звонить.
 */
async function importContacts(
  source: pg.Client,
  target: pg.Client,
  counters: Counters
): Promise<void> {
  const rows = await source.query<{
    id: string;
    phone: string;
    phone_verified: boolean;
    phone_verified_at: Date | null;
    created_at: Date;
  }>(`select id, phone, phone_verified, phone_verified_at, created_at
        from users where phone is not null and btrim(phone) <> ''`);

  for (const row of rows.rows) {
    const phone = normalizePhone(row.phone);
    if (phone === null) {
      continue;
    }
    await count(counters, "телефоны", target.query(
      `insert into public.user_contacts (
         id, user_id, contact_type, value_normalized, source,
         verification_status, is_primary, verified_at, created_at, updated_at
       ) values ($1::uuid, $2::uuid, 'phone', $3::text, 'max_contact',
                 $4::text, true, $5::timestamptz, $6::timestamptz, $6)
       on conflict (id) do nothing`,
      [
        derive("contact", row.id),
        derive("user", row.id),
        phone,
        row.phone_verified ? "verified" : "imported",
        row.phone_verified_at,
        row.created_at
      ]
    ));
  }
}

/**
 * Кошельки: итоговый баланс одной проводкой.
 *
 * Историю начислений MAX построчно не переносим — она остаётся в старой базе. Перенос
 * итога одной транзакцией `MIGRATION_OPENING_BALANCE` даёт ровно то, что человеку важно:
 * сколько у него денег. Смешивать две истории в одной ленте значит получить ленту, по
 * которой нельзя сойтись ни с одной из них.
 */
async function importWallets(
  source: pg.Client,
  target: pg.Client,
  counters: Counters,
  warnings: string[]
): Promise<void> {
  const rows = await source.query<{
    id: string;
    user_id: string;
    cached_available: string;
    cached_held: string;
    status: string;
    created_at: Date;
  }>(`select id, user_id, cached_available::text, cached_held::text, status, created_at
        from wallet_accounts order by created_at`);

  for (const row of rows.rows) {
    const available = BigInt(row.cached_available);
    const held = BigInt(row.cached_held);
    const accountId = derive("wallet", row.id);

    if (held > 0n) {
      // Удержание — это незавершённая покупка. Переносить его нечем: заказ в общей схеме
      // держит деньги своей проводкой, а не отдельной строкой, и восстановить связь вслепую
      // значит выдумать её.
      warnings.push(
        `кошелёк ${row.id}: удержано ${held} копеек — перенесено не будет, разобрать руками`
      );
    }

    await count(counters, "кошельки", target.query(
      `insert into public.wallet_accounts (
         id, user_id, currency, cached_available_kopecks, cached_held_kopecks,
         status, balance_version, created_at, updated_at
       ) values ($1::uuid, $2::uuid, 'RUB', $3::bigint, 0,
                 $4::text, 1, $5::timestamptz, $5)
       on conflict (user_id, currency) do nothing`,
      [accountId, derive("user", row.user_id), available.toString(),
       row.status === "active" ? "active" : "blocked", row.created_at]
    ));

    if (available === 0n) {
      continue;
    }

    const transactionId = derive("wallet-open", row.id);
    await count(counters, "начальные балансы", target.query(
      `insert into public.wallet_transactions (
         id, wallet_account_id, transaction_type, status, idempotency_key,
         reference_type, reference_id, actor_type, actor_id, reason, created_at, posted_at
       ) values ($1::uuid, $2::uuid, 'MIGRATION_OPENING_BALANCE', 'posted', $3::text,
                 'migration', $4::text, 'system', $5::uuid,
                 'Перенос баланса из MAX-бота', $6::timestamptz, $6)
       on conflict (idempotency_key) do nothing`,
      [transactionId, accountId, `max-migration:${row.id}`, row.id, IMPORT_ADMIN_ID, row.created_at]
    ));
    await count(counters, "проводки баланса", target.query(
      `insert into public.wallet_entries (
         id, wallet_account_id, wallet_transaction_id, direction, amount_kopecks,
         bucket, effective_at
       ) values ($1::uuid, $2::uuid, $3::uuid, 'credit', $4::bigint,
                 'cash_equivalent', $5::timestamptz)
       on conflict (id) do nothing`,
      [derive("wallet-entry", row.id), accountId, transactionId,
       available.toString(), row.created_at]
    ));
  }
}

/**
 * Партнёрские связи.
 *
 * В MAX партнёр опознаётся своим `partner_code`, в общей схеме — идентификатором человека.
 * Соответствие берётся из самой строки связи: там уже записан `partner_user_id`, поэтому
 * гадать по коду не приходится, и отдельная таблица сопоставления не нужна.
 */
async function importReferrals(
  source: pg.Client,
  target: pg.Client,
  counters: Counters,
  warnings: string[]
): Promise<void> {
  const rows = await source.query<{
    id: string;
    referred_user_id: string;
    partner_user_id: string;
    partner_code_used: string;
    attributed_at: Date;
    is_qualifying: boolean;
    created_at: Date;
  }>(`select id, referred_user_id, partner_user_id, partner_code_used,
             attributed_at, is_qualifying, created_at
        from referral_relations order by created_at`);

  for (const row of rows.rows) {
    if (row.referred_user_id === row.partner_user_id) {
      warnings.push(`связь ${row.id}: партнёр и приглашённый — один человек, пропущена`);
      continue;
    }
    await count(counters, "партнёрские связи", target.query(
      `insert into public.referral_attributions (
         id, referred_user_id, referrer_user_id, partner_code,
         attributed_at, qualified_at, created_at
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::text,
                 $5::timestamptz, $6::timestamptz, $7::timestamptz)
       on conflict (referred_user_id) do nothing`,
      [
        derive("referral", row.id),
        derive("user", row.referred_user_id),
        derive("user", row.partner_user_id),
        row.partner_code_used,
        row.attributed_at,
        row.is_qualifying ? row.attributed_at : null,
        row.created_at
      ]
    ));
  }
}

/**
 * Заказы и их состав.
 *
 * Самое трудоёмкое место: в MAX заказ плоский (тариф и количества), в общей схеме — строки
 * состава со ссылкой на конкретный тариф каталога и обязательными снимками.
 *
 * Цена берётся из самого заказа, а не из каталога: важно, сколько человек заплатил, а не
 * сколько тариф стоит сегодня. Если сумма строки не делится на количество нацело, заказ
 * пропускается с предупреждением — молча округлить значило бы переписать чек.
 */
async function importOrders(
  source: pg.Client,
  target: pg.Client,
  event: { readonly id: string; readonly title: string },
  catalog: Map<string, CatalogEntry>,
  counters: Counters,
  warnings: string[]
): Promise<void> {
  const rows = await source.query<{
    id: string;
    order_number: string;
    user_id: string;
    ticket_type: string;
    adult_quantity: number;
    child_quantity: number;
    adult_amount_kopecks: string;
    child_amount_kopecks: string;
    amount_kopecks: string;
    status: string;
    offer_version_id: string | null;
    offer_accepted_at: Date | null;
    paid_at: Date | null;
    deleted_at: Date | null;
    deleted_reason: string | null;
    created_at: Date;
    updated_at: Date;
  }>(`select id, order_number, user_id, ticket_type, adult_quantity, child_quantity,
             adult_amount_kopecks::text, child_amount_kopecks::text, amount_kopecks::text,
             status, offer_version_id, offer_accepted_at, paid_at,
             deleted_at, deleted_reason, created_at, updated_at
        from orders order by created_at`);

  const childEntry = catalog.get("child");

  for (const row of rows.rows) {
    const code = PRODUCT_CODES[row.ticket_type];
    const entry = code === undefined ? undefined : catalog.get(code);
    if (!entry) {
      warnings.push(`заказ ${row.order_number}: тариф «${row.ticket_type}» не найден в каталоге`);
      continue;
    }

    const lines = orderLines(row, entry, childEntry);
    if (typeof lines === "string") {
      warnings.push(`заказ ${row.order_number}: ${lines}`);
      continue;
    }

    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0n);
    const total = BigInt(row.amount_kopecks);
    if (subtotal !== total) {
      // Доплаты (`is_upsell`) в MAX сохраняют разницу, а не полную цену: состав такого
      // заказа не сходится с суммой, и придумывать недостающую строку нельзя.
      warnings.push(
        `заказ ${row.order_number}: состав на ${subtotal} копеек, а в заказе ${total} — пропущен`
      );
      continue;
    }

    const orderId = derive("order", row.id);
    const status = ORDER_STATUSES[row.status] ?? "cancelled";
    if (ORDER_STATUSES[row.status] === undefined) {
      warnings.push(`заказ ${row.order_number}: статус «${row.status}» неизвестен, записан как отменённый`);
    }
    const offerVersionId = row.offer_version_id === null
      ? null
      : derive("offer-version", row.offer_version_id);

    // Заказ собирается тем же путём, что живая покупка, и это не формальность: схема
    // запрещает менять состав после принятия оферты и разрешает не всякий переход статуса.
    // Обойти запреты было бы можно — и тогда перенесённый заказ оказался бы в состоянии,
    // в которое настоящий прийти не может.
    const opening = status === "draft" ? "draft" : "awaiting_offer";

    // Заказ переносится целиком или не переносится вовсе: всё идёт одной транзакцией.
    // Поэтому «заказ уже есть» значит «уже перенесён со всем составом», и трогать его
    // второй раз нельзя — состав после принятия оферты неизменяем, и попытка дописать
    // строку упрётся в триггер вместо того, чтобы тихо ничего не сделать.
    const inserted = await target.query<{ readonly id: string }>(
      `insert into public.orders (
         id, number, public_token_hash, creation_idempotency_key, creation_request_hash,
         user_id, event_id, status, currency, subtotal_kopecks, discount_kopecks,
         total_kopecks, wallet_applied_kopecks, external_due_kopecks, tax_kopecks,
         snapshot_schema_version, event_snapshot, pricing_snapshot,
         expires_at, source, channel, offer_version_id, created_at, updated_at
       ) values (
         $1::uuid, $2::text, $3::text, $4::text, $5::text,
         $6::uuid, $7::uuid, $8::text, 'RUB', $9::bigint, 0,
         $9::bigint, 0, $9::bigint, 0,
         1, $10::jsonb, $11::jsonb,
         $12::timestamptz, 'max_import', 'max', $13::uuid, $14::timestamptz, $15::timestamptz
       )
       on conflict (id) do nothing
       returning id`,
      [
        orderId,
        orderNumber(row.order_number),
        // Постоянный маркер вместо настоящего токена: ссылка на оплату у перенесённого
        // заказа не работает и работать не должна — он уже оплачен или уже не нужен.
        sha256(`max-order-token:${row.id}`),
        `max-import:${row.id}`,
        sha256(`max-order-request:${row.id}`),
        derive("user", row.user_id),
        event.id,
        opening,
        total.toString(),
        JSON.stringify({ title: event.title, importedFrom: "max" }),
        JSON.stringify({
          schemaVersion: 1,
          lines: lines.map((line) => ({
            productCode: line.code,
            quantity: line.quantity,
            unitPriceKopecks: line.unitPrice.toString()
          }))
        }),
        // Бронь перенесённого заказа истекла в момент его создания: держать место ему нечего.
        new Date(row.created_at.getTime() + 1000),
        offerVersionId,
        row.created_at,
        row.updated_at
      ]
    );

    const orders = counters["заказы"] ?? { inserted: 0, skipped: 0 };
    if (inserted.rowCount === 0) {
      orders.skipped += 1;
      counters["заказы"] = orders;
      continue;
    }
    orders.inserted += 1;
    counters["заказы"] = orders;

    for (const [index, line] of lines.entries()) {
      await count(counters, "строки заказов", target.query(
        `insert into public.order_items (
           id, order_id, product_id, product_snapshot, quantity, inventory_units,
           unit_price_kopecks, line_total_kopecks, pricing_rule_id, pricing_snapshot,
           metadata, created_at
         ) values (
           $1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::int, $5::int,
           $6::bigint, $7::bigint, $8::uuid, $9::jsonb,
           $10::jsonb, $11::timestamptz
         )
         on conflict (id) do nothing`,
        [
          derive("order-item", `${row.id}:${index}`),
          orderId,
          line.productId,
          JSON.stringify({ code: line.code, title: line.title, importedFrom: "max" }),
          line.quantity,
          line.unitPrice.toString(),
          line.lineTotal.toString(),
          line.pricingRuleId,
          JSON.stringify({
            schemaVersion: 1,
            unitPriceKopecks: line.unitPrice.toString(),
            source: "max_import"
          }),
          JSON.stringify({ importedFrom: "max" }),
          row.created_at
        ]
      ));
    }

    // Дальше заказ идёт по разрешённым переходам до своего настоящего состояния.
    for (const step of statusPath(opening, status)) {
      await target.query(
        `update public.orders
            set status = $2::text,
                offer_accepted_at = coalesce(offer_accepted_at, $3::timestamptz),
                paid_at = coalesce(paid_at, $4::timestamptz),
                updated_at = $5::timestamptz
          where id = $1::uuid and status <> $2::text`,
        [
          orderId,
          step,
          step === "awaiting_payment" ? row.offer_accepted_at : null,
          step === "paid" ? row.paid_at : null,
          row.updated_at
        ]
      );
    }

    if (row.deleted_at !== null) {
      // Скрытый заказ обязан назвать, кто и почему его скрыл, — иначе схема его не примет,
      // и это правильно: «пропал из отчёта без объяснения» уже случалось.
      const reason = (row.deleted_reason ?? "").trim();
      await target.query(
        `update public.orders
            set excluded_at = $2::timestamptz,
                excluded_reason = $3::text,
                excluded_by_admin_id = $4::uuid
          where id = $1::uuid and excluded_at is null`,
        [
          orderId,
          row.deleted_at,
          reason === "" ? "Скрыт в MAX-боте" : `Скрыт в MAX-боте: ${reason}`.slice(0, 500),
          IMPORT_ADMIN_ID
        ]
      );
    }
  }
}

/**
 * Путь по статусам от начального до настоящего.
 *
 * Схема разрешает не всякий переход, и прыгнуть из «ждём оферту» сразу в «возвращён»
 * нельзя. Перенесённый заказ проходит те же ступени, что прошёл бы живой.
 */
function statusPath(from: string, to: string): readonly string[] {
  if (from === to) {
    return [];
  }
  const path: string[] = [];
  if (from === "awaiting_offer" && to !== "awaiting_offer") {
    path.push("awaiting_payment");
  }
  if (to === "awaiting_payment") {
    return path;
  }
  if (to === "paid" || to === "refunded" || to === "partially_refunded") {
    path.push("paid");
  }
  if (to !== "paid") {
    path.push(to);
  }
  return path.filter((step, index) => path.indexOf(step) === index && step !== from);
}

interface OrderLine {
  readonly code: string;
  readonly title: string;
  readonly productId: string;
  readonly pricingRuleId: string;
  readonly quantity: number;
  readonly unitPrice: bigint;
  readonly lineTotal: bigint;
}

/** Состав заказа: взрослые билеты и, если есть, детские. Строка в ответе — причина отказа. */
function orderLines(
  row: {
    readonly adult_quantity: number;
    readonly child_quantity: number;
    readonly adult_amount_kopecks: string;
    readonly child_amount_kopecks: string;
  },
  adult: CatalogEntry,
  child: CatalogEntry | undefined
): readonly OrderLine[] | string {
  const lines: OrderLine[] = [];

  if (row.adult_quantity > 0) {
    const amount = BigInt(row.adult_amount_kopecks);
    const quantity = BigInt(row.adult_quantity);
    if (amount % quantity !== 0n) {
      return `сумма взрослых билетов ${amount} не делится на ${quantity} нацело`;
    }
    lines.push({
      code: "adult",
      title: adult.title,
      productId: adult.productId,
      pricingRuleId: adult.pricingRuleId,
      quantity: row.adult_quantity,
      unitPrice: amount / quantity,
      lineTotal: amount
    });
  }

  if (row.child_quantity > 0) {
    if (!child) {
      return "в заказе есть детские билеты, а тарифа «child» в каталоге нет";
    }
    const amount = BigInt(row.child_amount_kopecks);
    const quantity = BigInt(row.child_quantity);
    if (amount % quantity !== 0n) {
      return `сумма детских билетов ${amount} не делится на ${quantity} нацело`;
    }
    lines.push({
      code: "child",
      title: child.title,
      productId: child.productId,
      pricingRuleId: child.pricingRuleId,
      quantity: row.child_quantity,
      unitPrice: amount / quantity,
      lineTotal: amount
    });
  }

  return lines.length === 0 ? "в заказе нет ни одного билета" : lines;
}

/**
 * Документы и версии оферты.
 *
 * Переносятся раньше заказов: заказ с принятой офертой обязан ссылаться на редакцию, с
 * которой согласились. Идентификаторы выводятся так же, как у всего остального, поэтому
 * повтор их не задваивает.
 *
 * Все перенесённые версии заводятся неактивными: активная редакция — та, что показывает
 * панель сегодня, и переносом истории её подменять нельзя.
 */
async function importOfferVersions(
  source: pg.Client,
  target: pg.Client,
  counters: Counters
): Promise<void> {
  const documents = await source.query<{
    id: string; title: string; source_type: string; source_url: string | null;
    status: string; created_at: Date;
  }>("select id, title, source_type, source_url, status, created_at from offer_documents");

  for (const document of documents.rows) {
    await count(counters, "документы оферты", target.query(
      `insert into public.offer_documents (id, title, source_type, source_url, status, created_at)
       values ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::timestamptz)
       on conflict (id) do nothing`,
      [
        derive("offer-document", document.id),
        document.title,
        // Виды источника у схем совпадают: google_docs, upload, html.
        document.source_type,
        document.source_url,
        // Состояния — нет: в MAX документ `active`, в общей схеме — `published`.
        document.status === "active" ? "published" : "archived",
        document.created_at
      ]
    ));
  }

  const versions = await source.query<{
    id: string; offer_document_id: string; version_number: number; public_url: string;
    storage_path: string | null; content_type: string; sha256: string; published_at: Date;
    display_text_snapshot: string | null;
  }>(`select id, offer_document_id, version_number, public_url, storage_path, content_type,
             sha256, published_at, display_text_snapshot from offer_versions`);

  for (const version of versions.rows) {
    await count(counters, "версии оферты", target.query(
      `insert into public.offer_versions (
         id, offer_document_id, version_number, public_url, storage_path, content_type,
         sha256, published_at, is_active, display_text_snapshot
       ) values ($1::uuid, $2::uuid, $3::int, $4::text, $5::text, $6::text,
                 $7::text, $8::timestamptz, false, $9::text)
       on conflict (id) do nothing`,
      [
        derive("offer-version", version.id),
        derive("offer-document", version.offer_document_id),
        // Номер версии уникален внутри документа, а документы у нас свои — сдвигаем на
        // тысячу, чтобы перенесённые не столкнулись с уже опубликованными.
        version.version_number + 1000,
        version.public_url,
        // Путь к файлу обязателен: у версий MAX без него берётся сам адрес — файл там же.
        version.storage_path ?? version.public_url,
        version.content_type,
        version.sha256,
        version.published_at,
        version.display_text_snapshot
      ]
    ));
  }

}

/**
 * Согласия с офертой.
 *
 * Согласие без текста, с которым согласились, — не согласие: такие строки пропускаются с
 * предупреждением, а не переносятся наполовину.
 */
async function importOfferAcceptances(
  source: pg.Client,
  target: pg.Client,
  counters: Counters,
  warnings: string[]
): Promise<void> {
  const acceptances = await source.query<{
    id: string; user_id: string; order_id: string; offer_version_id: string;
    accepted_at: Date; max_update_id: string | null; max_message_id: string | null;
    max_callback_id: string | null; acceptance_text_snapshot: string | null;
  }>(`select id, user_id, order_id, offer_version_id, accepted_at,
             max_update_id, max_message_id, max_callback_id, acceptance_text_snapshot
        from offer_acceptances`);

  for (const acceptance of acceptances.rows) {
    const text = acceptance.acceptance_text_snapshot;
    if (text === null || text.trim() === "") {
      warnings.push(`согласие ${acceptance.id}: нет текста оферты — перенесено не будет`);
      continue;
    }
    await count(counters, "согласия с офертой", target.query(
      `insert into public.offer_acceptances (
         id, user_id, order_id, offer_version_id, accepted_at, channel,
         messenger_identity_id, telegram_update_id, telegram_message_id,
         callback_query_id, acceptance_text_snapshot, evidence_schema_version, evidence
       )
       select $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, 'max',
              identity.id, $6::text, $7::text, $8::text, $9::text, 1, $10::jsonb
         from public.messenger_identities identity
        where identity.user_id = $2::uuid and identity.channel = 'max'
       on conflict do nothing`,
      [
        derive("offer-acceptance", acceptance.id),
        derive("user", acceptance.user_id),
        derive("order", acceptance.order_id),
        derive("offer-version", acceptance.offer_version_id),
        acceptance.accepted_at,
        acceptance.max_update_id,
        acceptance.max_message_id,
        acceptance.max_callback_id,
        text,
        JSON.stringify({ schemaVersion: 1, importedFrom: "max", sourceId: acceptance.id })
      ]
    ));
  }
}

/** Сверка: сколько было в MAX и сколько стало в общей базе. */
async function reconcile(source: pg.Client, target: pg.Client): Promise<void> {
  const before = await source.query<{
    users: string; paid_orders: string; paid_sum: string; wallet_sum: string;
  }>(`select
        (select count(*) from users)::text as users,
        (select count(*) from orders where status = 'paid')::text as paid_orders,
        (select coalesce(sum(amount_kopecks), 0) from orders where status = 'paid')::text as paid_sum,
        (select coalesce(sum(cached_available), 0) from wallet_accounts)::text as wallet_sum`);

  const after = await target.query<{
    users: string; paid_orders: string; paid_sum: string; wallet_sum: string;
  }>(`select
        (select count(*) from public.messenger_identities where channel = 'max')::text as users,
        (select count(*) from public.orders where channel = 'max' and status = 'paid')::text as paid_orders,
        (select coalesce(sum(total_kopecks), 0) from public.orders where channel = 'max' and status = 'paid')::text as paid_sum,
        (select coalesce(sum(entry.amount_kopecks), 0)
           from public.wallet_entries entry
           join public.wallet_transactions tx on tx.id = entry.wallet_transaction_id
          where tx.transaction_type = 'MIGRATION_OPENING_BALANCE')::text as wallet_sum`);

  const source_ = before.rows[0];
  const target_ = after.rows[0];
  if (!source_ || !target_) {
    throw new Error("Сверка не получила ни одной строки — проверьте подключения");
  }

  const rows: readonly (readonly [string, string, string])[] = [
    ["людей", source_.users, target_.users],
    ["оплаченных заказов", source_.paid_orders, target_.paid_orders],
    ["сумма оплаченных, копеек", source_.paid_sum, target_.paid_sum],
    ["баланс кошельков, копеек", source_.wallet_sum, target_.wallet_sum]
  ];

  console.log("\nСверка:");
  let diverged = false;
  for (const [label, from, to] of rows) {
    const same = from === to;
    diverged = diverged || !same;
    console.log(`  ${same ? "=" : "≠"}  ${label}: в MAX ${from}, у нас ${to}`);
  }
  if (diverged) {
    console.log(
      "\n  Расхождение — это не обязательно ошибка: пропущенные заказы перечислены выше,"
      + "\n  и по каждому написано, почему. Но запускать с --apply, не разобрав их, нельзя."
    );
  }
}

function report(counters: Counters, warnings: string[]): void {
  console.log("Перенесено:");
  for (const [step, value] of Object.entries(counters)) {
    console.log(`  ${step}: ${value.inserted} новых, ${value.skipped} уже были`);
  }
  if (warnings.length > 0) {
    console.log(`\nНе перенесено (${warnings.length}):`);
    for (const warning of warnings) {
      console.log(`  - ${warning}`);
    }
  }
}

async function count(
  counters: Counters,
  step: string,
  query: Promise<pg.QueryResult>
): Promise<void> {
  const result = await query;
  const bucket = counters[step] ?? { inserted: 0, skipped: 0 };
  if (result.rowCount === 0) {
    bucket.skipped += 1;
  } else {
    bucket.inserted += result.rowCount ?? 0;
  }
  counters[step] = bucket;
}

/**
 * Выведенный идентификатор: uuid v5 от постоянного пространства имён.
 *
 * От него зависит повторяемость всего переноса, поэтому это не случайное число и не хеш
 * «на глазок»: одна и та же исходная строка всегда даёт один и тот же целевой идентификатор,
 * а `on conflict do nothing` превращает повторный прогон в дозапись недостающего.
 */
function derive(kind: string, sourceId: string): string {
  const namespace = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(namespace)
    .update(`${kind}:${sourceId}`, "utf8")
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function displayName(
  firstName: string | null,
  lastName: string | null,
  username: string | null
): string | null {
  const name = [firstName, lastName].filter((part) => part && part.trim() !== "").join(" ").trim();
  if (name !== "") {
    return name.slice(0, 200);
  }
  return username === null ? null : username.replace(/^@+/, "").slice(0, 200);
}

/** Номер заказа обязан подходить под общий формат: латиница, цифры и дефис. */
function orderNumber(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const padded = normalized.length >= 6 ? normalized : `MAX-${normalized}`.slice(0, 40);
  return padded.slice(0, 40);
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10) {
    return `+7${digits}`;
  }
  return /^\+[1-9]\d{7,14}$/.test(raw.trim()) ? raw.trim() : null;
}

function parseOptions(argv: readonly string[]): Options {
  const slugIndex = argv.indexOf("--event");
  return {
    apply: argv.includes("--apply"),
    eventSlug: slugIndex >= 0 ? (argv[slugIndex + 1] ?? "") : "business-picnic-2026"
  };
}

function required(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value === "") {
    throw new Error(`Не задана переменная окружения ${name}`);
  }
  return value;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});

