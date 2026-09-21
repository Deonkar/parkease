import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { ServerOptions, Server } from 'socket.io';

import { env } from '../config/env.schema.js';
import { logger } from '../observability/logger.js';

/**
 * Socket.IO rooms that work across more than one API instance.
 *
 * This is not a scale optimisation. Without it, a valet connected to instance A
 * emits into a room that only exists on instance A, and the driver connected to
 * instance B sees an empty map — which breaks at two instances, the default
 * deployment. The failure is also invisible in development, where there is only
 * ever one process.
 *
 * Two connections, not one: the Redis pub/sub protocol puts a subscribed client
 * into a mode where it can issue almost nothing else, so the publisher has to be
 * a separate socket.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private clients: Redis[] = [];

  async connect(): Promise<void> {
    const pub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    const sub = pub.duplicate();

    // ioredis reconnects on its own; an error here must be visible rather than
    // becoming an unhandled rejection that takes the process down (R-FAIL-01).
    for (const client of [pub, sub]) {
      client.on('error', (err: Error) => {
        logger.warn({ err }, 'socket.io redis adapter connection error');
      });
    }

    await Promise.all([pub.connect(), sub.connect()]);

    this.clients = [pub, sub];
    this.adapterConstructor = createAdapter(pub, sub);
    logger.info('socket.io redis adapter connected');
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options);

    /**
     * Refusing to start without the adapter, rather than starting and silently
     * delivering to one instance. A tracking stream that works in staging and
     * loses half its messages in production is the exact failure this class
     * exists to prevent, so it must not be possible to skip `connect()`.
     */
    if (this.adapterConstructor === undefined) {
      throw new Error(
        'RedisIoAdapter.createIOServer was called before connect(). Without the Redis ' +
          'adapter, rooms are per-instance and a driver on another instance receives nothing.',
      );
    }

    server.adapter(this.adapterConstructor);
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all(this.clients.map((client) => client.quit()));
    this.clients = [];
  }
}
