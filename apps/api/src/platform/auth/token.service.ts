import { createHash, randomBytes } from 'node:crypto';

import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserStatus, type Role } from '@parkease/contracts/enums';
import { uuidv7, type Transaction } from '@parkease/db';
import { refreshTokens, userRoles, users } from '@parkease/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

import { env } from '../config/env.schema.js';
import { DB, type Database } from '../db/db.module.js';
import type { TxHandle } from '../db/transaction.js';
import { AuditService } from '../observability/audit.service.js';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET);
}

export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

export interface IssueInput {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly activeRole: string | null;
  readonly familyId?: string | undefined;
  readonly userAgent?: string | undefined;
}

export interface AccessTokenPayload extends JWTPayload {
  readonly roles: string[];
  readonly active_role: string | null;
}

/**
 * Why a token was revoked because of the ACCOUNT, not because the token was misused. Presenting
 * one later is a refusal about the account, never evidence of theft.
 */
export const BLOCKED_REVOKE_REASON = 'blocked';
const ACCOUNT_STATE_REVOCATIONS: ReadonlySet<string | null> = new Set([
  BLOCKED_REVOKE_REASON,
  'user_not_active',
]);

/** Refusals that must commit their writes before the error is thrown. */
type RotateRefusal = 'reuse_detected' | 'user_not_active' | 'role_revoked';

@Injectable()
export class TokenService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async issue(tx: TxHandle, input: IssueInput): Promise<SessionTokens> {
    const familyId = input.familyId ?? uuidv7();
    const refreshToken = randomBytes(32).toString('base64url');

    await tx.insert(refreshTokens).values({
      userId: input.userId,
      tokenHash: sha256(refreshToken),
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
      userAgent: input.userAgent ?? null,
    });

    const accessToken = await new SignJWT({
      roles: input.roles as string[],
      active_role: input.activeRole,
      jti: uuidv7(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(input.userId)
      .setIssuedAt()
      .setExpirationTime(`${String(ACCESS_TTL_SECONDS)}s`)
      .sign(getJwtSecret());

    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS };
  }

  /**
   * `opts.requireRole` is the admin panel's gate: the session it refreshes must
   * still hold that role, and the new access token is minted with it active.
   *
   * Every refusal that writes something — the role revocation, the family
   * revocation and audit row on reuse, the revocation of a blocked user's
   * tokens — has to COMMIT. So the transaction returns a discriminant and the
   * error is thrown after it: a throw inside the callback rolls the writes back
   * and leaves the very tokens it meant to kill usable.
   */
  async rotate(
    presented: string,
    userAgent?: string,
    opts?: { readonly requireRole?: Role },
  ): Promise<SessionTokens> {
    const presentedHash = sha256(presented);
    const requireRole = opts?.requireRole;

    const outcome = await this.db.transaction(
      async (rawTx: Transaction): Promise<SessionTokens | RotateRefusal> => {
        const tx = rawTx as unknown as TxHandle;

        const rows = await tx
          .select()
          .from(refreshTokens)
          .where(eq(refreshTokens.tokenHash, presentedHash))
          .for('update');

        const row = rows[0];
        if (!row) {
          throw new UnauthorizedException('Your session has expired. Please log in again.');
        }

        // A block (or any non-active status) revokes every token up front, so a legitimate client's
        // next refresh arrives with a revoked row. That is not reuse: answer for the account, and
        // do not write a theft alarm. If the account has since been restored, it is a plain expiry.
        if (!row.rotatedAt && row.revokedAt && ACCOUNT_STATE_REVOCATIONS.has(row.revokedReason)) {
          const [owner] = await tx
            .select({ status: users.status })
            .from(users)
            .where(eq(users.id, row.userId));
          if (owner !== undefined && owner.status !== UserStatus.ACTIVE) return 'user_not_active';
          throw new UnauthorizedException('Your session has expired. Please log in again.');
        }

        if (row.rotatedAt || row.revokedAt) {
          await this.revokeAllForUser(tx, row.userId, 'refresh_reuse_detected');
          await this.audit.record(tx, {
            actorUserId: row.userId,
            actorRole: null,
            action: 'auth.refresh-reuse-detected',
            targetType: 'user',
            targetId: row.userId,
            ipAddress: null,
          });
          return 'reuse_detected';
        }

        if (row.expiresAt <= new Date()) {
          throw new UnauthorizedException('Your session has expired. Please log in again.');
        }

        const userRows = await tx
          .select({ status: users.status })
          .from(users)
          .where(eq(users.id, row.userId));

        const user = userRows[0];
        if (user?.status !== UserStatus.ACTIVE) {
          await this.revokeAllForUser(tx, row.userId, 'user_not_active');
          return 'user_not_active';
        }

        const roles = await tx
          .select({ role: userRoles.role })
          .from(userRoles)
          .where(and(eq(userRoles.userId, row.userId), eq(userRoles.status, 'active')));

        const roleList = roles.map((r: { role: string }) => r.role);

        if (requireRole !== undefined && !roleList.includes(requireRole)) {
          const now = new Date();
          await tx
            .update(refreshTokens)
            .set({ revokedAt: now, revokedReason: 'role_revoked', updatedAt: now })
            .where(eq(refreshTokens.id, row.id));
          return 'role_revoked';
        }

        await tx
          .update(refreshTokens)
          .set({ rotatedAt: new Date(), updatedAt: new Date() })
          .where(eq(refreshTokens.id, row.id));

        return this.issue(tx, {
          userId: row.userId,
          roles: roleList,
          activeRole: requireRole ?? roleList[0] ?? null,
          familyId: row.familyId,
          userAgent,
        });
      },
    );

    switch (outcome) {
      case 'reuse_detected':
        throw new UnauthorizedException('Your session has expired. Please log in again.');
      case 'user_not_active':
        throw new ForbiddenException('This account has been suspended. Contact support.');
      case 'role_revoked':
        throw new ForbiddenException({
          error: 'ADMIN_ROLE_REQUIRED',
          message: 'This account no longer has access to the admin panel.',
        });
      default:
        return outcome;
    }
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: 'logout', updatedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
  }

  async revokeAllForUser(tx: TxHandle, userId: string, reason: string): Promise<void> {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason, updatedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      const { payload } = await jwtVerify(token, getJwtSecret(), {
        algorithms: ['HS256'],
      });
      return payload as AccessTokenPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }
  }
}
