import { Inject, Injectable } from '@nestjs/common';
import { valetProfiles } from '@parkease/db/schema';
import { eq, sql } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { ValetNotVerifiedError, ValetProfileNotFoundError } from '../errors.js';

export interface SetAvailabilityInput {
  readonly valetUserId: string;
  readonly isOnline: boolean;
  readonly location?: { readonly lat: number; readonly lng: number };
}

export interface AvailabilityResult {
  readonly isOnline: boolean;
  readonly lastSeenAt: Date;
}

/**
 * Online/offline, and the heartbeat that makes "online" mean reachable.
 *
 * This is also the only write path for `current_location`, which is why it is a
 * command rather than a setter: going online is a claim about being dispatchable,
 * and an unverified partner making that claim would enter a candidate pool they
 * have no business being in. The assignment query filters on verification too —
 * this is the second of the two, and the one that gives the partner an answer
 * instead of silently never sending them a job.
 */
@Injectable()
export class SetAvailabilityCommand {
  constructor(@Inject(DB) private readonly db: Database) {}

  async execute(input: SetAvailabilityInput): Promise<AvailabilityResult> {
    const [profile] = await this.db
      .select({
        id: valetProfiles.id,
        verificationStatus: valetProfiles.verificationStatus,
      })
      .from(valetProfiles)
      .where(eq(valetProfiles.userId, input.valetUserId));

    if (profile === undefined) throw new ValetProfileNotFoundError();
    if (input.isOnline && profile.verificationStatus !== 'verified') {
      throw new ValetNotVerifiedError();
    }

    const lastSeenAt = new Date();

    /**
     * Going offline leaves `current_location` where it was rather than nulling
     * it. The candidate query gates on `is_online` and the heartbeat window, so a
     * stale point is already unreachable — and clearing it would drop the row out
     * of the partial GiST index, only to rebuild the entry on the next shift.
     */
    await this.db
      .update(valetProfiles)
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
      .where(eq(valetProfiles.userId, input.valetUserId));

    return { isOnline: input.isOnline, lastSeenAt };
  }
}
