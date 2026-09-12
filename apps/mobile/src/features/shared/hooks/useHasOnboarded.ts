import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const KEY = 'parkease.hasOnboarded';

export function useHasOnboarded(): boolean | undefined {
  const [value, setValue] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    void AsyncStorage.getItem(KEY).then((v) => {
      setValue(v === 'true');
    });
  }, []);

  return value;
}

export async function markOnboarded(): Promise<void> {
  await AsyncStorage.setItem(KEY, 'true');
}
