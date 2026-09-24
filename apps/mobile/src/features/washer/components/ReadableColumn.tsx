import { layout } from '@parkease/tokens';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Content at a readable width (M6, walkthrough V5). On a phone it is the full
 * width; on a tablet or a landscape phone it centres at
 * `layout.contentMaxWidth`, so a job row's label and its amount are not a
 * screen apart. The ground around it is the screen's own.
 */
export function ReadableColumn({
  children,
  style,
}: {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.column, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  column: { flex: 1, width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center' },
});
