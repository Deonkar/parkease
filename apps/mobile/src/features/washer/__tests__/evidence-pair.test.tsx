import { colors, duration, easing, opacity, touchTarget } from '@parkease/tokens';
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
const announced = vi.hoisted(() => vi.fn());

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: announced },
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
  error: null,
  retryable: true,
  notice: null,
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

    expect(image && style(image)['opacity']).toBe(opacity.dimmed);
  });

  it('offers Retry, which retries THIS slot', () => {
    const onRetry = vi.fn();
    const tree = pair({ before: slot({ state: 'failed', uri: 'file:///a.jpg' }), onRetry });

    press(byTestId(tree, 'evidence-before-retry'));

    expect(onRetry).toHaveBeenCalledWith('before');
  });
});

describe('a failed slot is never a dead end', () => {
  it('offers Retake beside Retry while the slot is writable', () => {
    const onCapture = vi.fn();
    const tree = pair({
      before: slot({ state: 'failed', uri: 'file:///a.jpg', writable: true }),
      onCapture,
    });

    expect(text(tree)).toContain('Retry');
    expect(text(tree)).toContain('Retake');
    press(byTestId(tree, 'evidence-before-capture'));
    expect(onCapture).toHaveBeenCalledWith('before');
  });

  it('offers Retry alone once the slot has closed', () => {
    const tree = pair({ before: slot({ state: 'failed', uri: 'file:///a.jpg', writable: false }) });

    expect(text(tree)).toContain('Retry');
    expect(text(tree)).not.toContain('Retake');
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
  it('names itself in partner words, not the design term', () => {
    const all = text(pair());

    expect(all).toContain('Before & after photos');
    expect(all).not.toMatch(/evidence/i);
  });

  it('gives both halves an equal share of the width', () => {
    const tree = pair();
    const before = byTestId(tree, 'evidence-before');
    const after = byTestId(tree, 'evidence-after');

    for (const half of [before, after]) {
      expect(half && style(half)['flexBasis']).toBe(0);
      expect(half && style(half)['flexGrow']).toBe(1);
    }
  });

  it('gives every button a 48dp target (M3) and a label naming its slot', () => {
    const tree = pair({
      before: slot({ state: 'failed', uri: 'file:///a.jpg' }),
      after: slot({ state: 'attached', uri: null, writable: true }),
    });
    const all = buttons(tree);

    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const button of all) {
      expect(Number(style(button)['minHeight'])).toBeGreaterThanOrEqual(touchTarget);
      expect(String(button.props['accessibilityLabel'])).toMatch(/before|after/i);
    }
  });
});

/** G4: the failed slot says the reason the upload gave, not one fixed sentence. */
describe('a failed slot says why', () => {
  it('shows the slot s own failure copy', () => {
    const tree = pair({
      before: slot({
        state: 'failed',
        uri: 'file:///a.jpg',
        error: "The photo wasn't accepted. Try again, or take it again.",
      }),
    });

    expect(text(tree)).toContain("The photo wasn't accepted. Try again, or take it again.");
    expect(text(tree)).not.toContain('Check your connection');
  });
});

/** G5: a refused attach offers only Retake, and a closed slot says the job moved on. */
describe('a refusal and a closed slot', () => {
  it('offers no Retry once the server refused the attach', () => {
    const tree = pair({
      before: slot({ state: 'failed', uri: 'file:///a.jpg', retryable: false, error: 'refused' }),
    });

    expect(byTestId(tree, 'evidence-before-retry')).toBeUndefined();
    expect(byTestId(tree, 'evidence-before-capture')).toBeDefined();
  });

  it('shows the note that the job moved on', () => {
    const tree = pair({
      before: slot({ state: 'attached', writable: false, notice: 'The job moved on.' }),
    });

    expect(byTestId(tree, 'evidence-before-notice')).toBeDefined();
    expect(text(tree)).toContain('The job moved on.');
  });
});

/** H4: a failed send is announced when the slot turns failed. */
describe('the pair s announcements', () => {
  it('announces the slot s failure copy', () => {
    announced.mockClear();
    pair({ before: slot({ state: 'failed', uri: 'file:///a.jpg', error: 'Not sent: refused.' }) });
    expect(announced).toHaveBeenCalledWith('Not sent: refused.');
  });

  it('announces the note that the job moved on', () => {
    announced.mockClear();
    pair({ before: slot({ state: 'attached', writable: false, notice: 'The job moved on.' }) });
    expect(announced).toHaveBeenCalledWith('The job moved on.');
  });
});

/** M5: attached is done, and done is cobalt; green means availability only. */
describe('the attached slot colours', () => {
  it('says done in the primary ink, on a primary-soft frame', () => {
    const tree = pair({ before: slot({ state: 'attached', uri: null }) });
    const frame = byTestId(tree, 'evidence-before-frame');
    const status = nodes(tree).find(
      (node) => node.type === 'Text' && text(node).startsWith('Before · '),
    );

    expect(frame && style(frame)['backgroundColor']).toBe(colors.primarySoft);
    expect(status && style(status)['color']).toBe(colors.primaryDark);
  });
});
