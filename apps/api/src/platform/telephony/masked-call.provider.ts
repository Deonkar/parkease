import { Inject, Injectable } from '@nestjs/common';

import { env } from '../config/env.schema.js';
import { logger } from '../observability/logger.js';

/**
 * A broker that puts a virtual number between two parties so neither learns the
 * other's. §11.9, prd.md §7.1.
 *
 * The interface exists before the provider does, on purpose. No telephony
 * vendor is selected — it is an open item in PLAN.md owned by the founder — and
 * the point of declaring the seam now is that switching it on becomes a module
 * binding rather than a change to the valet domain. Stating this is cheaper
 * than discovering at launch that a P0 safety feature has no provider.
 *
 * What a provider must never do is hand back a phone number. It returns an
 * opaque token the app dials through, which is the whole reason masked calling
 * exists: direct number exchange is not the fallback, it is the thing being
 * prevented (security.md §5.3).
 */
export interface MaskedCallProvider {
  readonly enabled: boolean;

  /**
   * Brokers a call between two users for one job, or returns null when calling
   * is unavailable. Null is a normal answer, not a failure — the caller renders
   * the support path instead.
   */
  broker(input: {
    readonly jobId: string;
    readonly fromUserId: string;
    readonly toUserId: string;
  }): Promise<{ callToken: string } | null>;
}

export const MASKED_CALL_PROVIDER = Symbol('MASKED_CALL_PROVIDER');

/**
 * The only implementation until a vendor is chosen.
 *
 * It answers `null` rather than throwing, because "no provider" is a supported
 * product state and not an error: the job detail view renders
 * `contact: { mode: 'support' }`, the `[Call Valet]` control is hidden rather
 * than rendered disabled, and support can reach either party through a thread
 * carrying the job id. A dead button is worse than no button.
 */
@Injectable()
export class NoopMaskedCallProvider implements MaskedCallProvider {
  readonly enabled = false;

  broker(input: { jobId: string }): Promise<{ callToken: string } | null> {
    // Debug, not warn: this is the expected path at launch, and a warn per call
    // request would train everyone to ignore the channel.
    logger.debug(
      { jobId: input.jobId },
      'masked calling is not configured; falling back to the support thread',
    );
    return Promise.resolve(null);
  }
}

/**
 * Resolves the contact channel a response should carry.
 *
 * Centralised so there is one answer to "how do these two reach each other",
 * and so the flag can never be read in a way that produces a phone number:
 * neither branch has access to one.
 */
@Injectable()
export class ContactChannelService {
  constructor(@Inject(MASKED_CALL_PROVIDER) private readonly provider: MaskedCallProvider) {}

  async forValetJob(input: {
    jobId: string;
    fromUserId: string;
    toUserId: string;
  }): Promise<{ mode: 'masked_call'; callToken: string } | { mode: 'support'; threadUrl: string }> {
    if (this.provider.enabled && env.MASKED_CALLING_ENABLED) {
      const brokered = await this.provider.broker(input);
      if (brokered !== null) {
        return { mode: 'masked_call', callToken: brokered.callToken };
      }
    }

    return { mode: 'support', threadUrl: `/support/valet/${input.jobId}` };
  }
}
