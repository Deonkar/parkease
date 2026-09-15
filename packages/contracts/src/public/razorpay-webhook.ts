import { z } from 'zod';

/**
 * Razorpay's webhook envelope, narrowed to the three events we act on.
 *
 * The previous version of this file parsed `payload` as `z.record(z.unknown())`,
 * which is a schema that accepts anything — so every field the handlers read was
 * an `as` in disguise, exactly what R-VAL-01 exists to stop. A webhook is the
 * least trustworthy input in the system: it arrives unauthenticated over the
 * public internet and is only believed because of an HMAC.
 *
 * Amounts are parsed as non-negative integers because Razorpay sends paise as a
 * JSON number. A fractional value would be a rupee amount in disguise, and a
 * rupee amount that survives parsing is a hundredfold error (R-MONEY-01).
 */
const paiseFromGateway = z.number().int().nonnegative();

const paymentEntitySchema = z.object({
  id: z.string().min(1),
  order_id: z.string().min(1),
  amount: paiseFromGateway,
  currency: z.string().min(1),
  status: z.string().min(1),
  method: z.string().min(1).optional(),
  error_code: z.string().nullish(),
  error_description: z.string().nullish(),
});

const refundEntitySchema = z.object({
  id: z.string().min(1),
  payment_id: z.string().min(1),
  amount: paiseFromGateway,
  status: z.string().min(1),
});

/**
 * The envelope fields every event carries.
 *
 * Spread into each variant rather than intersected with the union. `A & (B | C)`
 * is not a discriminated union to TypeScript: narrowing on `.event` stops
 * working, and every handler needs a cast to reach `payload` — which is the
 * `as` this schema exists to remove. Extending each branch keeps the discriminant
 * doing its job.
 */
const envelopeShape = {
  entity: z.literal('event'),
  /** Razorpay's own id for the delivery. The dedup key when the header is absent. */
  id: z.string().min(1).optional(),
  contains: z.array(z.string()).optional(),
  created_at: z.number().int().optional(),
};

const capturedSchema = z.object({
  ...envelopeShape,
  event: z.literal('payment.captured'),
  payload: z.object({ payment: z.object({ entity: paymentEntitySchema }) }),
});

const failedSchema = z.object({
  ...envelopeShape,
  event: z.literal('payment.failed'),
  payload: z.object({ payment: z.object({ entity: paymentEntitySchema }) }),
});

const refundProcessedSchema = z.object({
  ...envelopeShape,
  event: z.literal('refund.processed'),
  payload: z.object({ refund: z.object({ entity: refundEntitySchema }) }),
});

const HANDLED_EVENTS = ['payment.captured', 'payment.failed', 'refund.processed'] as const;

/**
 * Anything else Razorpay sends. It still has to be a well-formed envelope with
 * an event name — we log it and return 200, because a 500 makes Razorpay retry
 * an event we were never going to handle.
 *
 * The refusal of the three handled names is load-bearing, not decoration. A
 * plain `z.string()` here makes this branch match *any* object with an event
 * name, so a malformed `payment.captured` — no order id, a rupee amount,
 * no payload at all — stops failing and starts parsing as "unhandled". The
 * strict variants above would then never reject anything, which is precisely the
 * hole the old `z.record(z.unknown())` schema had. Tests caught it here.
 */
const unhandledSchema = z.object({
  ...envelopeShape,
  event: z
    .string()
    .min(1)
    .refine((event) => !(HANDLED_EVENTS as readonly string[]).includes(event), {
      message: 'a handled event must match its own schema, not fall through to unhandled',
    }),
});

/**
 * The unhandled branch is re-tagged as `event: 'unhandled'`, carrying the real
 * name in `rawEvent`.
 *
 * Without it the branch types `event` as `string`, which overlaps every literal
 * — so `switch (parsed.event) { case 'payment.captured': ... }` fails to narrow
 * and `payload` is unreachable without a cast. Retagging makes the output a
 * genuine discriminated union over four literals, and the handler switch then
 * type-checks on its own.
 */
const taggedUnhandledSchema = unhandledSchema.transform((parsed) => ({
  ...parsed,
  event: 'unhandled' as const,
  rawEvent: parsed.event,
}));

export const razorpayWebhookPayloadSchema = z.union([
  z.discriminatedUnion('event', [capturedSchema, failedSchema, refundProcessedSchema]),
  taggedUnhandledSchema,
]);

export type RazorpayWebhookPayload = z.infer<typeof razorpayWebhookPayloadSchema>;
export type RazorpayPaymentEntity = z.infer<typeof paymentEntitySchema>;
export type RazorpayRefundEntity = z.infer<typeof refundEntitySchema>;

export const RAZORPAY_WEBHOOK_PATH = '/api/v1/webhooks/razorpay';
