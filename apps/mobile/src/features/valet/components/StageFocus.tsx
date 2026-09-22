import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ValetJobStatus } from '@parkease/contracts/enums';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * The stages a valet walks, in order, for the progress readout.
 *
 * This is presentation only — which stage is *current* comes from the server's
 * status, and which action is available comes from the server's
 * `availableEvents`. Neither is decided here.
 */
export const STAGE_SEQUENCE: readonly ValetJobStatus[] = [
  'accepted',
  'en_route',
  'arrived',
  'parking',
  'parked',
] as const;

export const STAGE_LABELS: Record<string, string> = {
  accepted: 'Accepted',
  en_route: 'On the way',
  arrived: 'Arrived',
  parking: 'Parking the car',
  parked: 'Parked',
  return_requested: 'Return requested',
  returning: 'Returning',
  completed: 'Delivered',
};

/**
 * Labels for the events the server says are available.
 *
 * Copy, not logic. The machine lives on the server; if it offers an event this
 * map does not name, the button falls back to a readable form of the event
 * rather than vanishing — a missing label should never hide a legal action.
 */
export const EVENT_LABELS: Record<string, string> = {
  depart: "I'm on the way",
  arrive: "I've arrived",
  start_parking: 'Start parking',
  confirm_parked: 'Confirm parked',
  depart_return: 'Start return',
  complete: 'Car delivered',
};

export interface StageFocusProps {
  readonly status: ValetJobStatus;
  readonly historyLabel: string | null;
  readonly expanded: boolean;
  readonly onToggleHistory: () => void;
}

/**
 * Direction "Focus": the current stage, large, with everything done collapsed
 * to one line. A valet glancing at this from a scooter needs one fact.
 */
export function StageFocus({ status, historyLabel, expanded, onToggleHistory }: StageFocusProps) {
  const index = STAGE_SEQUENCE.indexOf(status);
  const position = index === -1 ? null : index + 1;
  const label = STAGE_LABELS[status] ?? status;

  return (
    // The stage can change without the valet touching anything — the driver
    // requests a return, or a refetch lands a server-side advance. A screen
    // reader user focused on the proof capture below would otherwise never
    // learn the headline above them moved on.
    <View style={styles.root} testID="stage-focus" accessibilityLiveRegion="polite">
      {historyLabel === null ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? 'Hide' : 'Show'} completed steps. ${historyLabel}`}
          accessibilityState={{ expanded }}
          onPress={onToggleHistory}
          style={styles.history}
        >
          <Text style={styles.historyLabel}>{historyLabel}</Text>
          <MaterialCommunityIcons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.muted}
          />
        </Pressable>
      )}

      <View style={styles.headline}>
        {position === null ? null : (
          <Text style={styles.step} testID="stage-step">
            {`STEP ${String(position)} OF ${String(STAGE_SEQUENCE.length)}`}
          </Text>
        )}
        {/* The stage is readable as text, not only as a position in a bar. */}
        <Text accessibilityRole="header" style={styles.stage} testID="stage-label">
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  history: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  historyLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  headline: { gap: spacing.xs },
  step: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.primary,
    letterSpacing: 0.5,
  },
  stage: {
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
    lineHeight: fontSize['4xl'] * lineHeight.tight,
  },
});
