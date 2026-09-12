import { useMemo, useState } from 'react';

import { newIntent, type Intent } from '@/lib/api';

export interface IntentWithReset extends Intent {
  readonly reset: () => void;
}

export function useIntent(): IntentWithReset {
  const [intent, setIntent] = useState(newIntent);

  return useMemo(
    () => ({
      ...intent,
      reset: () => {
        setIntent(newIntent());
      },
    }),
    [intent],
  );
}
