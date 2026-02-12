/**
 * Structured Logger with Pino
 */
import pino, { Logger as PinoLogger } from 'pino';

export interface LogContext {
  requestId?: string;
  userId?: string;
  workspaceId?: string;
  [key: string]: unknown;
}

const isDev = process.env.NODE_ENV === 'development';

export const logger: PinoLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    service: 'nexova',
    env: process.env.NODE_ENV || 'development',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createChildLogger(context: LogContext): PinoLogger {
  return logger.child(context);
}

export type { PinoLogger as Logger };
