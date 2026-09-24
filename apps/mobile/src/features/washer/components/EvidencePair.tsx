import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  colors,
  duration,
  easing,
  fontSize,
  fontWeight,
  opacity,
  radius,
  spacing,
} from '@parkease/tokens';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, useReducedMotion } from 'react-native-reanimated';

import type { EvidenceSlotState, PhotoSlot } from '../photo-gate';

export interface EvidenceSlotView {
  readonly state: EvidenceSlotState;
  /** The LOCAL image of this session's capture, or `null` (T7-T1). */
  readonly uri: string | null;
  /** The server would take a photo for this slot now: capture or Retake. */
  readonly writable: boolean;
  /** Why this slot's last send failed, in the words the upload chose (G4). */
  readonly error: string | null;
  /** False once the server refused the attach: only Retake is honest (G5). */
  readonly retryable: boolean;
  /** A short note that is not a failure, such as the job moving on (G5). */
  readonly notice: string | null;
}

export interface EvidencePairProps {
  readonly before: EvidenceSlotView;
  readonly after: EvidenceSlotView;
  readonly onCapture: (slot: PhotoSlot) => void;
  readonly onRetry: (slot: PhotoSlot) => void;
}

/** website.md §6 copy, for a failed slot that was handed no reason. */
const UPLOAD_FAILED = "Couldn't upload the photo. Check your connection.";

const NAME: Readonly<Record<PhotoSlot, string>> = { before: 'Before', after: 'After' };

const OWED: Readonly<Record<PhotoSlot, string>> = {
  before: 'Needed to start',
  after: 'Needed to finish',
};

/** Every state, in words (R-FE-12): colour and the badge only repeat it. */
const STATUS: Readonly<Record<EvidenceSlotState, string>> = {
  empty: 'not yet',
  uploading: 'uploading',
  failed: 'not sent',
  attached: 'done',
};

/**
 * The before/after pair — direction "Bay"'s organising idea (spec §2).
 *
 * One object with two equal slots, on screen from the moment of accept, so the
 * partner always sees which half of the evidence they still owe rather than
 * learning it from a locked button. Each slot is empty, uploading, failed or
 * attached, and every one of those is said in text.
 *
 * Presentational: which slot is attached comes from the server view and which
 * image is local comes from `usePhotoSlot`; the screen joins them.
 */
export function EvidencePair({ before, after, onCapture, onRetry }: EvidencePairProps) {
  const reduceMotion = useReducedMotion();
  // Slot fill on arrival — the tokens' motion, never a number typed here.
  const fill = reduceMotion
    ? undefined
    : FadeIn.duration(duration.base).easing(Easing.bezier(...easing.decelerate));

  const half = (slot: PhotoSlot, view: EvidenceSlotView) => (
    <EvidenceSlot
      key={slot}
      slot={slot}
      view={view}
      fill={fill}
      onCapture={() => {
        onCapture(slot);
      }}
      onRetry={() => {
        onRetry(slot);
      }}
    />
  );

  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow} accessibilityRole="header">
        Before & after photos
      </Text>
      <View style={styles.row}>
        {half('before', before)}
        {half('after', after)}
      </View>
    </View>
  );
}

interface EvidenceSlotProps {
  readonly slot: PhotoSlot;
  readonly view: EvidenceSlotView;
  readonly fill: ReturnType<typeof FadeIn.duration> | undefined;
  readonly onCapture: () => void;
  readonly onRetry: () => void;
}

