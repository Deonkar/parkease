import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '../../shared/__tests__/render-native';
import { useHeldIdUpload, type HeldIdUpload } from '../hooks/useWasherQueries';

vi.mock('../api/washer', () => ({}));

/**
 * G9: an ID already uploaded survives leaving the registration screen when
 * only the documents CALL failed, so the profile's "add ID" re-sends the call
 * with that id instead of asking for a second photograph.
 *
 * Held in the query cache, not in a module variable: sign-out clears the
 * cache, so one partner's upload can never be sent under the next account.
 */
function Reader({ onRender }: { readonly onRender: (held: HeldIdUpload) => void }) {
  onRender(useHeldIdUpload());
  return null;
}

describe('useHeldIdUpload', () => {
  it('hands an id held on one screen to another, and forgets it once released', async () => {
    const client = new QueryClient();
    const seen: { register?: HeldIdUpload; profile?: HeldIdUpload } = {};

    render(
      <QueryClientProvider client={client}>
        <Reader
          onRender={(held) => {
            seen.register = held;
          }}
        />
        <Reader
          onRender={(held) => {
            seen.profile = held;
          }}
        />
      </QueryClientProvider>,
    );
    expect(seen.profile?.id).toBeNull();

    // TanStack notifies observers on a scheduled tick, so the act awaits it.
    await act(async () => {
      seen.register?.hold('parkease/documents/id-1');
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(seen.profile?.id).toBe('parkease/documents/id-1');

    await act(async () => {
      seen.profile?.release();
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(seen.register?.id).toBeNull();
  });

  it('is gone once the cache is cleared, as sign-out does', () => {
    const client = new QueryClient();
    const seen: { held?: HeldIdUpload } = {};
    render(
      <QueryClientProvider client={client}>
        <Reader
          onRender={(value) => {
            seen.held = value;
          }}
        />
      </QueryClientProvider>,
    );
    act(() => {
      seen.held?.hold('parkease/documents/id-1');
    });

    act(() => {
      client.clear();
    });

    expect(client.getQueryData(['washer', 'held-id-upload']) ?? null).toBeNull();
  });
});
