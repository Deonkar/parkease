import { Inject, Injectable } from '@nestjs/common';
import { washerProfiles } from '@parkease/db/schema';
import { eq, sql } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { WasherNotVerifiedError, WasherProfileNotFoundError } from '../errors.js';

export interface SetWasherAvailabilityInput {
  readonly washerUserId: string;
  readonly isOnline: boolean;
  readonly location?: { readonly lat: number; readonly lng: number };
}

export interface WasherAvailabilityResult {
  readonly isOnline: boolean;
  readonly lastSeenAt: Date;
}

/**
 * Online/offline, and the heartbeat that makes "online" mean reachable.
 *
 * This is also the only write path for `current_location`, which is why it is a
 * command rather than a setter: going online is a claim about being
 * dispatchable, and an unverified partner making that claim would enter a
 * candidate pool they have no business being in. The assignment query filters
 * on verification too — this is the second of the two, and the one that gives
 * the partner an answer instead of silently never sending them a job.
 */
@Injectable()
export class SetWasherAvailabilityCommand {
  constructor(@Inject(DB) private readonly db: Database) {}

  async execute(input: SetWasherAvailabilityInput): Promise<WasherAvailabilityResult> {
    const [profile] = await this.db
      .select({
        id: washerProfiles.id,
        verificationStatus: washerProfiles.verificationStatus,
      })
      .from(washerProfiles)
      .where(eq(washerProfiles.userId, input.washerUserId));

    if (profile === undefined) throw new WasherProfileNotFoundError();
    if (input.isOnline && profile.verificationStatus !== 'verified') {
      throw new WasherNotVerifiedError();
    }

    const lastSeenAt = new Date();

    /**
     * Going offline leaves `current_location` where it was rather than nulling
     * it. The candidate query gates on `is_online` and the heartbeat window, so
     * a stale point is already unreachable — and clearing it would drop the row
     * out of the partial GiST index, only to rebuild the entry on the next shift.
     */
    await this.db
      .update(washerProfiles)
      .set({
        isOnline: input.isOnline,
        lastSeenAt,
        ...(input.location === undefined
          ? {}
          : {
              currentLocation: sql`ST_SetSRID(ST_MakePoint(${input.location.lng}, ${input.location.lat}), 4326)::geography`,
            }),
        updatedAt: lastSeenAt,
      })
      .where(eq(washerProfiles.userId, input.washerUserId));

    return { isOnline: input.isOnline, lastSeenAt };
  }
}
