import { colors, duration, easing } from '@parkease/tokens';
import { describe, expect, it, vi } from 'vitest';

import {
  byTestId,
  nodes,
  render,
  style,
  text,
  type RenderedNode,
} from '../../shared/__tests__/render-native';
import {
  EvidencePair,
  type EvidencePairProps,
  type EvidenceSlotView,
} from '../components/EvidencePair';

// react-native ships Flow source the node-environment parser cannot read.
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

vi.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: 'MaterialCommunityIcons',
}));

// The slot fill's motion is recorded, so the test can prove it came from the
// tokens rather than from a number somebody typed.
const motion = vi.hoisted(() => ({ durations: [] as number[], curves: [] as unknown[] }));

vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView' },
  useReducedMotion: () => false,
  Easing: { bezier: (...points: number[]) => points },
  FadeIn: {
    duration: (ms: number) => {
      motion.durations.push(ms);
      return {
        easing: (curve: unknown) => {
          motion.curves.push(curve);
          return { ms, curve };
        },
      };
    },
  },
}));

const slot = (overrides: Partial<EvidenceSlotView> = {}): EvidenceSlotView => ({
  state: 'empty',
  uri: null,
  writable: true,
  ...overrides,
});

const pair = (props: Partial<EvidencePairProps> = {}) =>
  render(
    <EvidencePair
      before={slot()}
      after={slot({ writable: false })}
      onCapture={() => undefined}
      onRetry={() => undefined}
      {...props}
    />,
  );

const imageSources = (tree: RenderedNode | null) =>
  nodes(tree)
    .filter((node) => node.type === 'Image')
    .map((node) => (node.props['source'] as { uri: string }).uri);

const buttons = (tree: RenderedNode | null) =>
  nodes(tree).filter((node) => node.props['accessibilityRole'] === 'button');

const press = (node: RenderedNode | undefined) => {
  (node?.props['onPress'] as () => void)();
};

describe('the pair names every state in TEXT, never colour alone (R-FE-12)', () => {
  it('reads Before done and After still needed', () => {
    const all = text(pair({ before: slot({ state: 'attached', uri: 'file:///a.jpg' }) }));

    expect(all).toContain('Before');
    expect(all).toContain('After');
    expect(all).toMatch(/done/i);
    expect(all).toMatch(/needed/i);
  });

  it('says which half is owed: needed to start, needed to finish', () => {
    const all = text(pair());

    expect(all).toContain('Needed to start');
    expect(all).toContain('Needed to finish');
  });

  it('says Uploading… over the local image, not a bare spinner', () => {
    const tree = pair({ before: slot({ state: 'uploading', uri: 'file:///a.jpg' }) });

    expect(text(tree)).toContain('Uploading…');
    expect(imageSources(tree)).toContain('file:///a.jpg');
  });
});

describe('a failed upload', () => {
  const failed = () =>
    pair({ before: slot({ state: 'failed', uri: 'file:///a.jpg' }), onRetry: vi.fn() });

  it('keeps the captured image on screen', () => {
    const tree = failed();

    expect(text(tree)).toContain("Couldn't upload the photo. Check your connection.");
    expect(imageSources(tree)).toContain('file:///a.jpg');
  });

  it('dims the held image so it cannot be mistaken for a sent one', () => {
    const image = nodes(failed()).find((node) => node.type === 'Image');

    expect(image && Number(style(image)['opacity'])).toBeLessThan(1);
  });

  it('offers Retry, which retries THIS slot', () => {
    const onRetry = vi.fn();
    const tree = pair({ before: slot({ state: 'failed', uri: 'file:///a.jpg' }), onRetry });

    press(byTestId(tree, 'evidence-before-retry'));

    expect(onRetry).toHaveBeenCalledWith('before');
  });
});

describe('an attached slot', () => {
  it('shows the local image when this session took it', () => {
    const tree = pair({ before: slot({ state: 'attached', uri: 'file:///a.jpg' }) });

    expect(imageSources(tree)).toEqual(['file:///a.jpg']);
    expect(text(tree)).toContain('Before · done');
  });

  it('says it is attached, with no image, after a restart (T7-T1)', () => {
    // The app has an upload id and no way to build a URL from it; an attached
    // slot must still read as done rather than falling back to "needed".
    const tree = pair({ before: slot({ state: 'attached', uri: null }) });

    expect(imageSources(tree)).toEqual([]);
    expect(text(tree)).toContain('Photo attached');
    expect(text(tree)).not.toContain('Needed to start');
  });

  it('offers Retake only while the slot is still writable', () => {
    const open = pair({ before: slot({ state: 'attached', uri: null, writable: true }) });
    const closed = pair({ before: slot({ state: 'attached', uri: null, writable: false }) });

    expect(text(open)).toContain('Retake');
    expect(byTestId(closed, 'evidence-before-capture')).toBeUndefined();
    expect(text(closed)).not.toContain('Retake');
  });

  it('retakes through a fresh capture of the same slot', () => {
    const onCapture = vi.fn();
    const tree = pair({ before: slot({ state: 'attached', uri: null }), onCapture });

    press(byTestId(tree, 'evidence-before-capture'));

    expect(onCapture).toHaveBeenCalledWith('before');
  });

  it('fills with the tokens motion — duration.base, easing.decelerate', () => {
    motion.durations.length = 0;
    motion.curves.length = 0;

    pair({ before: slot({ state: 'attached', uri: 'file:///a.jpg' }) });

    expect(motion.durations).toContain(duration.base);
    expect(motion.curves).toContainEqual([...easing.decelerate]);
  });
});

describe('an empty slot', () => {
  it('is a dashed frame in the strong border colour', () => {
    const frame = byTestId(pair(), 'evidence-before-frame');

    expect(frame && style(frame)['borderStyle']).toBe('dashed');
    expect(frame && style(frame)['borderColor']).toBe(colors.borderStrong);
  });

  it('opens the camera for its own slot', () => {
    const onCapture = vi.fn();

    press(byTestId(pair({ onCapture }), 'evidence-before-capture'));

    expect(onCapture).toHaveBeenCalledWith('before');
  });

  it('offers no camera while the server would refuse the photo', () => {
    // The after slot before washing starts: owed, but not yet takeable.
    expect(byTestId(pair(), 'evidence-after-capture')).toBeUndefined();
  });
});

describe('the pair as a layout', () => {
  it('gives both halves an equal share of the width', () => {
    const tree = pair();
    const before = byTestId(tree, 'evidence-before');
    const after = byTestId(tree, 'evidence-after');

    for (const half of [before, after]) {
      expect(half && style(half)['flexBasis']).toBe(0);
      expect(half && style(half)['flexGrow']).toBe(1);
    }
  });

  it('gives every button a 44dp target and a label naming its slot', () => {
    const tree = pair({
      before: slot({ state: 'failed', uri: 'file:///a.jpg' }),
      after: slot({ state: 'attached', uri: null, writable: true }),
    });
    const all = buttons(tree);

    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const button of all) {
      expect(Number(style(button)['minHeight'])).toBeGreaterThanOrEqual(44);
      expect(String(button.props['accessibilityLabel'])).toMatch(/before|after/i);
    }
  });
});
