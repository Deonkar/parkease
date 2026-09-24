import { EmptyState } from '@parkease/ui-native/EmptyState';
import { ErrorState } from '@parkease/ui-native/ErrorState';
import { describe, expect, it, vi } from 'vitest';

import { nodes, render, style } from './render-native';

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

/**
 * M1 (walkthrough V1, impeccable `text-occlusion`): at a short height the
 * centred empty state spilled over its siblings. It covered the online rail on
 * Offers, and on Active it covered the header and put "Go to offers" under the
 * tab bar. The shared root is centred when there is room and scrolls when there
 * is not, for every role that uses it.
 */
describe.each([
  [
    'EmptyState',
    () =>
      render(
        <EmptyState title="No jobs" body="Body" actionLabel="Go" onAction={() => undefined} />,
      ),
  ],
  [
    'ErrorState',
    () => render(<ErrorState title="Couldn't load" body="Body" onAction={() => undefined} />),
  ],
])('%s at a short height', (_name, draw) => {
  it('is a scroll view, so it can never draw over what is above or below it', () => {
    const root = draw();

    expect(root?.type).toBe('ScrollView');
  });

  it('centres its content when there is room, and grows past the viewport when not', () => {
    const root = draw();
    const content = style({
      ...root,
      props: { style: root?.props['contentContainerStyle'] as unknown },
    } as NonNullable<typeof root>);

    expect(content['flexGrow']).toBe(1);
    expect(content['justifyContent']).toBe('center');
    // `flex: 1` would pin the content to the viewport height and clip it again.
    expect(content['flex']).toBeUndefined();
  });

  it('fills a bounded parent, shrinks to it, and never collapses inside another scroll', () => {
    const root = draw();
    const own = style(root as NonNullable<typeof root>);

    expect(own['flexGrow']).toBe(1);
    expect(own['flexShrink']).toBe(1);
    expect(own['flex']).toBeUndefined();
  });

  it('keeps a tap on its action from only dismissing the keyboard', () => {
    expect(draw()?.props['keyboardShouldPersistTaps']).toBe('handled');
    expect(nodes(draw()).length).toBeGreaterThan(1);
  });
});
