export interface LoggerContext {
  readonly service: string;
  readonly environment: string;
}

export interface Logger {
  info(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
}

export function createLogger(context: LoggerContext): Logger {
  return {
    info(message, attributes) {
      writeLog("info", context, message, attributes);
    },
    error(message, attributes) {
      writeLog("error", context, message, attributes);
    }
  };
}

function writeLog(
  level: "info" | "error",
  context: LoggerContext,
  message: string,
  attributes: Record<string, unknown> | undefined
): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    service: context.service,
    environment: context.environment,
    message,
    ...attributes
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
