import { z } from 'zod';

export interface CheckoutOptions {
  readonly key: string;
  readonly order_id: string;
  readonly amount: number;
  readonly currency: 'INR';
  readonly name: string;
  readonly description: string;
  readonly prefill: { readonly name: string; readonly contact: string };
  readonly theme: { readonly color: string };
  readonly method?: Readonly<Record<string, boolean>>;
}

export interface CheckoutParams {
  readonly keyId: string;
  readonly razorpayOrderId: string;
  readonly amountPaise: number;
  readonly spaceTitle: string;
  readonly themeColor: string;
  readonly prefill: { readonly name: string; readonly contact: string };
  /** Opens Checkout straight onto this method. Omit to show Razorpay's picker. */
  readonly method?: string;
}

/**
 * What the Checkout page is allowed to tell us.
 *
 * A `postMessage` from a WebView is data from outside the process — the page is
 * ours, but the frame it runs in is not, and a schema here costs nothing while
 * an `as` would be the one unchecked boundary in the whole payment path
 * (R-VAL-01).
 *
 * Note what is absent: an amount. The client cannot influence what we believe
 * was paid. `POST /driver/payments/verify` re-fetches the order from Razorpay
 * and compares against the amount fixed at order creation (R-SEC-09), so a
 * forged success here buys nothing.
 */
export const checkoutResultSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('success'),
    razorpayOrderId: z.string().min(1).max(64),
    razorpayPaymentId: z.string().min(1).max(64),
    razorpaySignature: z.string().min(1).max(256),
  }),
  z.object({
    type: z.literal('failed'),
    /** Razorpay's description, shown to nobody — the copy is ours (website.md §6). */
    reason: z.string().max(500).nullish(),
    /** The method that failed, when Razorpay names it. Drives the retry prefill. */
    method: z.string().max(32).nullish(),
  }),
  z.object({ type: z.literal('dismissed') }),
]);

export type CheckoutResult = z.infer<typeof checkoutResultSchema>;

/**
 * The Checkout options, built from server-issued values.
 *
 * Separate from the document on purpose. An earlier version interpolated these
 * into a `<script>` block, and a test caught what that costs: `JSON.stringify`
 * escapes quotes but leaves `<` alone, so a space title containing
 * `</script><script>…` closed the block and everything after it became markup.
 * Space titles are owner-supplied, so that was a genuine cross-user injection.
 *
 * The fix is not better escaping — it is not putting another user's text into a
 * document we build at all. These go through the WebView's
 * `injectedJavaScriptObject`, which the library serialises into a typed channel,
 * and the page below reads them back. No interpolation, nothing to escape.
 */
export function buildCheckoutOptions(params: CheckoutParams): CheckoutOptions {
  return {
    key: params.keyId,
    order_id: params.razorpayOrderId,
    // Paise, straight from the server. The app never computes an amount (R-FE-06).
    amount: params.amountPaise,
    currency: 'INR',
    name: 'ParkEase',
    description: params.spaceTitle,
    prefill: params.prefill,
    theme: { color: params.themeColor },
    ...(params.method === undefined ? {} : { method: { [params.method]: true } }),
  };
}

/**
 * The Checkout document. Static — it carries no booking, no amount and no title,
 * so there is nothing in it to escape and nothing that changes per driver.
 *
 * Razorpay's own React Native SDK does not support the New Architecture, which
 * ADR-014 makes mandatory, so Standard Checkout runs in a WebView instead. That
 * is Razorpay's supported web integration rather than a workaround of ours
 * (ADR-025).
 *
 * The publishable key id reaches the page through the injected object by design.
 * The key *secret* and the webhook secret never leave the server and never carry
 * an `EXPO_PUBLIC_` prefix (R-ENV-05).
 */
export const CHECKOUT_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>ParkEase payment</title>
  <style>
    html, body { margin: 0; height: 100%; background: #F8FAFC;
                 font-family: system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <script>
    (function () {
      var bridge = window.ReactNativeWebView;
      var sent = false;

      function send(payload) {
        // Exactly one message per checkout. Razorpay fires 'ondismiss' after a
        // failure as well, and a second message would reopen a sheet the screen
        // has already moved past.
        if (sent) return;
        sent = true;
        bridge.postMessage(JSON.stringify(payload));
      }

      try {
        var options = JSON.parse(bridge.injectedObjectJson());

        options.handler = function (response) {
          send({
            type: 'success',
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature
          });
        };

        options.modal = {
          escape: false,
          ondismiss: function () { send({ type: 'dismissed' }); }
        };

        var rzp = new Razorpay(options);

        rzp.on('payment.failed', function (response) {
          var error = (response && response.error) || {};
          send({
            type: 'failed',
            reason: error.description || null,
            method: (error.metadata && error.metadata.method) || error.method || null
          });
        });

        rzp.open();
      } catch (error) {
        // Checkout could not even open — a blocked script, no network, no
        // bridge. Reported as a failure rather than swallowed, so the screen
        // shows the §6 copy instead of an empty WebView the driver has to guess
        // about (R-FAIL-01).
        send({ type: 'failed', reason: String(error && error.message), method: null });
      }
    })();
  </script>
  <noscript>JavaScript is required to pay.</noscript>
</body>
</html>`;

/**
 * Why the WebView is not origin-restricted, and what protects it instead.
 *
 * A card payment redirects to the issuing bank's 3-D Secure page, which lives on
 * whatever domain that bank uses — so an allowlist of Razorpay origins would
 * break every card transaction. An earlier version of this file exported one
 * anyway, with a test asserting it was all-Razorpay. It was never wired to the
 * WebView. A control that is defined, tested and unused is worse than no
 * control: the test reads as assurance and there is none. A security pass found
 * it; both are gone.
 *
 * What actually holds the boundary:
 *   - the page is static and loads exactly one script, Razorpay's own;
 *   - nothing user-written is interpolated into it;
 *   - the bridge result is parsed by `checkoutResultSchema`, and has nowhere to
 *     put an amount;
 *   - the server re-fetches the order from Razorpay regardless, so nothing the
 *     page says can change what we believe was paid (R-SEC-09).
 */
