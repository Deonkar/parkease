import { Inject, Injectable } from '@nestjs/common';
import type { CreateWasherProfile, WasherProfileView } from '@parkease/contracts/washer';
import { washerProfiles } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { CarwashService } from '../carwash.service.js';
import { CatalogService } from '../catalog.service.js';
import { WasherProfileExistsError, WasherProfileNotFoundError } from '../errors.js';

export interface CreateWasherProfileInput extends CreateWasherProfile {
  readonly userId: string;
}

/**
 * Registering as a car wash partner, business or gig. §13.10.
 *
 * The profile and the standard menu are written in **one** transaction. A
 * partner who exists with no menu is a partner no candidate query can ever
 * return — the query joins `wash_services` — so they would be registered,
 * verified, online, and permanently invisible, with nothing anywhere saying
 * why. Two statements in one commit is the whole fix.
 *
 * `verification_status` stays at its `unverified` default. Both partner types
 * need an admin to look at their documents before they can go online (§13.10),
 * and that review is task 18's.
 */
@Injectable()
export class CreateWasherProfileCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly carwash: CarwashService,
    private readonly catalog: CatalogService,
  ) {}

  async execute(input: CreateWasherProfileInput): Promise<WasherProfileView> {
    const [existing] = await this.db
      .select({ id: washerProfiles.id })
      .from(washerProfiles)
      .where(eq(washerProfiles.userId, input.userId));

    // A 409 rather than an upsert: re-registering would silently overwrite a
    // business name and a document trail an admin may already have reviewed.
    if (existing !== undefined) throw new WasherProfileExistsError();

    await withTransaction(this.db, async (tx) => {
      await tx.insert(washerProfiles).values({
        userId: input.userId,
        partnerType: input.partnerType,
        businessName: input.businessName ?? null,
        gstin: input.gstin ?? null,
        businessPhotoIds: input.businessPhotoIds,
        operatingHours: input.operatingHours ?? null,
        capabilities: input.capabilities,
      });

      await this.catalog.seedMenu(tx, input.userId);
    });

    const profile = await this.carwash.profileFor(input.userId);
    // The row was written in the transaction that just committed, so this
    // cannot miss — but reading back `null` and returning it would hand the
    // controller a view it would then have to guess about (R-FAIL-01).
    if (profile === null) throw new WasherProfileNotFoundError();
    return profile;
  }
}
