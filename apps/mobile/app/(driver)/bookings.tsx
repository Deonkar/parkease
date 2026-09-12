import { EmptyState } from '@parkease/ui-native';

export default function DriverBookingsScreen() {
  return (
    <EmptyState
      title="No bookings yet"
      body="Your upcoming and past parking bookings will appear here."
    />
  );
}
