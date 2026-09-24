import { fontSize, fontWeight, layout, touchTarget } from '@parkease/tokens';
import { describe, expect, it, vi } from 'vitest';

import { byTestId, nodes, render, style, text } from '../../shared/__tests__/render-native';
import { AccountButton } from '../components/AccountButton';
import { ReadableColumn } from '../components/ReadableColumn';
import { WasherHeader } from '../components/WasherHeader';

const push = vi.hoisted(() => vi.fn());

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'MaterialCommunityIcons' }));
vi.mock('expo-router', () => ({ router: { push } }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }),
}));

/** M7: one header scale on every washer screen, Profile included. */
describe('the washer header', () => {
  it('draws every title at one scale, as a header', () => {
    const title = nodes(render(<WasherHeader title="Offers" />)).find(
      (node) => node.props['accessibilityRole'] === 'header',
    );

    expect(title && text(title)).toBe('Offers');
    expect(title && style(title)['fontSize']).toBe(fontSize.lg);
    expect(title && style(title)['fontWeight']).toBe(fontWeight.bold);
  });

  it('carries the account button unless the screen IS the account', () => {
    expect(byTestId(render(<WasherHeader title="Offers" />), 'profile-gear')).toBeDefined();
    expect(
      byTestId(render(<WasherHeader title="Profile" account={false} />), 'profile-gear'),
    ).toBeUndefined();
  });

  it('shows a subtitle under the title when given one', () => {
    expect(text(render(<WasherHeader title="Active" subtitle="Premium Wash · car" />))).toContain(
      'Premium Wash · car',
    );
  });

  it('keeps its content in the readable column (M6)', () => {
    const inner = byTestId(render(<WasherHeader title="Menu" />), 'washer-header-content');

    expect(inner && style(inner)['maxWidth']).toBe(layout.contentMaxWidth);
  });
});

/**
 * M13: the header control opens the partner's Profile, not Settings, so it is an
 * account icon, not a gear. Its testID stays, because the walkthrough and the
 * Maestro flows select by it.
 */
describe('the account button', () => {
  it('is an account icon at the 48dp target, and opens the profile', () => {
    const tree = render(<AccountButton />);
    const button = byTestId(tree, 'profile-gear');
    const icon = nodes(tree).find((node) => node.type === 'MaterialCommunityIcons');

    expect(icon?.props['name']).toBe('account-circle-outline');
    expect(button?.props['accessibilityLabel']).toBe('Your profile');
    expect(button && style(button)['width']).toBe(touchTarget);
    expect(button && style(button)['height']).toBe(touchTarget);

    (button?.props['onPress'] as () => void)();
    expect(push).toHaveBeenCalledWith('/(washer)/profile');
  });
});

/** M6 (walkthrough V5): at 1280px a job row's label and amount sat ~1200px apart. */
describe('the readable column', () => {
  it('centres content at the token width, and fills a phone', () => {
    const column = render(<ReadableColumn>{null}</ReadableColumn>);
    const own = column ? style(column) : {};

    expect(own['maxWidth']).toBe(layout.contentMaxWidth);
    expect(own['width']).toBe('100%');
    expect(own['alignSelf']).toBe('center');
  });
});
