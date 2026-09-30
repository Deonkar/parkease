import { Module } from '@nestjs/common';

import { SurgeModule } from '../surge/surge.module.js';

import { CommissionWaiverService } from './commission-waiver.service.js';
import { PricingQuoteService } from './quote.service.js';

@Module({
  imports: [SurgeModule],
  providers: [PricingQuoteService, CommissionWaiverService],
  exports: [PricingQuoteService, CommissionWaiverService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class PricingModule {}
