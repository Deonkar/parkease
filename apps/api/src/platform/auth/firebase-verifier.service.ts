import { Injectable, UnauthorizedException } from '@nestjs/common';
import { type App, cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

import { env } from '../config/env.schema.js';

import { TokenReplayGuard } from './token-replay.guard.js';

export interface VerifiedPhone {
  readonly firebaseUid: string;
  readonly phone: string;
}

@Injectable()
export class FirebaseVerifierService {
  private readonly app: App;

  constructor(private readonly replayGuard: TokenReplayGuard) {
    this.app = initializeApp({
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  }

  async verify(idToken: string): Promise<VerifiedPhone> {
    const decoded = await getAuth(this.app)
      .verifyIdToken(idToken, true)
      .catch(() => {
        throw new UnauthorizedException('We could not verify that code. Please try again.');
      });

    if (!decoded.phone_number) {
      throw new UnauthorizedException('Phone verification is required.');
    }

    await this.replayGuard.consume(idToken, decoded.exp);

    return { firebaseUid: decoded.uid, phone: decoded.phone_number };
  }
}
