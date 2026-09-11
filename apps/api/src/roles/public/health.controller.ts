import { Controller, Get } from '@nestjs/common';

import { env } from '../../platform/config/env.schema.js';

@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok'; version: string; timestamp: string } {
    return {
      status: 'ok',
      version: env.APP_VERSION,
      timestamp: new Date().toISOString(),
    };
  }
}
