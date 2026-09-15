import type { PaymentOrder } from '@parkease/contracts/driver';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { useIntent } from '@/features/shared/hooks/useIntent';

import { createPaymentOrder, verifyPayment } from '../api/payments';
import type { CheckoutResult } from '../checkout-html';

import { BOOKINGS_KEY } from './useBookings';

export type CheckoutPhase =
  | { readonly phase: 'idle' }
  | { readonly phase: 'creating-order' }
  | { readonly phase: 'checkout'; readonly order: PaymentOrder; readonly method?: string }
  | { readonly phase: 'verifying' }
  | { readonly phase: 'failed'; readonly method: string | null }
  | { readonly phase: 'confirmed'; readonly bookingId: string };

/**
 * One checkout intent, from the first Pay tap to a confirmed payment.
 *
 * **The idempotency key is minted once per intent**, by the shared `useIntent`
 * hook — whose `useState(newIntent)` initialiser form runs once on mount rather
 * than on every render. That distinction is the whole point: `useMutation` re-
 * renders the component as `isPending` flips, so a key minted in the hook body
 * would differ between the attempt that timed out and the "Try Again" that
 * follows. The server would see two intents and create two orders (R-FE-05;
 * learnings.md records this exact bug from the booking flow, where it reserved
 * two slots).
 *
 * `reset()` on success, so the next booking starts a fresh intent rather than
 * replaying this one's stored response.
 *
 * **Two intents, not one.** Creating the order and confirming the payment are
 * different endpoints, and ADR-011 scopes a key to its endpoint — so one key
 * across both answers 422 on the second call and no payment is ever confirmed.
 * They are also genuinely different user intents: "give me an order to pay" and
 * "I have paid, confirm it". Sharing a key between them was a bug found in
 * review, by the endpoint check added to `IdempotencyService` earlier in this
 * same task.
 */
export function useCheckout(bookingId: string | undefined) {
  const queryClient = useQueryClient();
  const orderIntent = useIntent();
  const verifyIntent = useIntent();
  const [state, setState] = useState<CheckoutPhase>({ phase: 'idle' });

  const orderMutation = useMutation({
    mutationFn: (id: string) => createPaymentOrder(id, orderIntent),
  });

  const verifyMutation = useMutation({
    mutationFn: (body: Parameters<typeof verifyPayment>[0]) => verifyPayment(body, verifyIntent),
  });

  /**
   * Opens Checkout. `method` prefills Razorpay's picker on a retry; omitting it
   * shows the full list, which is what "Change Method" wants.
   */
  const start = useCallback(
    (method?: string) => {
      if (bookingId === undefined) return;

      setState({ phase: 'creating-order' });
      orderMutation.mutate(bookingId, {
        onSuccess: (order) => {
          setState(
            method === undefined
              ? { phase: 'checkout', order }
              : { phase: 'checkout', order, method },
          );
        },
        onError: () => {
          // The order could not even be created — no network, an owner without
          // a Linked Account. Surfaced as a failure rather than a silent
          // no-op, which would leave the Pay button looking dead (R-FAIL-01).
          setState({ phase: 'failed', method: null });
        },
      });
    },
    [bookingId, orderMutation],
  );

  const handleResult = useCallback(
    (result: CheckoutResult) => {
      if (result.type === 'dismissed') {
        // The driver closed Checkout. The booking is untouched and the slot
        // stays held — cancelling here would take away a spot they are still
        // deciding about.
        setState({ phase: 'idle' });
        return;
      }

      if (result.type === 'failed') {
        setState({ phase: 'failed', method: result.method ?? null });
        return;
      }

      setState({ phase: 'verifying' });
      verifyMutation.mutate(
        {
          razorpayOrderId: result.razorpayOrderId,
          razorpayPaymentId: result.razorpayPaymentId,
          razorpaySignature: result.razorpaySignature,
        },
        {
          onSuccess: (payment) => {
            // Both intents are spent. A later booking mints fresh keys.
            orderIntent.reset();
            verifyIntent.reset();
            // No optimistic status write: the confirmed state arrives from the
            // server, which is the only thing that knows whether the webhook
            // got there first.
            void queryClient.invalidateQueries({ queryKey: BOOKINGS_KEY });
            setState({ phase: 'confirmed', bookingId: payment.bookingId });
          },
          onError: () => {
            // Verification failed, but the webhook may still confirm this
            // booking — it is the authoritative path. Showing the failure copy
            // is honest about what we know right now, and "Try Again" reuses
            // the same key, so a genuine double-charge is not on the table.
            setState({ phase: 'failed', method: null });
          },
        },
      );
    },
    [orderIntent, queryClient, verifyIntent, verifyMutation],
  );

  const dismissFailure = useCallback(() => {
    setState({ phase: 'idle' });
  }, []);

  return { state, start, handleResult, dismissFailure };
}
