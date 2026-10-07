import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'MaterialCommunityIcons' }));
vi.mock('@parkease/ui-native', () => ({ Button: 'Button', OtpInput: 'OtpInput' }));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('@/lib/firebase', () => ({ requestOtp: vi.fn(), confirmOtp: vi.fn() }));

const { mount, nodes, text } = await import('../../__tests__/render-native');
type Tree = Parameters<typeof nodes>[0];
const byType = (tree: Tree, type: string) => nodes(tree).filter((n) => n.type === type);
const { isReauthRequired, maskPhone } = await import('../reauth');
const { ReauthStep } = await import('../ReauthStep');

/** Lets the step's promises settle inside act, so the next tree shows their outcome. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const deps = (over: Partial<Parameters<typeof ReauthStep>[0]['deps']> = {}) => ({
  ownPhone: vi.fn().mockResolvedValue('+919876543210'),
  sendCode: vi.fn().mockResolvedValue(undefined),
  confirmCode: vi.fn().mockResolvedValue('fresh-id-token'),
  ...over,
});

describe('maskPhone', () => {
  it('keeps enough to recognise and no more', () => {
    expect(maskPhone('+919876543210')).toBe('+91 ••••• 43210');
    expect(maskPhone('12')).toBe('•••••');
  });
});

describe('isReauthRequired', () => {
  it('matches only the server step-up refusal', () => {
    const refusal = {
      isAxiosError: true,
      response: { status: 403, data: { error: { code: 'REAUTH_REQUIRED', message: 'x' } } },
    };
    const forbidden = {
      isAxiosError: true,
      response: { status: 403, data: { error: { code: 'FORBIDDEN', message: 'x' } } },
    };
    expect(isReauthRequired(refusal)).toBe(true);
    expect(isReauthRequired(forbidden)).toBe(false);
  });
});

describe('ReauthStep (S-100)', () => {
  it('sends a code to the account phone, then hands back the token the code proves', async () => {
    const d = deps();
    const onToken = vi.fn();
    const view = mount(<ReauthStep onToken={onToken} deps={d} />);
    await settle();
    expect(text(view.tree())).toContain('+91 ••••• 43210');

    const [send] = byType(view.tree(), 'Button');
    act(() => {
      (send?.props['onPress'] as () => void)();
    });
    await settle();
    expect(d.sendCode).toHaveBeenCalledWith('+919876543210');

    const [otp] = byType(view.tree(), 'OtpInput');
    act(() => {
      (otp?.props['onComplete'] as (code: string) => void)('123456');
    });
    await settle();

    expect(d.confirmCode).toHaveBeenCalledWith('123456');
    expect(onToken).toHaveBeenCalledWith('fresh-id-token');
  });

  it('stays on the code and says so when the code is wrong', async () => {
    const d = deps({ confirmCode: vi.fn().mockRejectedValue(new Error('bad code')) });
    const onToken = vi.fn();
    const view = mount(<ReauthStep onToken={onToken} deps={d} />);
    await settle();
    act(() => {
      (byType(view.tree(), 'Button')[0]?.props['onPress'] as () => void)();
    });
    await settle();

    act(() => {
      (byType(view.tree(), 'OtpInput')[0]?.props['onComplete'] as (c: string) => void)('000000');
    });
    await settle();

    expect(onToken).not.toHaveBeenCalled();
    expect(text(view.tree())).toContain("That code didn't work");
    expect(byType(view.tree(), 'OtpInput')).toHaveLength(1);
  });

  it('shows why it is asking again when the server refused a token', async () => {
    const view = mount(
      <ReauthStep onToken={vi.fn()} deps={deps()} notice="That confirmation expired." />,
    );
    await settle();

    expect(text(view.tree())).toContain('That confirmation expired.');
  });
});
