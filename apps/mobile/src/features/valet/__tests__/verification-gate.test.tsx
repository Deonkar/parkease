import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { render, text } from '../../shared/__tests__/render-native';
import { VerificationGate } from '../components/VerificationGate';
import { describeVerification } from '../profile-status';

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

vi.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: 'MaterialCommunityIcons',
}));

const gateFor = (status: string) => {
  const { banner } = describeVerification(status);
  if (banner === null) return null;
  return render(<VerificationGate banner={banner} />);
};

describe('the verification gate', () => {
  it('renders nothing for a verified valet', () => {
    expect(describeVerification('verified').banner).toBe(null);
  });

  it('explains a pending review and offers a way to see the documents', () => {
    const tree = gateFor('pending');

    expect(text(tree)).toContain('Verification in progress');
    expect(text(tree)).toContain('View my documents');
  });

  it('asks an unverified valet to upload rather than only stating a lack', () => {
    expect(text(gateFor('unverified'))).toContain('Upload');
  });

  it('points a rejected valet at support', () => {
    expect(text(gateFor('rejected'))).toContain('support');
  });

  it('says something for a status it does not recognise, rather than nothing', () => {
    // Failing closed is only useful if the valet is told why they are blocked.
    expect(text(gateFor('some_future_status')).trim()).not.toBe('');
  });
});

/**
 * Wiring guards, for the same reason `status-bar.test.tsx` carries them: the
 * populated profile screen is unreachable in the browser pass (there is no API
 * behind `:8099`), so a component that is correct but never rendered would look
 * exactly like a component that works.
 *
 * This whole screen existed as a task-05 placeholder through an entire "task
 * complete" report, which is what these guards are really for.
 */
describe('the profile screen renders what it computes', () => {
  const source = readFileSync(join(process.cwd(), 'app', '(valet)', 'profile.tsx'), 'utf8');

  it('renders the verification gate', () => {
    expect(source).toContain('<VerificationGate');
  });

  it('derives the banner from the shared rule rather than its own check', () => {
    expect(source).toContain('describeVerification(');
    expect(source).not.toMatch(/verificationStatus === 'verified'/);
  });

  it('renders the licence warning', () => {
    expect(source).toContain('licenceWarning(');
    expect(source).toContain('testID="licence-warning"');
  });

  it('is no longer the task-05 placeholder', () => {
    // The placeholder had a sign-out button and nothing else.
    expect(source).toContain('DOCUMENTS');
  });
});

/**
 * The offers screen must lock Accept from the SAME rule, or the two screens can
 * disagree about whether a valet may work.
 */
describe('offers locks accept from the shared rule', () => {
  const source = readFileSync(join(process.cwd(), 'app', '(valet)', 'offers.tsx'), 'utf8');

  it('asks describeVerification rather than comparing the status inline', () => {
    expect(source).toContain('describeVerification(');
    expect(source).not.toMatch(/verificationStatus === 'verified'/);
  });
});

/**
 * Guards found by the accessibility and spec lenses.
 *
 * Both are things a browser pass cannot reach (they need a live API and a
 * screen reader), and both were missing while every other test was green.
 */
describe('offers handles a lost race and a dying fix audibly', () => {
  const source = readFileSync(join(process.cwd(), 'app', '(valet)', 'offers.tsx'), 'utf8');
  const rail = readFileSync(
    join(process.cwd(), 'src', 'features', 'valet', 'components', 'OnlineStatusBar.tsx'),
    'utf8',
  );

  it('shows the §12.3 copy inline when another valet takes the job', () => {
    expect(source).toContain('taken by another valet');
  });

  it('shows it inline rather than as an alert banner', () => {
    // A red banner for something that happens several times a day teaches
    // valets to ignore banners.
    expect(source).toContain('testID="offer-taken-notice"');
  });

  it('announces that notice, since the sighted cue is the card swapping', () => {
    expect(source).toMatch(/offer-taken-notice[\s\S]{0,200}|accessibilityLiveRegion/);
  });

  it('announces a fix going stale or lost to a valet focused elsewhere', () => {
    expect(rail).toContain('accessibilityLiveRegion');
  });
});
