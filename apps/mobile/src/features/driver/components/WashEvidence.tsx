import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

interface WashEvidenceProps {
  readonly beforePhotoId: string | null;
  readonly afterPhotoId: string | null;
}

/**
 * The before/after pair, as far as the driver can see it today.
 *
 * The partner must photograph the car before starting and after finishing
 * (§13.8), and the driver view carries the two photo ids. It does not carry a
 * way to look at them: the photos are private uploads and no driver route signs
 * a read URL for one. So this says which photos are on record — the evidence
 * exists and support can open it — rather than drawing an image it cannot load.
 */
export function WashEvidence({ beforePhotoId, afterPhotoId }: WashEvidenceProps) {
  if (beforePhotoId === null && afterPhotoId === null) return null;

  return (
    <View style={styles.card} testID="wash-evidence">
      <Text style={styles.heading}>Photos of your car</Text>
      <EvidenceRow
        testID="wash-photo-before"
        label="Before the wash"
        taken={beforePhotoId !== null}
      />
      <EvidenceRow testID="wash-photo-after" label="After the wash" taken={afterPhotoId !== null} />
      <Text style={styles.note}>
        Your partner photographs the car before and after. If something looks wrong, contact support
        and we will check the photos with you.
      </Text>
    </View>
  );
}

function EvidenceRow({ label, taken, testID }: { label: string; taken: boolean; testID: string }) {
  return (
    <View style={styles.row} testID={testID}>
      <MaterialCommunityIcons
        name={taken ? 'camera-outline' : 'camera-off-outline'}
        size={18}
        color={taken ? colors.availableInk : colors.textSecondary}
      />
      <Text style={styles.label}>
        {label}: {taken ? 'on record' : 'not yet taken'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  heading: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { fontSize: fontSize.sm, color: colors.text },
  note: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    lineHeight: fontSize.xs * lineHeight.normal,
  },
});
