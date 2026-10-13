import { Injectable, UnauthorizedException } from '@nestjs/common';
import { DEMO_TOKEN_PREFIX, isDemoPhone } from '@parkease/contracts/public';
import { type App, cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

import { env } from '../config/env.schema.js';

import { TokenReplayGuard } from './token-replay.guard.js';

export interface VerifiedPhone {
  readonly firebaseUid: string;
  readonly phone: string;
  /** When the user last completed sign-in (the OTP), from the token's `auth_time`. */
  readonly authTime: Date;
}

@Injectable()
export class FirebaseVerifierService {
  /** Null in DEMO_MODE: there are no Firebase credentials to initialise with. */
  private readonly app: App | null;

  constructor(private readonly replayGuard: TokenReplayGuard) {
    this.app = env.DEMO_MODE
      ? null
      : initializeApp({
          credential: cert({
            projectId: env.FIREBASE_PROJECT_ID,
            clientEmail: env.FIREBASE_CLIENT_EMAIL,
            privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          }),
        });
  }

  async verify(idToken: string): Promise<VerifiedPhone> {
    if (this.app === null) return verifyDemoToken(idToken);

    const decoded = await getAuth(this.app)
      .verifyIdToken(idToken, true)
      .catch(() => {
        throw new UnauthorizedException('We could not verify that code. Please try again.');
      });

    if (!decoded.phone_number) {
      throw new UnauthorizedException('Phone verification is required.');
    }

    await this.replayGuard.consume(idToken, decoded.exp);

    return {
      firebaseUid: decoded.uid,
      phone: decoded.phone_number,
      authTime: new Date(decoded.auth_time * 1000),
    };
  }
}

/**
 * DEMO_MODE sign-in: `demo:<phone>` for one of the fixed demo accounts, nothing else. The user,
 * role and admin checks after this run exactly as for a Firebase sign-in.
 */
export function verifyDemoToken(idToken: string): VerifiedPhone {
  const phone = idToken.startsWith(DEMO_TOKEN_PREFIX)
    ? idToken.slice(DEMO_TOKEN_PREFIX.length)
    : '';
  if (!isDemoPhone(phone)) {
    throw new UnauthorizedException('This demo signs in with the demo accounts only.');
  }
  return { firebaseUid: `${DEMO_TOKEN_PREFIX}${phone}`, phone, authTime: new Date() };
}
