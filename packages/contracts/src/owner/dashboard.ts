import { z } from 'zod';

import { approvalStatusSchema } from '../enums/approval-status.js';
import { spaceIdSchema } from '../primitives/ids.js';
import { paiseDeltaSchema } from '../primitives/paise.js';

import { statementLineSchema } from './earnings.js';

export const ownerDashboardSchema = z
  .object({
    greetingName: z.string().nullable(),
    /** All-time net on `owner_payable`: what we hold for the owner. */
    owedPaise: paiseDeltaSchema,
    today: z.object({
      netPaise: paiseDeltaSchema,
      bookings: z.number().int().nonnegative(),
    }),
    month: z.object({
      netPaise: paiseDeltaSchema,
      /**
       * Month-to-date vs the same days of last month; null when last month's
       * net was zero or negative (no meaningful baseline to grow from).
       */
      growthBp: z.number().int().nullable(),
    }),
    statement: z.array(statementLineSchema).max(3),
    spaces: z.array(
      z.object({
        id: spaceIdSchema,
        title: z.string(),
        approvalStatus: approvalStatusSchema,
        occupancyBp: z.number().int().nonnegative(),
      }),
    ),
  })
  .strict();
export type OwnerDashboard = z.infer<typeof ownerDashboardSchema>;
