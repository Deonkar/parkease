import type { DriverValetJob, DriverWashJob } from '@parkease/contracts/driver';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: 'Icon' }));
vi.mock('@parkease/ui-native', () => ({ ParkMap: 'ParkMap' }));

const jobs = vi.hoisted(() => ({
  valet: undefined as DriverValetJob | undefined,
  wash: undefined as DriverWashJob | undefined,
}));
vi.mock('../hooks/useAddons', () => ({
  useValetJob: (id: string | null) => ({
    data: id === null ? undefined : jobs.valet,
    isError: false,
  }),
  useWashJob: () => ({ data: jobs.wash, isError: false }),
}));

const { byTestId, mount, render, text } = await import('../../shared/__tests__/render-native');
const { AddonsCard } = await import('../components/AddonsCard');
const { ValetMap } = await import('../components/ValetMap');
const { WashEvidence } = await import('../components/WashEvidence');
const { WashServicePicker } = await import('../components/WashServicePicker');
const { valetJob, washJob } = await import('./addon-fixtures');

const noop = () => undefined;
const handlers = {
  onRequestValet: noop,
  onOpenValet: noop,
  onRequestWash: noop,
  onOpenWash: noop,
};

describe('AddonsCard', () => {
  beforeEach(() => {
    jobs.valet = undefined;
    jobs.wash = undefined;
  });

  it('offers a valet but not yet a wash on a confirmed booking, and says why', () => {
    const tree = render(
      <AddonsCard bookingStatus="confirmed" valetJobId={null} washJobIds={[]} {...handlers} />,
    );
    expect(byTestId(tree, 'booking-request-valet')).toBeDefined();
    expect(byTestId(tree, 'booking-add-wash')).toBeUndefined();
    expect(text(tree)).toContain('once your car is parked');
  });

  it('offers both on an active booking, and the request opens the flow', () => {
    const onRequestWash = vi.fn();
    const tree = render(
      <AddonsCard
        bookingStatus="active"
        valetJobId={null}
        washJobIds={[]}
        {...handlers}
        onRequestWash={onRequestWash}
      />,
    );
    expect(byTestId(tree, 'booking-request-valet')).toBeDefined();
    act(() => {
      (byTestId(tree, 'booking-add-wash')?.props['onPress'] as () => void)();
    });
    expect(onRequestWash).toHaveBeenCalled();
  });

  it('lists a live valet with its status and hides a second request', () => {
    jobs.valet = valetJob({ status: 'en_route' });
    const onOpenValet = vi.fn();
    const { tree } = mount(
      <AddonsCard
        bookingStatus="active"
        valetJobId={jobs.valet.id}
        washJobIds={[]}
        {...handlers}
        onOpenValet={onOpenValet}
      />,
    );
    expect(text(tree())).toContain('On the way');
    expect(byTestId(tree(), 'booking-request-valet')).toBeUndefined();
    act(() => {
      (byTestId(tree(), 'booking-valet-job')?.props['onPress'] as () => void)();
    });
    expect(onOpenValet).toHaveBeenCalledWith(jobs.valet.id);
  });

  it('allows a new valet once the last one is over', () => {
    jobs.valet = valetJob({ status: 'cancelled', cancellable: false });
    const tree = render(
      <AddonsCard
        bookingStatus="active"
        valetJobId={jobs.valet.id}
        washJobIds={[]}
        {...handlers}
      />,
    );
    expect(byTestId(tree, 'booking-request-valet')).toBeDefined();
  });

  it('names a requested wash by its service', () => {
    jobs.wash = washJob();
    const tree = render(
      <AddonsCard
        bookingStatus="active"
        valetJobId={null}
        washJobIds={[jobs.wash.id]}
        {...handlers}
      />,
    );
    expect(text(tree)).toContain('Premium Wash');
    expect(text(tree)).toContain('Washer assigned');
  });

  it('renders nothing on a finished booking with no add-ons', () => {
    expect(
      render(
        <AddonsCard bookingStatus="completed" valetJobId={null} washJobIds={[]} {...handlers} />,
      ),
    ).toBeNull();
  });
});

describe('ValetMap', () => {
  const at = 2_000_000;

  it('waits for a first fix rather than drawing an empty map', () => {
    const tree = render(<ValetMap fix={null} now={() => at} />);
    expect(byTestId(tree, 'valet-map-waiting')).toBeDefined();
  });

  it('draws the valet with no warning while the fix is fresh', () => {
    const tree = render(<ValetMap fix={{ lat: 1, lng: 2, at }} now={() => at + 10_000} />);
    expect(byTestId(tree, 'valet-map')).toBeDefined();
    expect(byTestId(tree, 'valet-fix-stale')).toBeUndefined();
  });

  it('says how old the fix is once it passes 30 seconds', () => {
    const tree = render(<ValetMap fix={{ lat: 1, lng: 2, at }} now={() => at + 45_000} />);
    expect(byTestId(tree, 'valet-fix-stale')).toBeDefined();
    expect(text(tree)).toContain('Last seen 45s ago');
  });
});

describe('WashEvidence', () => {
  it('says which photos are on record', () => {
    const tree = render(<WashEvidence beforePhotoId="p1" afterPhotoId={null} />);
    expect(text(byTestId(tree, 'wash-photo-before') ?? null)).toContain('on record');
    expect(text(byTestId(tree, 'wash-photo-after') ?? null)).toContain('not yet taken');
  });

  it('is absent before any photo exists', () => {
    expect(render(<WashEvidence beforePhotoId={null} afterPhotoId={null} />)).toBeNull();
  });
});

describe('WashServicePicker', () => {
  it('lists the closed catalogue and reports the pick', () => {
    const onSelect = vi.fn();
    const tree = render(<WashServicePicker selected="quick_wipe" onSelect={onSelect} />);
    expect(byTestId(tree, 'wash-service-quick_wipe')?.props['accessibilityState']).toEqual({
      checked: true,
    });
    act(() => {
      (byTestId(tree, 'wash-service-full_detailing')?.props['onPress'] as () => void)();
    });
    expect(onSelect).toHaveBeenCalledWith('full_detailing');
  });
});
