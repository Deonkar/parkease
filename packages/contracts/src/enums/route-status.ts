import { z } from 'zod';

/**
 * A Route Linked Account's activation, as Razorpay reports it (task 16b). `pending` is ours:
 * the account exists but the product has not reached review yet.
 */
export const ROUTE_STATUS_VALUES = [
  'pending',
  'under_review',
  'needs_clarification',
  'activated',
  'rejected',
  'suspended',
] as const;

export const routeStatusSchema = z.enum(ROUTE_STATUS_VALUES);
export type RouteStatus = z.infer<typeof routeStatusSchema>;
