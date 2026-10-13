import { describe, expect, it, vi } from 'vitest';

// `@/lib/api` reaches secure-storage and through it react-native.
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('@/lib/secure-storage', () => ({
  secureStorage: { read: vi.fn(() => Promise.resolve(null)), write: vi.fn(), clear: vi.fn() },
}));

const { mount } = await import('./render-native');
const { useIntent } = await import('../hooks/useIntent');
const { bodyHash, IntentKeeper, sendIntent, REQUEST_ALREADY_APPLIED, REQUEST_IN_FLIGHT } =
  await import('../intent');
const { toApiFailure } = await import('../api/errors');
const { AlreadyAppliedError } = await import('../intent');

type Handle = ReturnType<typeof useIntent>;

let minted = 0;
const mint = () => ({ idempotencyKey: `key-${String((minted += 1))}` });

/** A 409 from the idempotency interceptor, shaped as axios rejects it. */
const conflict = (code: string) =>
  Object.assign(new Error(code), {
    response: { status: 409, data: { error: { code, message: code } } },
  });
const lost = () => Object.assign(new Error('timeout'), { request: {} });
const noSleep = () => Promise.resolve();

/** Renders a component that holds one intent, the way a mutation hook does. */
function holdIntent(): { readonly current: () => Handle; readonly rerender: () => void } {
  let handle: Handle | null = null;
  function Probe() {
    handle = useIntent();
    return null;
  }
  const view = mount(<Probe />);
  return {
    current: () => {
      if (handle === null) throw new Error('not rendered');
      return handle;
    },
    rerender: () => {
      view.update(<Probe />);
    },
  };
}

describe('bodyHash', () => {
  it('is the same for the same fields in any order', () => {
    expect(bodyHash({ a: 1, b: 'x' })).toBe(bodyHash({ b: 'x', a: 1 }));
  });

  it('ignores an undefined field, as JSON on the wire does', () => {
    expect(bodyHash({ a: 1, reason: undefined })).toBe(bodyHash({ a: 1 }));
  });

  it('differs when a value changes', () => {
    expect(bodyHash({ ifsc: 'HDFC0001234' })).not.toBe(bodyHash({ ifsc: 'HDFC0001235' }));
    expect(bodyHash({ items: [1, 2] })).not.toBe(bodyHash({ items: [2, 1] }));
  });
});

describe('IntentKeeper', () => {
  it('keeps the key across retries of the same body', () => {
    const keeper = new IntentKeeper(mint);
    const first = keeper.forBody({ amount: 5 }).idempotencyKey;
    expect(keeper.forBody({ amount: 5 }).idempotencyKey).toBe(first);
  });

  it('mints a new key once the body changes (S-115)', () => {
    const keeper = new IntentKeeper(mint);
    const first = keeper.forBody({ amount: 5 }).idempotencyKey;
    expect(keeper.forBody({ amount: 6 }).idempotencyKey).not.toBe(first);
  });
});

