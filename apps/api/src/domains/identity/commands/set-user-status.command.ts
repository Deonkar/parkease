import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UserStatus } from '@parkease/contracts/enums';
import { users } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import { BLOCKED_REVOKE_REASON, TokenService } from '../../../platform/auth/token.service.js';
import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { type AdminActor, AuditService } from '../../../platform/observability/audit.service.js';
import { IllegalUserStatusTransitionError, SelfDemotionError } from '../errors.js';

export interface SetUserStatusInput {
  readonly userId: string;
  readonly reason: string;
}

/**
 * Task 18a §users. Block takes a person off the platform; unblock lets them back in.
 *
 * Blocking revokes every refresh token in the same transaction as the status change, so there is
 * no moment when a blocked user can still refresh. An access token already issued lives out its
 * 15 minutes. Unblocking restores nothing: they sign in again.
 */
@Injectable()
export class SetUserStatusCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
  ) {}

  block(input: SetUserStatusInput, actor: AdminActor): Promise<void> {
    if (input.userId === actor.userId) return Promise.reject(new SelfDemotionError());
    return this.transition(input, actor, UserStatus.ACTIVE, UserStatus.BLOCKED, 'user.block');
  }

  unblock(input: SetUserStatusInput, actor: AdminActor): Promise<void> {
    return this.transition(input, actor, UserStatus.BLOCKED, UserStatus.ACTIVE, 'user.unblock');
  }

  private transition(
    { userId, reason }: SetUserStatusInput,
    actor: AdminActor,
    from: UserStatus,
    to: UserStatus,
    action: string,
  ): Promise<void> {
    return withTransaction(this.db, async (tx) => {
      const [user] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (user === undefined) throw new NotFoundException('User not found.');
      if (user.status !== from) throw new IllegalUserStatusTransitionError();

      await tx.update(users).set({ status: to, updatedAt: new Date() }).where(eq(users.id, userId));

      if (to === UserStatus.BLOCKED)
        await this.tokens.revokeAllForUser(tx, userId, BLOCKED_REVOKE_REASON);

      await this.audit.record(tx, {
        actorUserId: actor.userId,
        actorRole: 'admin',
        action,
        targetType: 'user',
        targetId: userId,
        before: { status: user.status },
        after: { status: to, reason },
        ipAddress: actor.ipAddress,
      });
    });
  }
}
