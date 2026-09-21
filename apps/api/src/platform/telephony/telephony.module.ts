import { Global, Module } from '@nestjs/common';

import {
  ContactChannelService,
  MASKED_CALL_PROVIDER,
  NoopMaskedCallProvider,
} from './masked-call.provider.js';

/**
 * One binding to change when a telephony vendor is chosen (§11.9).
 *
 * Global because contact resolution is cross-cutting: valet needs it now, and
 * carwash (task 13) will need the same answer for the same reason.
 */
@Global()
@Module({
  providers: [
    { provide: MASKED_CALL_PROVIDER, useClass: NoopMaskedCallProvider },
    ContactChannelService,
  ],
  exports: [MASKED_CALL_PROVIDER, ContactChannelService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class TelephonyModule {}
