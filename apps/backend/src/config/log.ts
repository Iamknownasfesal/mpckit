/**
 * Structured logging via pino. One root logger; child loggers carry
 * request id and any other contextual fields.
 *
 * In development, output is pretty-printed via `pino-pretty`. In
 * production, the default JSON output is what infra expects.
 */
import pino from "pino";
import { env } from "./env";

export const log = pino({
  level: env.LOG_LEVEL,
  base: { service: "mpckit" },
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            singleLine: false,
          },
        },
      }
    : {}),
});

export type Logger = typeof log;