describe('sendIntent', () => {
  it('spends the key on success', async () => {
    const keeper = new IntentKeeper(mint);
    const sent: string[] = [];
    const attempt = (intent: { idempotencyKey: string }) => {
      sent.push(intent.idempotencyKey);
      return Promise.resolve('ok');
    };
    await sendIntent(keeper, { a: 1 }, attempt, () => Promise.resolve('applied'));
    await sendIntent(keeper, { a: 1 }, attempt, () => Promise.resolve('applied'));
    expect(sent[0]).not.toBe(sent[1]);
  });

  it('keeps the key after a lost response, so the retry replays it', async () => {
    const keeper = new IntentKeeper(mint);
    const sent: string[] = [];
    const failing = (intent: { idempotencyKey: string }) => {
      sent.push(intent.idempotencyKey);
      return Promise.reject(lost());
    };
    await expect(sendIntent(keeper, { a: 1 }, failing, vi.fn())).rejects.toThrow('timeout');
    await expect(sendIntent(keeper, { a: 1 }, failing, vi.fn())).rejects.toThrow('timeout');
    expect(sent[0]).toBe(sent[1]);
  });

  it('treats REQUEST_ALREADY_APPLIED as success and answers with the refetch', async () => {
    const keeper = new IntentKeeper(mint);
    const refetch = vi.fn(() => Promise.resolve('refetched'));
    const result = await sendIntent(
      keeper,
      { a: 1 },
      () => Promise.reject(conflict(REQUEST_ALREADY_APPLIED)),
      refetch,
    );
    expect(result).toBe('refetched');
    expect(refetch).toHaveBeenCalledTimes(1);
    // The key is spent: the next intent is a new one.
    expect(keeper.forBody({ a: 1 }).idempotencyKey).not.toBe('key-0');
  });

  it('waits out REQUEST_IN_FLIGHT and re-sends with the SAME key', async () => {
    const keeper = new IntentKeeper(mint);
    const sent: string[] = [];
    const sleep = vi.fn(noSleep);
    let calls = 0;
    const result = await sendIntent(
      keeper,
      { a: 1 },
      (intent) => {
        sent.push(intent.idempotencyKey);
        calls += 1;
        return calls < 3 ? Promise.reject(conflict(REQUEST_IN_FLIGHT)) : Promise.resolve('won');
      },
      vi.fn(),
      { sleep },
    );
    expect(result).toBe('won');
    expect(new Set(sent).size).toBe(1);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up on REQUEST_IN_FLIGHT after the last wait, keeping the key', async () => {
    const keeper = new IntentKeeper(mint);
    const attempt = vi.fn(() => Promise.reject(conflict(REQUEST_IN_FLIGHT)));
    await expect(
      sendIntent(keeper, { a: 1 }, attempt, vi.fn(), { sleep: noSleep, maxInFlightWaits: 2 }),
    ).rejects.toThrow(REQUEST_IN_FLIGHT);
    expect(attempt).toHaveBeenCalledTimes(3);
  });
});

describe('useIntent', () => {
  it('holds one key across re-renders', () => {
    const intent = holdIntent();
    const key = intent.current().idempotencyKey;
    intent.rerender();
    expect(intent.current().idempotencyKey).toBe(key);
  });

  it('a lost response then an edited form sends a NEW key, not a 422 forever (S-115)', async () => {
    const intent = holdIntent();
    const sent: { key: string; body: unknown }[] = [];
    const server = (body: unknown) => (key: { idempotencyKey: string }) => {
      sent.push({ key: key.idempotencyKey, body });
      // The first attempt commits server-side and its response is lost.
      return sent.length === 1 ? Promise.reject(lost()) : Promise.resolve('saved');
    };

    const first = { accountNumber: '111' };
    await expect(intent.current().send(first, server(first), vi.fn())).rejects.toThrow();
    intent.rerender();

    const edited = { accountNumber: '222' };
    await expect(intent.current().send(edited, server(edited), vi.fn())).resolves.toBe('saved');

    expect(sent).toHaveLength(2);
    expect(sent[1]?.key).not.toBe(sent[0]?.key);
  });

  it('a lost response then the same form replays the same key', async () => {
    const intent = holdIntent();
    const keys: string[] = [];
    const attempt = (key: { idempotencyKey: string }) => {
      keys.push(key.idempotencyKey);
      return keys.length === 1 ? Promise.reject(lost()) : Promise.resolve('saved');
    };
    const body = { accountNumber: '111' };
    await expect(intent.current().send(body, attempt, vi.fn())).rejects.toThrow();
    await intent.current().send({ ...body }, attempt, vi.fn());
    expect(keys[1]).toBe(keys[0]);
  });
});

describe('an already-applied write the app cannot read back', () => {
  it('reads as "already went through", never as a retryable failure', () => {
    const failure = toApiFailure(new AlreadyAppliedError());
    expect(failure.code).toBe(REQUEST_ALREADY_APPLIED);
    expect(failure.message).toContain('already went through');
  });
});
