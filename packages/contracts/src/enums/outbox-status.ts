import { z } from 'zod';

export const OUTBOX_STATUS_VALUES = ['pending', 'dispatched', 'failed'] as const;

export const outboxStatusSchema = z.enum(OUTBOX_STATUS_VALUES);
export type OutboxStatus = z.infer<typeof outboxStatusSchema>;

export const OutboxStatus = {
  PENDING: 'pending',
  DISPATCHED: 'dispatched',
  FAILED: 'failed',
} as const satisfies Record<string, OutboxStatus>;

type _MissingFromObject = Exclude<OutboxStatus, (typeof OutboxStatus)[keyof typeof OutboxStatus]>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
