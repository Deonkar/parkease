import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { users } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module.js';

import { FirebaseVerifierService } from './firebase-verifier.service.js';

/** How recent the OTP behind a sensitive change must be. */
export const REAUTH_MAX_AGE_MS = 5 * 60_000;

/**
 * The change needs a fresh OTP. One answer for a missing, stale, foreign or forged token, so the
 * response never says which; the app runs the phone check again either way.
 */
export class ReauthRequiredError extends HttpException {
  constructor() {
    super(
      {
        error: 'REAUTH_REQUIRED',
        message: "Confirm it's you: we'll send a code to your phone.",
      },
      HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * Step-up authentication for changes a stolen session must not be able to make (S-100): the
 * caller proves they hold the account's phone now, by a Firebase ID token whose sign-in is under
 * `REAUTH_MAX_AGE_MS` old and whose uid and phone are this user's. The verifier's replay guard
 * makes each token single-use.
 */
@Injectable()
export class ReauthService {
  constructor(
    private readonly verifier: FirebaseVerifierService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async assertFresh(userId: string, token: string, now: Date = new Date()): Promise<void> {
    const verified = await this.verifier.verify(token).catch(() => {
      throw new ReauthRequiredError();
    });
    const [user] = await this.db
      .select({ firebaseUid: users.firebaseUid, phone: users.phone })
      .from(users)
      .where(eq(users.id, userId));

    const sameAccount =
      user !== undefined &&
      user.firebaseUid === verified.firebaseUid &&
      user.phone === verified.phone;
    const fresh = now.getTime() - verified.authTime.getTime() <= REAUTH_MAX_AGE_MS;
    if (!sameAccount || !fresh) throw new ReauthRequiredError();
  }
}
