import { useEffect } from 'react';

import {
  buildCheckoutOptions,
  type CheckoutParams,
  type CheckoutResult,
  checkoutResultSchema,
} from '../checkout-html';

interface CheckoutSheetProps {
  readonly visible: boolean;
  readonly params: CheckoutParams;
  readonly onResult: (result: CheckoutResult) => void;
}

interface RazorpayResponse {
  razorpay_order_id?: unknown;
  razorpay_payment_id?: unknown;
  razorpay_signature?: unknown;
}
interface RazorpayFailure {
  error?: { description?: unknown; method?: unknown; metadata?: { method?: unknown } };
}
interface RazorpayInstance {
  on(event: 'payment.failed', cb: (r: RazorpayFailure) => void): void;
  open(): void;
}
type RazorpayCtor = new (options: object) => RazorpayInstance;

const SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

function loadCheckout(): Promise<RazorpayCtor> {
  const existing = (window as { Razorpay?: RazorpayCtor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = SCRIPT;
    tag.onload = () => {
      const ctor = (window as { Razorpay?: RazorpayCtor }).Razorpay;
      if (ctor) resolve(ctor);
      else reject(new Error('checkout.js loaded without Razorpay'));
    };
    tag.onerror = () => {
      reject(new Error('checkout.js failed to load'));
    };
    document.head.appendChild(tag);
  });
}

/**
 * Web build of CheckoutSheet: no WebView on web, so Razorpay's own script opens its modal
 * on this page. Same options builder, same result schema, same one-message rule as native.
 */
export function CheckoutSheet({ visible, params, onResult }: CheckoutSheetProps) {
  useEffect(() => {
    if (!visible) return;
    let sent = false;
    const send = (raw: unknown) => {
      if (sent) return;
      sent = true;
      const parsed = checkoutResultSchema.safeParse(raw);
      onResult(parsed.success ? parsed.data : { type: 'dismissed' });
    };

    loadCheckout()
      .then((Razorpay) => {
        const rzp = new Razorpay({
          ...buildCheckoutOptions(params),
          handler: (r: RazorpayResponse) => {
            send({
              type: 'success',
              razorpayOrderId: r.razorpay_order_id,
              razorpayPaymentId: r.razorpay_payment_id,
              razorpaySignature: r.razorpay_signature,
            });
          },
          modal: {
            escape: false,
            ondismiss: () => {
              send({ type: 'dismissed' });
            },
          },
        });
        rzp.on('payment.failed', ({ error }) => {
          send({
            type: 'failed',
            reason: error?.description ?? null,
            method: error?.metadata?.method ?? error?.method ?? null,
          });
        });
        rzp.open();
      })
      .catch((err: unknown) => {
        // Reported, not swallowed: the screen shows its payment-failed copy (R-FAIL-01).
        send({ type: 'failed', reason: String(err), method: null });
      });
    // ponytail: one checkout per open; params are fixed while the sheet is visible.
  }, [visible]);

  return null;
}
