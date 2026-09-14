import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@parkease/tokens';
import { EmptyState } from '@parkease/ui-native';

export default function OwnerDashboardScreen() {
  return (
    <EmptyState
      title="Your Dashboard"
      body="Today's earnings, active bookings, occupancy rate, and monthly summary will appear here."
      icon={
        <MaterialCommunityIcons
          name="view-dashboard-outline"
          size={48}
          color={colors.textTertiary}
        />
      }
    />
  );
}
