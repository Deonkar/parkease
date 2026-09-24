import {
  MAX_SERVICE_DURATION_MINUTES,
  MIN_SERVICE_DURATION_MINUTES,
  type UpsertWashService,
} from '@parkease/contracts/washer';
import { act, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { byTestId, mount, text } from '../../shared/__tests__/render-native';
import { ServiceRow } from '../components/ServiceRow';
import type { MenuRow } from '../menu-rows';

// react-native ships Flow source the node-environment parser cannot read.
const announced = vi.hoisted(() => vi.fn());

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: announced },
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

interface HostProps {
  readonly initial: MenuRow;
  readonly initialSaving: boolean;
  readonly failure: string | null;
  readonly onSave: (input: UpsertWashService) => void;
}

/** What the screen would change underneath the row: its server values, and whether it saves. */
let server: {
  readonly setRow: (next: MenuRow) => void;
  readonly setSaving: (next: boolean) => void;
};

/**
 * Stands in for the screen: one `ServiceRow` element that is re-rendered, never
 * remounted, when its props change — which is what the screen's `rowKey` does
 * for a change of `isActive` alone.
 */
function Host({ initial, initialSaving, failure, onSave }: HostProps) {
  const [current, setRow] = useState(initial);
  const [saving, setSaving] = useState(initialSaving);
  server = { setRow, setSaving };
  return <ServiceRow row={current} saving={saving} failure={failure} onSave={onSave} />;
}

interface SetupOptions {
  readonly row?: MenuRow;
  readonly saving?: boolean;
  readonly failure?: string | null;
}

/** Mounts a row and returns what it saved, plus the ways a partner touches it. */
function setup({ row: initial = row(), saving = false, failure = null }: SetupOptions = {}) {
  const saved: unknown[] = [];
  const view = mount(
    <Host
      initial={initial}
      initialSaving={saving}
      failure={failure}
      onSave={(input) => {
        saved.push(input);
      }}
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
  const rerender = (change: () => void) => {
    act(change);
  };
  return {
    saved,
    node,
    type,
    blur,
    press,
    toggle,
    rerender,
    readable: () => text(view.tree()),
  };
}

const TOO_LONG = String(MAX_SERVICE_DURATION_MINUTES + 1);
const DURATION_BOUNDS = `between ${String(MIN_SERVICE_DURATION_MINUTES)} and ${String(MAX_SERVICE_DURATION_MINUTES)}`;

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

  it('does not count a retyped equal value as a change (T8-M3)', () => {
    const { node, type } = setup();

    type('price-car-premium_wash', '399.00');
    type('duration-premium_wash', '040');

    expect(node('save-premium_wash')?.props['disabled']).toBe(true);
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

    // "9" on the way to "99": wrong only if the partner stops here.
    type('price-car-premium_wash', '9');
    expect(readable()).not.toContain('Enter a price');

    blur('price-car-premium_wash');
    expect(node('price-car-error-premium_wash')).toBeDefined();
  });

  it('takes "10." as ten rupees on blur rather than calling it out of range (T8-M2)', () => {
    const { saved, node, type, blur, press } = setup();

    type('price-car-premium_wash', '10.');
    blur('price-car-premium_wash');
    press('save-premium_wash');

    expect(node('price-car-error-premium_wash')).toBeUndefined();
    expect(saved).toEqual([
      { carPricePaise: 1000, bikePricePaise: 14900, durationMinutes: 40, isActive: true },
    ]);
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

    type('duration-premium_wash', TOO_LONG);
    press('save-premium_wash');

    expect(saved).toEqual([]);
    expect(text(node('duration-error-premium_wash') ?? null)).toContain(DURATION_BOUNDS);
  });
});

