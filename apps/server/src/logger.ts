export interface LogMeta {
  [key: string]: unknown;
}

export interface Logger {
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}

function writeLog(level: "INFO" | "WARN" | "ERROR", scope: string, message: string, meta?: LogMeta): void {
  const timestamp = new Date().toISOString();
  const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  const line = `[${timestamp}] [${level}] [${scope}] ${message}${suffix}`;

  if (level === "ERROR") {
    console.error(line);
    return;
  }

  if (level === "WARN") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export function createLogger(scope: string): Logger {
  return {
    info(message, meta) {
      writeLog("INFO", scope, message, meta);
    },
    warn(message, meta) {
      writeLog("WARN", scope, message, meta);
    },
    error(message, meta) {
      writeLog("ERROR", scope, message, meta);
    }
  };
}
