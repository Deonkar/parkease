import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CarwashJobStatus } from '@parkease/contracts/enums';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

const STEPS = ['On the way', 'Washing', 'Completed'] as const;

/**
 * Which of the three steps the job is on, or `null` when it is on none of
 * them — not yet accepted, or cancelled. Accepted and en route are one step to
 * the partner: both mean "get to the car".
 */
export function currentStepFor(status: CarwashJobStatus): number | null {
  switch (status) {
    case 'accepted':
    case 'en_route':
      return 0;
    case 'washing':
      return 1;
    case 'completed':
      return 2;
    case 'requested':
    case 'offered':
    case 'cancelled':
      return null;
  }
}

type StepState = 'done' | 'current' | 'pending';

const SPOKEN: Readonly<Record<StepState, string>> = {
  done: 'done',
  current: 'current step',
  pending: 'not yet',
};

/**
 * On the way → Washing → Completed.
 *
 * Each step differs by SHAPE as well as colour — a check, a ring, a hairline —
 * and says its state to a screen reader, so the current step is never carried
 * by colour alone (R-FE-12). A completed job is three checks: nothing is left
 * current once the work is done.
 */
export function StepRail({ status }: { readonly status: CarwashJobStatus }) {
  const current = currentStepFor(status);

  if (current === null) {
    return (
      <View style={styles.cancelled}>
        <MaterialCommunityIcons
          name="close-circle-outline"
          size={18}
          color={colors.textSecondary}
        />
        <Text style={styles.cancelledText}>
          {status === 'cancelled' ? 'This job was cancelled.' : 'Waiting for the job to start.'}
        </Text>
      </View>
    );
  }

  const stateOf = (index: number): StepState => {
    if (index < current || status === 'completed') return 'done';
    return index === current ? 'current' : 'pending';
  };

  return (
    <View style={styles.row}>
      {STEPS.map((label, index) => {
        const state = stateOf(index);
        return (
          <View
            key={label}
            testID={`step-${String(index)}`}
            style={styles.step}
            accessible
            accessibilityLabel={`${label}, ${SPOKEN[state]}`}
            accessibilityState={{ selected: state === 'current' }}
          >
            <View
              style={[
                styles.marker,
                state === 'done' && styles.markerDone,
                state === 'current' && styles.markerCurrent,
              ]}
            >
              {state === 'done' ? (
                <MaterialCommunityIcons name="check" size={14} color={colors.textInverse} />
              ) : null}
            </View>
            <Text
              style={[
                styles.label,
                state === 'done' && styles.labelDone,
                state === 'current' && styles.labelCurrent,
              ]}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  step: { flexGrow: 1, flexBasis: 0, alignItems: 'center', gap: spacing.xs },
  marker: {
    width: spacing.xl,
    height: spacing.xl,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerDone: { borderWidth: 0, backgroundColor: colors.available },
  markerCurrent: { borderWidth: 4, borderColor: colors.primary },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  labelDone: { fontWeight: fontWeight.semibold, color: colors.availableInk },
  labelCurrent: { fontWeight: fontWeight.bold, color: colors.primary },
  cancelled: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cancelledText: { fontSize: fontSize.sm, color: colors.textSecondary },
});
