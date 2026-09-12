import { EmptyState } from '@parkease/ui-native';

export default function OwnerListingsScreen() {
  return (
    <EmptyState
      title="No listings yet"
      body="Your parking spaces and their availability will appear here. Add your first space to get started."
    />
  );
}
