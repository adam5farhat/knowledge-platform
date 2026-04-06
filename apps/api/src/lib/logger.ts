import { config } from "./config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = config.isProd ? LEVELS.info : LEVELS.debug;

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVELS[level] < MIN_LEVEL) return;

  if (config.isProd) {
    const entry = { level, message, timestamp: new Date().toISOString(), ...meta };
    const out = level === "error" ? process.stderr : process.stdout;
    out.write(JSON.stringify(entry) + "\n");
  } else {
    const prefix = `[${level.toUpperCase()}]`;
    const metaStr = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    out(`${prefix} ${message}${metaStr}`);
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => write("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write("error", msg, meta),
};
