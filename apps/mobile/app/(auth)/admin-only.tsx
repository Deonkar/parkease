import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, iconSize, spacing } from '@parkease/tokens';
import { EmptyState } from '@parkease/ui-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';

/**
 * Where an account that holds only `admin` lands (S-54). The admin surface is
 * the web admin panel; every role choose-role offers is one this account does
 * not hold, so it is never sent there. The one thing to do here is sign out.
 */
export default function AdminOnlyScreen() {
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="admin-only">
      <EmptyState
        icon={
          <MaterialCommunityIcons
            name="monitor-dashboard"
            size={iconSize.hero}
            color={colors.textTertiary}
          />
        }
        title="Use the admin panel"
        body="This account is a ParkEase admin account. Admin work happens in the admin panel on the web, not in this app. To book or list parking here, sign in with a driver, owner, valet or washer account."
        actionLabel={signingOut ? 'Signing out…' : 'Sign out'}
        onAction={() => {
          if (signingOut) return;
          setSigningOut(true);
          void auth.signOut().finally(() => {
            setSigningOut(false);
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.base },
});
