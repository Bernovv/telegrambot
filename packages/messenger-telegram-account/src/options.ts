/**
 * Аккаунт компании в Telegram: что нужно знать, чтобы его поднять.
 *
 * Пакет намеренно не знает ни про `.env`, ни про базу. Его дело — MTProto: соединение,
 * прокси и авторизация. Всё остальное приносит приложение, и это не чистоплюйство: тот же
 * клиент понадобится скрипту входа, который никакой базы не открывает вовсе.
 */

/**
 * Прокси, через который аккаунт видит Telegram.
 *
 * С российского сервера MTProto напрямую не ходит, а Cloudflare-прокси из
 * `TELEGRAM_API_ROOT` тут не помощник: он перекладывает HTTP-запросы Bot API и про MTProto
 * не знает ничего. Отсюда отдельный прокси и отдельная зарубежная машина под него.
 *
 * Структурно совпадает с `TelegramAccountProxy` из `@ticket-platform/config`: пакеты в этом
 * репозитории до конфигурации не дотягиваются, а расхождение поймает сборка приложения,
 * которое их и связывает.
 */
export type TelegramAccountProxy =
  | {
      readonly kind: "socks5";
      readonly host: string;
      readonly port: number;
      readonly username: string | null;
      readonly password: string | null;
    }
  | {
      readonly kind: "mtproto";
      readonly host: string;
      readonly port: number;
      /** Секрет MTProxy в шестнадцатеричном виде — так его ждёт TDLib. */
      readonly secret: string;
    };

export interface TelegramAccountClientOptions {
  readonly apiId: number;
  readonly apiHash: string;
  /**
   * Папка сессии. Внутри две: `db` — состояние авторизации, `files` — то, что TDLib скачал.
   *
   * У TDLib нет строки сессии, как у MTProto-библиотек попроще: авторизация — это каталог
   * на диске. Поэтому папка живёт вне репозитория, попадает в резервную копию и переезжает
   * вместе с сервером; потерять её значит войти заново по коду из SMS.
   */
  readonly sessionDirectory: string;
  readonly databaseEncryptionKey: string;
  readonly proxy: TelegramAccountProxy | null;
  /** Как аккаунт подписан в списке устройств — в приложении Telegram это видно владельцу. */
  readonly deviceModel: string;
  readonly applicationVersion: string;
}

/** Человеческое описание прокси для журнала. Пароль и секрет в вывод не попадают. */
export function describeProxy(proxy: TelegramAccountProxy | null): string {
  if (proxy === null) {
    return "без прокси (напрямую)";
  }
  if (proxy.kind === "socks5") {
    const credentials = proxy.username === null ? "без пароля" : `логин ${proxy.username}`;
    return `socks5 ${proxy.host}:${proxy.port}, ${credentials}`;
  }

  return `mtproxy ${proxy.host}:${proxy.port}`;
}
