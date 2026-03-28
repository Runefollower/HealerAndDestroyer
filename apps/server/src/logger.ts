export type LogLevel = "normal" | "verbose" | "very-verbose";

export interface LogMeta {
  [key: string]: unknown;
}

export interface Logger {
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  verbose(message: string, meta?: LogMeta): void;
  veryVerbose(message: string, meta?: LogMeta): void;
}

type InternalLevel = "INFO" | "WARN" | "ERROR" | "VERBOSE" | "VERY_VERBOSE";

const levelOrder: Record<LogLevel, number> = {
  normal: 0,
  verbose: 1,
  "very-verbose": 2
};

let currentLogLevel: LogLevel = "normal";

export function parseLogLevel(value: string | undefined): LogLevel {
  if (!value) {
    return "normal";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "verbose") {
    return "verbose";
  }
  if (
    normalized === "very-verbose" ||
    normalized === "very_verbose" ||
    normalized === "veryverbose" ||
    normalized === "very verbose" ||
    normalized === "trace"
  ) {
    return "very-verbose";
  }
  return "normal";
}

export function setGlobalLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

function shouldWrite(level: InternalLevel): boolean {
  if (level === "VERBOSE") {
    return levelOrder[currentLogLevel] >= levelOrder.verbose;
  }
  if (level === "VERY_VERBOSE") {
    return levelOrder[currentLogLevel] >= levelOrder["very-verbose"];
  }
  return true;
}

function writeLog(level: InternalLevel, scope: string, message: string, meta?: LogMeta): void {
  if (!shouldWrite(level)) {
    return;
  }

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
    },
    verbose(message, meta) {
      writeLog("VERBOSE", scope, message, meta);
    },
    veryVerbose(message, meta) {
      writeLog("VERY_VERBOSE", scope, message, meta);
    }
  };
}