describe('the Active switch (T8-I1)', () => {
  it('switching off saves the SAME prices with isActive false, never deleting them', () => {
    const { saved, toggle } = setup();

    toggle('active-premium_wash', false);

    expect(saved).toEqual([
      { carPricePaise: 39900, bikePricePaise: 14900, durationMinutes: 40, isActive: false },
    ]);
  });

  it('sends the SERVER prices, never an unsaved draft', () => {
    // A mistyped ₹4,490 that was never saved must not go live with a flip.
    const { saved, type, toggle } = setup({ row: row({ isActive: false }) });

    type('price-car-premium_wash', '4490');
    type('duration-premium_wash', '90');
    toggle('active-premium_wash', true);

    expect(saved).toEqual([
      { carPricePaise: 39900, bikePricePaise: 14900, durationMinutes: 40, isActive: true },
    ]);
  });

  it('switches OFF even while a draft is invalid, and does not flag the draft', () => {
    const { saved, node, type, toggle } = setup();

    type('price-car-premium_wash', '9');
    toggle('active-premium_wash', false);

    expect(saved).toEqual([
      { carPricePaise: 39900, bikePricePaise: 14900, durationMinutes: 40, isActive: false },
    ]);
    expect(node('price-car-error-premium_wash')).toBeUndefined();
  });

  it('keeps the partner’s unsaved drafts through a successful toggle', () => {
    const { node, type, toggle, rerender } = setup();

    type('price-car-premium_wash', '449');
    toggle('active-premium_wash', false);
    rerender(() => {
      server.setRow(row({ isActive: false }));
    });

    expect(node('price-car-premium_wash')?.props['value']).toBe('449');
    expect(node('save-premium_wash')?.props['disabled']).toBe(false);
  });

  it('shows the value it is saving while that save is in flight (T8-M6)', () => {
    const { node, toggle, rerender, readable } = setup();

    toggle('active-premium_wash', false);
    rerender(() => {
      server.setSaving(true);
    });

    expect(node('active-premium_wash')?.props['value']).toBe(false);
    expect(readable()).toContain('Saving…');

    // The save failed: the row is still offered, and the switch says so again.
    rerender(() => {
      server.setSaving(false);
    });
    expect(node('active-premium_wash')?.props['value']).toBe(true);
  });

  it('says its state in words, not only in the track colour', () => {
    const { node, readable } = setup({ row: row({ isActive: false }) });
    const toggleNode = node('active-premium_wash');

    expect(toggleNode?.props['accessibilityRole']).toBe('switch');
    expect(toggleNode?.props['accessibilityState']).toMatchObject({ checked: false });
    expect(readable()).toContain('Not offered');
  });

  it('keeps one fixed label, so TalkBack does not say the value twice (H8)', () => {
    const off = setup({ row: row({ isActive: false }) }).node('active-premium_wash');
    const on = setup({ row: row({ isActive: true }) }).node('active-premium_wash');

    expect(off?.props['accessibilityLabel']).toBe(on?.props['accessibilityLabel']);
    expect(String(on?.props['accessibilityLabel'])).not.toMatch(/offered/i);
  });

  it('says why it cannot send a stored price the contract no longer accepts', () => {
    // The read schema is looser than the write schema, so a stored ₹5 can
    // reach the screen. The switch cannot send it; it must not just do nothing.
    const { saved, toggle, readable } = setup({ row: row({ carPricePaise: 500 }) });

    toggle('active-premium_wash', false);

    expect(saved).toEqual([]);
    expect(readable()).toContain('between ₹10 and ₹9,999');
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

  it('holds the switch until it has been priced and saved, and says so in words', () => {
    const { node, readable } = setup({ row: unpriced });

    expect(node('active-premium_wash')?.props['disabled']).toBe(true);
    expect(node('active-premium_wash')?.props['accessibilityHint']).toMatch(/save/i);
    expect(readable()).toMatch(/save them to switch it on/i);
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

/** H4 and H6: what a save says, and what it keeps. */
describe('after a save', () => {
  it('announces "Saved" when a save lands, and shows it on the button', () => {
    const { rerender, readable } = setup();
    announced.mockClear();

    rerender(() => {
      server.setSaving(true);
    });
    rerender(() => {
      server.setSaving(false);
    });

    expect(announced).toHaveBeenCalledWith('Saved');
    expect(readable()).toContain('Saved');
  });

  it('announces a failure when it appears', () => {
    announced.mockClear();
    setup({ failure: "Couldn't save. Check your connection and try again." });

    expect(announced).toHaveBeenCalledWith("Couldn't save. Check your connection and try again.");
  });

  it('shows the server s new prices without being remounted, so focus is not lost', () => {
    const { node, type, rerender } = setup();
    type('price-car-premium_wash', '449');

    rerender(() => {
      server.setRow(row({ carPricePaise: 44900 }));
    });

    expect(node('price-car-premium_wash')?.props['value']).toBe('449');
    rerender(() => {
      server.setRow(row({ carPricePaise: 45000 }));
    });
    expect(node('price-car-premium_wash')?.props['value']).toBe('450');
  });

  it('announces a price error when it appears under the field', () => {
    const { type, blur } = setup();
    announced.mockClear();

    type('price-car-premium_wash', '1');
    blur('price-car-premium_wash');

    expect(announced).toHaveBeenCalledWith(expect.stringMatching(/Enter a price between/));
  });
});
