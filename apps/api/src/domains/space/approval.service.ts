import { Injectable } from '@nestjs/common';
import { ApprovalStatus } from '@parkease/contracts/enums';
import { spaces } from '@parkease/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { TxHandle } from '../../platform/db/transaction.js';

@Injectable()
export class ApprovalService {
  async resolveInitialStatus(tx: TxHandle, ownerId: string): Promise<string> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(spaces)
      .where(
        and(
          eq(spaces.ownerId, ownerId),
          eq(spaces.approvalStatus, ApprovalStatus.ACTIVE),
          isNull(spaces.deletedAt),
        ),
      );

    const previouslyApproved = row?.count ?? 0;
    return previouslyApproved > 0 ? ApprovalStatus.ACTIVE : ApprovalStatus.PENDING_APPROVAL;
  }
}
