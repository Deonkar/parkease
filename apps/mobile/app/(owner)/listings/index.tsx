import { EmptyState } from '@parkease/ui-native';
import { router } from 'expo-router';

export default function ListingsScreen() {
  return (
    <EmptyState
      title="No listings yet"
      body="List your parking space and start earning passive income."
      actionLabel="Add Listing"
      onAction={() => {
        router.push('/(owner)/listings/new');
      }}
    />
  );
}
