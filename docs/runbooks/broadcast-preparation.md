# Планирование и подготовка рассылки

## Доступ

- Страница: `/broadcasts`.
- Планирование: `POST /api/v1/broadcasts/:broadcastId/schedule`.
- Право: `broadcasts.send`.

Запрос содержит `expectedLockVersion`, канонический UTC `scheduledAt`, часовой пояс IANA,
`ratePerSecond` от 1 до 25 и обязательную причину.

## Условия планирования

- существует опубликованная версия;
- нет более нового черновика;
- агрегат ещё находится в `draft`;
- связанный снимок аудитории находится в `ready`;
- время не старше пяти минут и не дальше 366 дней от момента запроса.

После успешной команды версия, время, часовой пояс и скорость становятся неизменяемыми.

## Подготовка worker

Worker проверяет наступившие расписания каждые
`BROADCAST_PREPARATION_POLL_INTERVAL_MS` миллисекунд и обрабатывает не более
`BROADCAST_PREPARATION_BATCH_SIZE` кампаний за транзакцию.

Состояния этого среза:

- `scheduled` — время ещё не наступило;
- `preparing` без `preparedAt` — транзакция подготовки ещё не завершена;
- `preparing` с `preparedAt` — журнал доставок создан и ожидает захвата контуром отправки;
- `sending` — worker арендует и отправляет доступные записи;
- `completed` — активных записей доставки больше нет;
- `paused` с `automatic_failure_rate` — сработал автоматический порог окончательных ошибок.

Для каждого участника снимка создаётся одна строка:

- `pending` — есть доступная Telegram identity;
- `skipped / RecipientUnavailable` — Telegram identity отсутствует;
- `skipped / RecipientBlocked` — бот уже отмечен как заблокированный.

## Диагностика

- HTTP 409 `ADMIN_BROADCAST_DRAFT_EXISTS`: опубликуйте последний черновик.
- HTTP 409 `ADMIN_BROADCAST_PUBLISHED_VERSION_UNAVAILABLE`: сначала опубликуйте версию.
- HTTP 409 `ADMIN_BROADCAST_NOT_EDITABLE`: рассылка уже запланирована.
- Долгое состояние `scheduled`: проверьте UTC-время, heartbeat worker и интервал опроса.
- `preparing` без `preparedAt`: проверьте ошибки транзакции worker; при откате состояние остаётся
  `scheduled`.
- Расхождение счётчиков: `planned = reachable + skipped` обеспечивается ограничением БД.

Не изменяйте строки журнала вручную. Правила аренды, повторных попыток и диагностики описаны в
`docs/runbooks/broadcast-delivery.md`.
