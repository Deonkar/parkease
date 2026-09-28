import type { OwnerDashboard } from '@parkease/contracts/owner';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'MaterialCommunityIcons' }));

const { render, text } = await import('../../shared/__tests__/render-native');
const { SpaceRow } = await import('../components/SpaceRow');

type Space = OwnerDashboard['spaces'][number];

const space = (approvalStatus: Space['approvalStatus']): Space =>
  ({
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Basement Slot 4',
    occupancyBp: 5000,
    approvalStatus,
  }) as Space;

describe('SpaceRow (V1: a space names its real approval status)', () => {
  it('does not label a pending-approval space "Paused" (fix wave 5, V1)', () => {
    const tree = render(<SpaceRow space={space('pending_approval')} />);
    const rendered = text(tree);
    expect(rendered).not.toContain('Paused');
    expect(rendered).toContain('Pending Approval');
  });

  it('does not label a changes-requested space "Paused"', () => {
    const tree = render(<SpaceRow space={space('changes_requested')} />);
    const rendered = text(tree);
    expect(rendered).not.toContain('Paused');
    expect(rendered).toContain('Changes Requested');
  });

  it('does not label a rejected space "Paused"', () => {
    const tree = render(<SpaceRow space={space('rejected')} />);
    const rendered = text(tree);
    expect(rendered).not.toContain('Paused');
    expect(rendered).toContain('Not Approved');
  });

  it('still shows Live for an active space', () => {
    const tree = render(<SpaceRow space={space('active')} />);
    expect(text(tree)).toContain('Live');
  });

  it('still shows the paused copy for an inactive space', () => {
    const tree = render(<SpaceRow space={space('inactive')} />);
    expect(text(tree)).toContain('Paused · not in search');
  });
});
