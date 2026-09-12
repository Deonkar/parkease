import { EmptyState } from '@parkease/ui-native';

export default function DriverAlertsScreen() {
  return (
    <EmptyState
      title="No alerts"
      body="Booking reminders, expiry warnings, and payment updates will appear here."
    />
  );
}
