import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@parkease/tokens';
import { EmptyState } from '@parkease/ui-native';

export default function OwnerEarningsScreen() {
  return (
    <EmptyState
      title="No earnings yet"
      body="Your earnings breakdown, payout history, and tax summary will appear here once you receive bookings."
      icon={<MaterialCommunityIcons name="wallet-outline" size={48} color={colors.textTertiary} />}
    />
  );
}
