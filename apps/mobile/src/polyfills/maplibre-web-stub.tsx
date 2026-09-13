import { View, Text, StyleSheet, type ViewProps } from 'react-native';

export function Map(props: ViewProps) {
  return (
    <View {...props}>
      <View style={styles.placeholder}>
        <Text style={styles.text}>Map (native only)</Text>
      </View>
    </View>
  );
}

export function Camera() {
  return null;
}

export function Marker({ children }: { children?: React.ReactNode; [key: string]: unknown }) {
  return <>{children}</>;
}

export const NetworkManager = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setConnected(connected: boolean) {},
};

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: { color: '#6B7280', fontSize: 14 },
});
