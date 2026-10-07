import { NotificationsScreen } from '@/features/shared/notifications/NotificationsScreen';

// The Alerts tab is the notification feed; the same screen is the modal other roles reach from Profile.
export default function DriverAlertsScreen() {
  return <NotificationsScreen tab />;
}