function EvidenceSlot({ slot, view, fill, onCapture, onRetry }: EvidenceSlotProps) {
  const name = NAME[slot];
  const lower = name.toLowerCase();
  const { state, uri, writable } = view;

  const photo =
    uri === null ? null : (
      <Animated.View entering={fill} style={styles.fillLayer}>
        <Image
          source={{ uri }}
          style={[styles.image, state === 'failed' && styles.imageHeld]}
          accessibilityLabel={`${name} photo`}
          accessibilityIgnoresInvertColors
        />
      </Animated.View>
    );

  const frame = (() => {
    switch (state) {
      case 'empty':
        return (
          <View testID={`evidence-${slot}-frame`} style={[styles.frame, styles.frameEmpty]}>
            <MaterialCommunityIcons name="camera-outline" size={28} color={colors.textTertiary} />
            <Text style={styles.owed}>{OWED[slot]}</Text>
            {writable ? <Text style={styles.cue}>Tap to take the photo</Text> : null}
          </View>
        );
      case 'uploading':
        return (
          <View testID={`evidence-${slot}-frame`} style={styles.frame}>
            {photo}
            <View style={styles.band} accessibilityLiveRegion="polite">
              <MaterialCommunityIcons
                name="cloud-upload-outline"
                size={16}
                color={colors.textInverse}
              />
              <Text style={styles.bandText}>Uploading…</Text>
            </View>
          </View>
        );
      case 'failed':
        return (
          <View testID={`evidence-${slot}-frame`} style={[styles.frame, styles.frameFailed]}>
            {photo}
            <View style={styles.band}>
              <MaterialCommunityIcons
                name="cloud-off-outline"
                size={16}
                color={colors.textInverse}
              />
              <Text style={styles.bandText}>Not sent</Text>
            </View>
          </View>
        );
      case 'attached':
        return (
          <View testID={`evidence-${slot}-frame`} style={[styles.frame, styles.frameAttached]}>
            {photo ?? (
              // After a restart: the server holds the photo, and the app has
              // no URL to draw it from (T7-T1). Done is still done.
              <View style={styles.attachedBlank}>
                <MaterialCommunityIcons
                  name="image-check-outline"
                  size={28}
                  color={colors.availableInk}
                />
                <Text style={styles.attachedBlankText}>Photo attached</Text>
              </View>
            )}
            <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no">
              <MaterialCommunityIcons name="check" size={16} color={colors.textInverse} />
            </View>
          </View>
        );
    }
  })();

  // The empty frame is itself the camera button: the biggest target on the
  // screen for the thing the partner owes next.
  const body =
    state === 'empty' && writable ? (
      <Pressable
        testID={`evidence-${slot}-capture`}
        accessibilityRole="button"
        accessibilityLabel={`Take the ${lower} photo`}
        onPress={onCapture}
        style={styles.framePress}
      >
        {frame}
      </Pressable>
    ) : (
      frame
    );

  // Retake wherever the server would still take a photo — on a failed slot
  // too, so no state is a dead end: a Retry that keeps failing can always be
  // abandoned for a fresh photograph while the slot is open.
  const retake =
    (state === 'attached' || state === 'failed') && writable ? (
      <Pressable
        testID={`evidence-${slot}-capture`}
        accessibilityRole="button"
        accessibilityLabel={`Retake the ${lower} photo`}
        onPress={onCapture}
        style={styles.link}
      >
        <Text style={styles.linkLabel}>Retake</Text>
      </Pressable>
    ) : null;

  const retry =
    state === 'failed' && view.retryable ? (
      <Pressable
        testID={`evidence-${slot}-retry`}
        accessibilityRole="button"
        accessibilityLabel={`Retry sending the ${lower} photo`}
        onPress={onRetry}
        style={styles.link}
      >
        <Text style={styles.linkLabel}>Retry</Text>
      </Pressable>
    ) : null;

  return (
    <View testID={`evidence-${slot}`} style={styles.half}>
      {body}
      <View style={styles.caption}>
        <Text
          style={[
            styles.status,
            state === 'attached' && styles.statusDone,
            state === 'failed' && styles.statusFailed,
          ]}
        >
          {`${name} · ${STATUS[state]}`}
        </Text>
        {state === 'failed' ? null : retake}
      </View>
      {view.notice === null ? null : (
        <Text style={styles.note} testID={`evidence-${slot}-notice`}>
          {view.notice}
        </Text>
      )}
      {state === 'failed' ? (
        <>
          <Text style={styles.failure} accessibilityLiveRegion="polite">
            {view.error ?? UPLOAD_FAILED}
          </Text>
          {/* Their own row: two actions do not fit beside the status in a half. */}
          <View style={styles.actions}>
            {retry}
            {retake}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  eyebrow: {
    textTransform: 'uppercase',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.4,
  },
  row: { flexDirection: 'row', gap: spacing.md },
  half: { flexGrow: 1, flexBasis: 0 },
  framePress: { minHeight: 44, borderRadius: radius.lg },
  frame: {
    // A photo's own proportions, so the frame never crops the evidence away.
    aspectRatio: 4 / 3,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameEmpty: {
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  frameFailed: { borderWidth: 2, borderColor: colors.error },
  frameAttached: { backgroundColor: colors.availableSoft },
  owed: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  cue: { fontSize: fontSize.xs, color: colors.primary, textAlign: 'center' },
  fillLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  image: { width: '100%', height: '100%' },
  // Held but not sent: dimmed so it cannot pass for evidence the server has.
  imageHeld: { opacity: opacity.dimmed },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    backgroundColor: colors.overlay,
  },
  bandText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textInverse },
  attachedBlank: { alignItems: 'center', gap: spacing.xs },
  attachedBlankText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.availableInk,
  },
  badge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: spacing.xl,
    height: spacing.xl,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.available,
  },
  caption: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  status: {
    flexShrink: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.textTertiary,
  },
  statusDone: { color: colors.availableInk },
  statusFailed: { color: colors.errorInk },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  linkLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  failure: { fontSize: fontSize.xs, color: colors.errorInk },
  note: { fontSize: fontSize.xs, color: colors.textSecondary },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
});
