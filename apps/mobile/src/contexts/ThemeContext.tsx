import { colors } from '@parkease/tokens';
import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

interface ThemeContextValue {
  readonly colors: typeof colors;
  readonly colorScheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextValue>({
  colors,
  colorScheme: 'light',
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const colorScheme = systemScheme === 'dark' ? 'dark' : 'light';

  return <ThemeContext.Provider value={{ colors, colorScheme }}>{children}</ThemeContext.Provider>;
}
