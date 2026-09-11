import { z } from 'zod';

export const razorpayWebhookPayloadSchema = z.object({
  entity: z.literal('event'),
  event: z.string(),
  contains: z.array(z.string()),
  payload: z.record(z.unknown()),
  created_at: z.number(),
});

export type RazorpayWebhookPayload = z.infer<typeof razorpayWebhookPayloadSchema>;
