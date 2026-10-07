import type { NotificationView } from '@parkease/contracts/shared';
import { colors } from '@parkease/tokens';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationBadge } from '../notifications/NotificationBadge';
import { NotificationItem } from '../notifications/NotificationItem';

import { byTestId, render, type RenderedNode, style, text } from './render-native';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: 'Icon' }));
vi.mock('../notifications/hooks', () => ({ useUnreadCount: () => ({ data: 0 }) }));

const NOW = new Date('2026-10-07T12:30:00Z');
const base: NotificationView = {
  id: '0192f1c0-0000-7000-8000-000000000001' as NotificationView['id'],
  category: 'bookings',
  actionable: false,
  title: 'Booking confirmed',
  body: 'Your spot is reserved.',
  deepLink: '/(driver)/bookings',
  isRead: false,
  createdAt: '2026-10-07T12:15:00Z',
};

const renderItem = (item: NotificationView, onPress = vi.fn()) =>
  render(<NotificationItem item={item} now={NOW} onPress={onPress} />);

describe('NotificationItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders something non-empty (the act-environment guard)', () => {
    expect(text(renderItem(base))).toContain('Booking confirmed');
  });

  it('an unread card is tinted and says Unread to a screen reader', () => {
    const tree = renderItem(base);
    const card = byTestId(tree, `notification-${base.id}`);
    expect(card?.props['accessibilityLabel']).toMatch(/^Unread\. Booking confirmed/);
    expect(style(card as RenderedNode)['backgroundColor']).toBe(colors.infoLight);
  });

  it('a read card is plain and does not say Unread', () => {
    const tree = renderItem({ ...base, isRead: true });
    const card = byTestId(tree, `notification-${base.id}`);
    expect(card?.props['accessibilityLabel']).not.toMatch(/Unread/);
    expect(style(card as RenderedNode)['backgroundColor']).toBe(colors.surface);
  });

  it('shows the relative time and the body', () => {
    const out = text(renderItem(base));
    expect(out).toContain('15 min ago');
    expect(out).toContain('Your spot is reserved.');
  });

  it('calls back with the item when pressed', () => {
    const onPress = vi.fn();
    const card = byTestId(renderItem(base, onPress), `notification-${base.id}`);
    (card?.props['onPress'] as () => void)();
    expect(onPress).toHaveBeenCalledWith(base);
  });
});

describe('NotificationBadge', () => {
  it('renders nothing at zero', () => {
    expect(render(<NotificationBadge count={0} />)).toBeNull();
  });

  it('shows the count, capped at 99+', () => {
    expect(text(render(<NotificationBadge count={7} />))).toBe('7');
    expect(text(render(<NotificationBadge count={250} />))).toBe('99+');
  });

  it('announces the real number, not the capped one', () => {
    const tree = render(<NotificationBadge count={250} />);
    expect(byTestId(tree, 'notification-badge')?.props['accessibilityLabel']).toBe('250 unread');
  });
});
