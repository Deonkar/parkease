import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: 'MaterialCommunityIcons' }));

const PLACE = {
  id: 'p1',
  title: '1st Block Koramangala',
  subtitle: 'Bengaluru',
  lat: 12.93,
  lng: 77.63,
};
vi.mock('@/features/shared/hooks/usePlaceSearch', () => ({
  usePlaceSearch: () => ({ data: [PLACE], isFetching: false, isError: false, error: null }),
}));

const { mount, nodes } = await import('../../shared/__tests__/render-native');
const { PlaceSearchBar } = await import('../components/PlaceSearchBar');

// S-136: on web the input blurs on mousedown and unmounts the list, so selection must
// happen on an undelayed press-in, before that blur lands.
describe('PlaceSearchBar suggestions', () => {
  it('select on an undelayed press-in, so a blur cannot swallow the choice', () => {
    const onSelect = vi.fn();
    const ui = mount(<PlaceSearchBar selectedLabel={null} onSelect={onSelect} onClear={vi.fn()} />);

    const input = () => nodes(ui.tree()).find((n) => n.type === 'TextInput');
    act(() => {
      (input()?.props['onFocus'] as () => void)();
    });
    act(() => {
      (input()?.props['onChangeText'] as (t: string) => void)('Koramangala');
    });

    const suggestion = nodes(ui.tree()).find(
      (n) =>
        n.type === 'Pressable' && String(n.props['accessibilityLabel']).startsWith(PLACE.title),
    );
    expect(suggestion?.props['delayPressIn']).toBe(0);
    expect(suggestion?.props['onPress']).toBeUndefined();

    act(() => {
      (suggestion?.props['onPressIn'] as () => void)();
    });
    expect(onSelect).toHaveBeenCalledWith(PLACE);
  });
});
