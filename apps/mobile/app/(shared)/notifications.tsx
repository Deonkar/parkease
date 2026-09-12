import { EmptyState } from '@parkease/ui-native';

export default function NotificationsScreen() {
  return (
    <EmptyState
      title="No notifications"
      body="Booking updates, payment confirmations, and important alerts will appear here."
    />
  );
}
