import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { byTestId, mount, text } from '../../shared/__tests__/render-native';
import { ServiceRow, type ServiceRowProps } from '../components/ServiceRow';
import type { MenuRow } from '../menu-rows';

// react-native ships Flow source the node-environment parser cannot read.
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  Switch: 'Switch',
  Pressable: 'Pressable',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

vi.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: 'MaterialCommunityIcons',
}));

const row = (overrides: Partial<MenuRow> = {}): MenuRow => ({
  serviceName: 'premium_wash',
  carPricePaise: 39900,
  bikePricePaise: 14900,
  durationMinutes: 40,
  isActive: true,
  ...overrides,
});

/** Mounts a row and returns what it saved, plus the ways a partner touches it. */
function setup(props: Partial<ServiceRowProps> = {}) {
  const saved: unknown[] = [];
  const view = mount(
    <ServiceRow
      row={row()}
      onSave={(input) => {
        saved.push(input);
      }}
      {...props}
    />,
  );
  // Always the CURRENT tree: a stale snapshot's handlers hold stale text.
  const node = (id: string) => byTestId(view.tree(), id);
  // Throws rather than optional-chaining: a renamed testID must fail the test,
  // not turn every interaction into a silent no-op.
  const handler = (id: string, prop: string) => {
    const found: unknown = node(id)?.props[prop];
    if (typeof found !== 'function') throw new Error(`no ${prop} on ${id}`);
    return found as (...args: unknown[]) => void;
  };
  const type = (id: string, value: string) => {
    act(() => {
      handler(id, 'onChangeText')(value);
    });
  };
  const blur = (id: string) => {
    act(() => {
      handler(id, 'onBlur')();
    });
  };
  const press = (id: string) => {
    act(() => {
      handler(id, 'onPress')();
    });
  };
  const toggle = (id: string, next: boolean) => {
    act(() => {
      handler(id, 'onValueChange')(next);
    });
  };
  return { saved, node, type, blur, press, toggle, readable: () => text(view.tree()) };
}

describe('saving a service', () => {
  it('sends both prices in one save, as paise', () => {
    const { saved, type, press } = setup();

    type('price-car-premium_wash', '449');
    type('price-bike-premium_wash', '179');
    press('save-premium_wash');

    expect(saved).toEqual([
      { carPricePaise: 44900, bikePricePaise: 17900, durationMinutes: 40, isActive: true },
    ]);
  });

  it('sends a changed duration in minutes beside the prices it did not touch', () => {
    const { saved, type, press } = setup();

    type('duration-premium_wash', '55');
    press('save-premium_wash');

    expect(saved).toEqual([
      { carPricePaise: 39900, bikePricePaise: 14900, durationMinutes: 55, isActive: true },
    ]);
  });

  it('keeps Save disabled until something changed', () => {
    const { node, type } = setup();

    expect(node('save-premium_wash')?.props['disabled']).toBe(true);
    type('price-car-premium_wash', '449');
    expect(node('save-premium_wash')?.props['disabled']).toBe(false);
  });
});

describe('a price the contract would refuse', () => {
  it('refuses to save a price under the contract minimum, and says why on the field', () => {
    const { saved, node, type, press } = setup();

    type('price-car-premium_wash', '9');
    press('save-premium_wash');

    expect(saved).toEqual([]);
    // Under the CAR slot — the one that is wrong — and not under the bike's.
    expect(text(node('price-car-error-premium_wash') ?? null)).toContain('between ₹10 and ₹9,999');
    expect(node('price-bike-error-premium_wash')).toBeUndefined();
  });

  it('refuses a price over the maximum the same way', () => {
    const { saved, node, type, press } = setup();

    type('price-bike-premium_wash', '10000');
    press('save-premium_wash');

    expect(saved).toEqual([]);
    expect(text(node('price-bike-error-premium_wash') ?? null)).toContain('₹9,999');
  });

  it('says nothing while the partner is still typing, and speaks on blur', () => {
    const { node, type, blur, readable } = setup();

    type('price-car-premium_wash', '10.');
    expect(readable()).not.toContain('Enter a price');

    blur('price-car-premium_wash');
    expect(node('price-car-error-premium_wash')).toBeDefined();
  });

  it('drops a shown error once the partner starts correcting the field', () => {
    const { node, type, press } = setup();

    type('price-car-premium_wash', '9');
    press('save-premium_wash');
    type('price-car-premium_wash', '1');

    expect(node('price-car-error-premium_wash')).toBeUndefined();
  });

  it('refuses a duration outside the contract bounds, under the duration field', () => {
    const { saved, node, type, press } = setup();

    type('duration-premium_wash', '481');
    press('save-premium_wash');

    expect(saved).toEqual([]);
    expect(text(node('duration-error-premium_wash') ?? null)).toContain('between 5 and 480');
  });
});

describe('the Active switch', () => {
  it('switching off saves the SAME prices with isActive false, never deleting them', () => {
    const { saved, toggle } = setup();

    toggle('active-premium_wash', false);

    expect(saved).toEqual([
      { carPricePaise: 39900, bikePricePaise: 14900, durationMinutes: 40, isActive: false },
    ]);
  });

  it('says its state in words, not only in the track colour', () => {
    const { node } = setup({ row: row({ isActive: false }) });
    const toggleNode = node('active-premium_wash');

    expect(toggleNode?.props['accessibilityRole']).toBe('switch');
    expect(toggleNode?.props['accessibilityLabel']).toMatch(/not offered/i);
  });
});

describe('a service this partner has never priced', () => {
  const unpriced = row({ carPricePaise: null, bikePricePaise: null, isActive: false });

  it('renders empty price slots and says what pricing them does', () => {
    const { node, readable } = setup({ row: unpriced });

    expect(node('price-car-premium_wash')?.props['value']).toBe('');
    expect(node('price-bike-premium_wash')?.props['value']).toBe('');
    expect(readable()).toContain('Set your prices to offer this service');
  });

  it('can be priced for the first time, and pricing it offers it', () => {
    const { saved, type, press } = setup({ row: unpriced });

    type('price-car-premium_wash', '449');
    type('price-bike-premium_wash', '179');
    press('save-premium_wash');

    expect(saved).toEqual([
      { carPricePaise: 44900, bikePricePaise: 17900, durationMinutes: 40, isActive: true },
    ]);
  });

  it('needs both prices, because the contract takes both', () => {
    const { saved, node, type, press } = setup({ row: unpriced });

    type('price-car-premium_wash', '449');
    press('save-premium_wash');

    expect(saved).toEqual([]);
    expect(node('price-bike-error-premium_wash')).toBeDefined();
  });
});

describe('while a save is in flight, and after one fails', () => {
  it('holds Save and the switch while saving', () => {
    const { node } = setup({ saving: true });

    expect(node('save-premium_wash')?.props['disabled']).toBe(true);
    expect(node('active-premium_wash')?.props['disabled']).toBe(true);
  });

  it('shows the failure under the row, not in an alert', () => {
    const { node } = setup({ failure: "Couldn't save. Check your connection and try again." });

    expect(text(node('save-error-premium_wash') ?? null)).toContain("Couldn't save");
  });
});
