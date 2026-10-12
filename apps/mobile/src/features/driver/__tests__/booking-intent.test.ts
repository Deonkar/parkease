import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { newIntent } from '@/lib/api';

// `@/lib/api` reaches secure-storage and through it expo-modules-core, which
// needs the `__DEV__` global that only the Metro bundler defines.
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('@/lib/secure-storage', () => ({
  secureStorage: { read: vi.fn(() => Promise.resolve(null)), write: vi.fn(), clear: vi.fn() },
}));

const HOOKS = path.resolve(__dirname, '../hooks/useBookings.ts');

/**
 * R-FE-05: an idempotency key is minted per *user intent* — never per attempt,
 * and never per render.
 *
 * `useBookings` originally called `newIntent()` straight in the hook body. That
 * runs on every render, and `useMutation` re-renders the component itself as
 * `isPending` flips, so the key changed between the attempt that timed out and
 * the "try again" that followed. The server saw two distinct intents and would
 * have reserved two slots — the exact double-booking the rule exists to stop.
 *
 * These are structural assertions over the source, not behavioural ones. The
 * behavioural test needs a React renderer, and this package runs under
 * `environment: 'node'` with react-native mocked, so `renderHook` is not
 * available without a setup change bigger than the thing being guarded. Stated
 * plainly rather than dressed up: what follows proves the *shape* is right, and
 * the shape is what regressed.
 */
describe('idempotency intent lifetime', () => {
  it('holds each intent in the shared useIntent, never minting one in a hook body', async () => {
    const source = await readFile(HOOKS, 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // The shared hook keeps the key in a ref (and ties it to the body, S-115);
    // a bare `newIntent()` here would be a hook minting per render again.
    expect(code).toContain("from '@/features/shared/hooks/useIntent'");
    expect(code).not.toMatch(/newIntent\(\)/);
  });

  it('sends every mutation through the intent, so a retry replays its key', async () => {
    const source = await readFile(HOOKS, 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    const mutationHooks = code.match(/export function use(Create|Cancel|Extend|SelfCheckIn)\w*/g);
    expect(mutationHooks).toHaveLength(4);
    expect(code.match(/const intent = useIntent\(\)/g)).toHaveLength(4);
    expect(code.match(/intent\.send\(/g)).toHaveLength(4);
  });

  it('demonstrates why a bare call in the hook body is wrong', () => {
    // The shape the code used to have: two "renders", two keys. The retry is
    // then no longer the same intent, and the server reserves twice.
    const render = () => newIntent().idempotencyKey;
    expect(render()).not.toBe(render());
  });

  it('mints a v7 uuid', () => {
    expect(newIntent().idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
