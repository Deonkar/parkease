import { EmptyState } from '@parkease/ui-native';
import { router } from 'expo-router';

export default function BookingsScreen() {
  return (
    <EmptyState
      title="No bookings yet"
      body="Find a parking spot and book your first one."
      actionLabel="Find Parking"
      onAction={() => {
        router.push('/(driver)');
      }}
    />
  );
}
