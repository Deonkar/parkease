import { colors, spacing } from '@parkease/tokens';
import { ActivityIndicator, Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import {
  buildCheckoutOptions,
  CHECKOUT_HTML,
  type CheckoutParams,
  type CheckoutResult,
  checkoutResultSchema,
} from '../checkout-html';

interface CheckoutSheetProps {
  readonly visible: boolean;
  readonly params: CheckoutParams;
  readonly onResult: (result: CheckoutResult) => void;
}

/**
 * Razorpay Standard Checkout, hosted in a WebView.
 *
 * Full-screen rather than a bottom sheet: Checkout renders its own modal
 * chrome, and stacking two sets of sheet edges produces the doubled-rounded-
 * corner look that reads as an embedded web page rather than part of the app.
 *
 * `onRequestClose` is the Android back button. It reports a dismissal, which the
 * screen treats as "the driver changed their mind" — the booking is untouched
 * and the slot stays held.
 */
export function CheckoutSheet({ visible, params, onResult }: CheckoutSheetProps) {
  const insets = useSafeAreaInsets();

  const handleMessage = (event: WebViewMessageEvent): void => {
    let raw: unknown;
    try {
      raw = JSON.parse(event.nativeEvent.data);
    } catch {
      // Not our message. Treated as a dismissal rather than ignored, because
      // silently doing nothing leaves the driver staring at a WebView with no
      // way back (R-FAIL-01).
      onResult({ type: 'dismissed' });
      return;
    }

    const parsed = checkoutResultSchema.safeParse(raw);
    onResult(parsed.success ? parsed.data : { type: 'dismissed' });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={() => {
        onResult({ type: 'dismissed' });
      }}
    >
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        {visible ? (
          <WebView
            source={{ html: CHECKOUT_HTML, baseUrl: 'https://checkout.razorpay.com' }}
            // The order, amount and title travel through the library's own
            // typed channel rather than being interpolated into the document.
            // Space titles are owner-supplied, and a title containing
            // `</script>` used to break out of the script block.
            injectedJavaScriptObject={buildCheckoutOptions(params)}
            onMessage={handleMessage}
            // Checkout needs both to render its payment forms at all.
            javaScriptEnabled
            domStorageEnabled
            // UPI intent links hand off to GPay/PhonePe. Without this the tap
            // does nothing and the driver believes the app is broken.
            originWhitelist={['https://*', 'upi://*', 'intent://*']}
            setSupportMultipleWindows={false}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loading}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            )}
            onError={() => {
              onResult({ type: 'failed', reason: null, method: null });
            }}
            onHttpError={() => {
              onResult({ type: 'failed', reason: null, method: null });
            }}
            style={styles.web}
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  web: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
  },
});
