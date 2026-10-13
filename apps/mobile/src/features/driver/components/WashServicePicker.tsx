import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CARWASH_SERVICE_NAME_VALUES, type CarwashServiceName } from '@parkease/contracts/enums';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SERVICE_LABELS } from '@/features/shared/carwash-labels';

interface WashServicePickerProps {
  readonly selected: CarwashServiceName | null;
  readonly onSelect: (service: CarwashServiceName) => void;
}

/**
 * The closed catalogue as a single-choice list. No prices beside the names, and
 * that is not an omission: a wash is priced by the partner who takes it, so
 * there is no number to show until somebody accepts (`requestCarwashSchema`).
 */
export function WashServicePicker({ selected, onSelect }: WashServicePickerProps) {
  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {CARWASH_SERVICE_NAME_VALUES.map((service) => {
        const isSelected = selected === service;
        return (
          <Pressable
            key={service}
            testID={`wash-service-${service}`}
            onPress={() => {
              onSelect(service);
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            accessibilityLabel={SERVICE_LABELS[service]}
            style={[styles.option, isSelected && styles.optionSelected]}
          >
            <MaterialCommunityIcons
              name={isSelected ? 'radiobox-marked' : 'radiobox-blank'}
              size={20}
              color={isSelected ? colors.primary : colors.textSecondary}
            />
            <Text style={[styles.label, isSelected && styles.labelSelected]}>
              {SERVICE_LABELS[service]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  label: { fontSize: fontSize.base, color: colors.text },
  labelSelected: { fontWeight: fontWeight.semibold },
});
