import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

import { formatPartnerRating, type StatusCopy } from '../addon-copy';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * The status of a valet or wash job, in words first. Announced politely so a
 * TalkBack user hears "Valet arrived" when the poll brings it, without having
 * to go looking (R-FE-12).
 */
export function StatusPanel({
  copy,
  icon,
  testID,
}: {
  copy: StatusCopy;
  icon: IconName;
  testID: string;
}) {
  return (
    <View style={styles.panel} accessibilityLiveRegion="polite" testID={testID}>
      <MaterialCommunityIcons name={icon} size={28} color={colors.primary} />
      <View style={styles.panelCopy}>
        <Text style={styles.panelLabel} accessibilityRole="header">
          {copy.label}
        </Text>
        <Text style={styles.detail}>{copy.detail}</Text>
      </View>
    </View>
  );
}

/** Who took the job. Never a phone number: the contract does not carry one. */
export function PartnerCard({
  name,
  subtitle,
  ratingAvgBp,
  ratingCount,
}: {
  name: string;
  subtitle: string | null;
  ratingAvgBp: number | null;
  ratingCount: number;
}) {
  return (
    <View style={styles.card}>
      <MaterialCommunityIcons
        name="account-circle-outline"
        size={36}
        color={colors.textSecondary}
      />
      <View style={styles.panelCopy}>
        <Text style={styles.name}>{name}</Text>
        {subtitle === null ? null : <Text style={styles.detail}>{subtitle}</Text>}
        <Text style={styles.detail}>{formatPartnerRating(ratingAvgBp, ratingCount)}</Text>
      </View>
    </View>
  );
}

/** A label and its value on one line, the value allowed to wrap. */
export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  panelCopy: { flex: 1, gap: spacing.xs },
  panelLabel: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  detail: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  name: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  rowLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  rowValue: { flexShrink: 1, fontSize: fontSize.sm, color: colors.text, textAlign: 'right' },
});
