import { pino } from 'pino';
import type { LoggerOptions } from 'pino';

const options: LoggerOptions = {
  level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
};

if (process.env['NODE_ENV'] !== 'production') {
  options.transport = { target: 'pino-pretty', options: { colorize: true } };
}

export const logger = pino(options);
