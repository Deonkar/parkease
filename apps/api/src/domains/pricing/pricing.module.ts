import { Module } from '@nestjs/common';

import { SurgeModule } from '../surge/surge.module.js';

import { PricingQuoteService } from './quote.service.js';

@Module({
  imports: [SurgeModule],
  providers: [PricingQuoteService],
  exports: [PricingQuoteService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class PricingModule {}
