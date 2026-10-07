import { Global, Module } from '@nestjs/common';

import { FirebaseVerifierService } from './firebase-verifier.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { ReauthService } from './reauth.service.js';
import { TokenReplayGuard } from './token-replay.guard.js';
import { TokenService } from './token.service.js';

@Global()
@Module({
  providers: [FirebaseVerifierService, TokenReplayGuard, TokenService, JwtAuthGuard, ReauthService],
  exports: [FirebaseVerifierService, TokenService, JwtAuthGuard, ReauthService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AuthModule {}
