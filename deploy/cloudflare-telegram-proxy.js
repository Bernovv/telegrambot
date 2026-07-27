// Cloudflare Worker — прозрачный прокси перед api.telegram.org.
//
// Зачем: с серверов в РФ прямое подключение к api.telegram.org часто
// блокируется/режется. Бот вместо запросов на api.telegram.org обращается
// к этому воркеру (который доступен из РФ), а воркер уже сам пересылает
// запрос в Telegram (Cloudflare это может — блокировка на уровне
// провайдеров в РФ его не касается).
//
// Как развернуть (2 минуты, без своего домена):
//   1. dash.cloudflare.com → Workers & Pages → Create → Create Worker.
//   2. Дать любое имя, Deploy.
//   3. Открыть Edit code, стереть содержимое, вставить целиком этот файл, Deploy.
//   4. Скопировать адрес воркера (вида https://ИМЯ.ВАШ-АККАУНТ.workers.dev).
//   5. В .env: TELEGRAM_API_ROOT=https://ИМЯ.ВАШ-АККАУНТ.workers.dev (без
//      слэша на конце), перезапустить процессы (pm2 restart bot api worker).
//
// Никаких секретов внутри воркера нет — токен бота передаётся в самом URL
// запроса (так работает Telegram Bot API), воркер его никак не хранит и не
// логирует.

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = "https://api.telegram.org" + url.pathname + url.search;

    const init = {
      method: request.method,
      headers: request.headers
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    return fetch(target, init);
  }
};
