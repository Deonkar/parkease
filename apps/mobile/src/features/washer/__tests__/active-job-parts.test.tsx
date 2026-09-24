import type { CarwashJobStatus } from '@parkease/contracts/enums';
import { colors } from '@parkease/tokens';
import { describe, expect, it, vi } from 'vitest';

import { byTestId, nodes, render, style, text } from '../../shared/__tests__/render-native';
import { ElapsedBar, elapsedMinutesSince } from '../components/ElapsedBar';
import { StepRail, currentStepFor } from '../components/StepRail';
import { WashActionBar } from '../components/WashActionBar';
import { primaryActionFor } from '../photo-gate';

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

vi.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: 'MaterialCommunityIcons',
}));

describe('currentStepFor', () => {
  it.each<[CarwashJobStatus, number | null]>([
    ['accepted', 0],
    ['en_route', 0],
    ['washing', 1],
    ['completed', 2],
    ['cancelled', null],
    ['requested', null],
    ['offered', null],
  ])('%s → step %s', (status, step) => {
    expect(currentStepFor(status)).toBe(step);
  });
});

describe('the step rail', () => {
  const steps = (status: CarwashJobStatus) =>
    nodes(render(<StepRail status={status} />)).filter((node) =>
      String(node.props['testID']).startsWith('step-'),
    );

  it('reads every step as text', () => {
    const all = text(render(<StepRail status="washing" />));

    expect(all).toContain('On the way');
    expect(all).toContain('Washing');
    expect(all).toContain('Completed');
  });

  it('announces which step is current, not only by colour (R-FE-12)', () => {
    const [onTheWay, washing, completed] = steps('washing');

    expect(washing?.props['accessibilityState']).toEqual({ selected: true });
    expect(String(washing?.props['accessibilityLabel'])).toMatch(/current/i);
    expect(String(onTheWay?.props['accessibilityLabel'])).toMatch(/done/i);
    expect(String(completed?.props['accessibilityLabel'])).toMatch(/not yet/i);
  });

  it('reads a completed job as all done', () => {
    for (const step of steps('completed')) {
      expect(String(step.props['accessibilityLabel'])).toMatch(/done/i);
    }
  });

  it('says a cancelled job was cancelled instead of drawing a rail', () => {
    const tree = render(<StepRail status="cancelled" />);

    expect(text(tree)).toContain('cancelled');
    expect(steps('cancelled')).toHaveLength(0);
  });
});

/** M5: a done step is cobalt, filled with a check; green means availability only. */
describe('the step rail colours', () => {
  const marker = (status: CarwashJobStatus, index: number) => {
    const step = byTestId(render(<StepRail status={status} />), `step-${String(index)}`);
    const first = step?.children?.[0];
    return typeof first === 'object' ? style(first) : {};
  };

  it('fills a done step with the primary colour, not availability green', () => {
    expect(marker('completed', 0)['backgroundColor']).toBe(colors.primary);
    expect(marker('washing', 0)['backgroundColor']).toBe(colors.primary);
  });

  it('draws the current step as a ring, so done and current differ by shape', () => {
    expect(marker('washing', 1)['borderColor']).toBe(colors.primary);
    expect(marker('washing', 1)['backgroundColor']).toBe(colors.surface);
  });
});

describe('elapsedMinutesSince', () => {
  const start = '2026-09-23T10:00:00.000Z';

  it('counts whole minutes', () => {
    expect(elapsedMinutesSince(start, Date.parse('2026-09-23T10:18:59.000Z'))).toBe(18);
  });

  it('never runs backwards on a clock that is behind the server', () => {
    expect(elapsedMinutesSince(start, Date.parse('2026-09-23T09:59:00.000Z'))).toBe(0);
  });
});

describe('the elapsed bar', () => {
  const bar = (elapsedMinutes: number, durationMinutes = 40) =>
    render(<ElapsedBar elapsedMinutes={elapsedMinutes} durationMinutes={durationMinutes} />);

  it('reads elapsed against the estimate', () => {
    const tree = bar(18);

    expect(text(tree)).toContain('18 / 40 min');
    const fill = byTestId(tree, 'elapsed-fill');
    expect(fill && style(fill)['width']).toBe('45%');
  });

  it('stops at the estimate: a long wash is normal, not an error', () => {
    const tree = bar(55);

    expect(text(tree)).toContain('40 / 40 min');
    const fill = byTestId(tree, 'elapsed-fill');
    expect(fill && style(fill)['width']).toBe('100%');
  });

  it('tells assistive tech the same numbers', () => {
    const track = byTestId(bar(18), 'elapsed-bar');

    expect(track?.props['accessibilityValue']).toEqual({ min: 0, max: 40, now: 18 });
  });
});

describe('the primary action', () => {
  const complete = primaryActionFor(['complete']);

  it('is one full-width button with a 52dp target', () => {
    const tree = render(
      <WashActionBar action={complete} lockReason={null} pending={false} onPress={vi.fn()} />,
    );
    const button = byTestId(tree, 'wash-primary-action');

    expect(text(tree)).toContain('Mark complete');
    expect(button && Number(style(button)['minHeight'])).toBeGreaterThanOrEqual(52);
    expect(button?.props['disabled']).toBe(false);
  });

  it('is locked with a visible reason while the photo it needs is missing', () => {
    const onPress = vi.fn();
    const tree = render(
      <WashActionBar
        action={complete}
        lockReason="Take the after photo to unlock"
        pending={false}
        onPress={onPress}
      />,
    );
    const button = byTestId(tree, 'wash-primary-action');

    expect(text(tree)).toContain('Take the after photo to unlock');
    expect(button?.props['disabled']).toBe(true);
    expect(button?.props['accessibilityState']).toMatchObject({ disabled: true });
  });

  it('cannot be pressed twice while the change is in flight', () => {
    const tree = render(
      <WashActionBar action={complete} lockReason={null} pending onPress={vi.fn()} />,
    );
    const button = byTestId(tree, 'wash-primary-action');

    expect(button?.props['disabled']).toBe(true);
    expect(button?.props['accessibilityState']).toEqual({ disabled: true, busy: true });
  });

  it('renders nothing on a finished job — no button beats a wrong button', () => {
    const tree = render(
      <WashActionBar action={null} lockReason={null} pending={false} onPress={vi.fn()} />,
    );

    expect(byTestId(tree, 'wash-primary-action')).toBeUndefined();
  });
});
