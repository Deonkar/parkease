import { createHash } from 'node:crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import { REDIS, type RedisClient } from '../redis/redis.module.js';

@Injectable()
export class TokenReplayGuard {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  async consume(token: string, expiresAtEpoch: number): Promise<void> {
    const digest = createHash('sha256').update(token).digest('hex');
    const key = `idtok:${digest}`;

    const result = await this.redis.set(key, '1', 'EXAT', expiresAtEpoch, 'NX');

    if (result !== 'OK') {
      throw new UnauthorizedException('This token has already been used.');
    }
  }
}
