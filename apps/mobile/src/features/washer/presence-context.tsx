import { createContext, useContext, type ReactNode } from 'react';

import { useWasherPresence, type WasherPresence } from './hooks/useWasherPresence';

const PresenceContext = createContext<WasherPresence | null>(null);

/**
 * Owns the one heartbeat for the whole `(washer)` group. Mounted once in the
 * layout, so switching tabs never stops a partner from being dispatchable.
 * React context, not a store: this is one value with one owner.
 */
export function WasherPresenceProvider({ children }: { readonly children: ReactNode }) {
  const presence = useWasherPresence();
  return <PresenceContext.Provider value={presence}>{children}</PresenceContext.Provider>;
}

export function usePresence(): WasherPresence {
  const presence = useContext(PresenceContext);
  if (presence === null) {
    throw new Error('usePresence() must be used inside <WasherPresenceProvider>');
  }
  return presence;
}
