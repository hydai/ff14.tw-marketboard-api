type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(module: string, minLevel: LogLevel = "info") {
  const minOrder = LEVEL_ORDER[minLevel];

  function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    if (LEVEL_ORDER[level] < minOrder) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      ...data,
    };

    switch (level) {
      case "error":
        console.error(JSON.stringify(entry));
        break;
      case "warn":
        console.warn(JSON.stringify(entry));
        break;
      default:
        console.log(JSON.stringify(entry));
    }
  }

  return {
    debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
    info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
    error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
  };
}
