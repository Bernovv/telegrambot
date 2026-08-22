import { createInterface } from "node:readline/promises";

export async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Ввод без эха — для облачного пароля.
 *
 * Скрипт запускают по ssh, и напечатанный пароль остаётся на экране и в буфере терминала до
 * конца рабочего дня. Пароль от аккаунта, через который идёт вся переписка с клиентами, там
 * оставлять не стоит.
 *
 * Сырой режим, а не известный приём с подменой вывода readline: подмена опирается на
 * внутренности readline, и когда они однажды изменятся, пароль начнёт печататься на экран
 * молча — то есть поломка окажется незаметной ровно там, где заметность и нужна.
 */
export async function promptSecret(question: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) {
    return await promptLine(question);
  }

  process.stdout.write(question);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const stop = (): void => {
      input.setRawMode(false);
      input.pause();
      input.off("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stop();
          resolve(value.trim());

          return;
        }
        if (char === "\u0003") {
          stop();
          reject(new Error("Ввод прерван"));

          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    input.on("data", onData);
  });
}

/** Подтверждение необратимого шага. Принимается только слово целиком. */
export async function confirmYes(question: string): Promise<boolean> {
  const answer = await promptLine(`${question} Напишите «да», чтобы продолжить: `);

  return answer.toLowerCase() === "да";
}
