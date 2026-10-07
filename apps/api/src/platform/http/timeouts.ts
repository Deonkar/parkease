/**
 * How long one call to a payment gateway (Razorpay, RazorpayX, Route) may take before it is
 * abandoned. A request holds a pooled connection and an idempotency claim while it waits, so an
 * unbounded call is both a starved pool and a claim that could go stale mid-flight (S-64).
 */
export const GATEWAY_TIMEOUT_MS = 10_000;
