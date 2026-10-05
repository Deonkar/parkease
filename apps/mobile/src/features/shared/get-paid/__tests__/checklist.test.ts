import type { RouteOnboardingView } from '@parkease/contracts/shared';
import { describe, expect, it } from 'vitest';

import { EMPTY_DRAFT, type Draft, phaseOf, stepForField, stepsFor } from '../checklist';

const FULL: Draft = {
  legalName: 'Priya Sharma',
  email: 'priya@example.in',
  street: '12, 5th Cross, Indiranagar',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560038',
  pan: 'ABCPS1234K',
  accountNumber: '50100123456789',
  ifsc: 'HDFC0001234',
};

const view = (patch: Partial<RouteOnboardingView>): RouteOnboardingView => ({
  status: 'pending',
  legalName: null,
  bankLast4: null,
  ifscPrefix: null,
  requirements: [],
  ...patch,
});

describe('phaseOf', () => {
  it('is the checklist before anything is sent, part-way, or when Razorpay asks for changes', () => {
    expect(phaseOf(null)).toBe('checklist');
    expect(phaseOf(view({ status: 'pending' }))).toBe('checklist');
    expect(phaseOf(view({ status: 'needs_clarification' }))).toBe('checklist');
  });

  it('is a status screen once the details are with Razorpay', () => {
    expect(phaseOf(view({ status: 'under_review' }))).toBe('reviewing');
    expect(phaseOf(view({ status: 'activated' }))).toBe('active');
    expect(phaseOf(view({ status: 'rejected' }))).toBe('blocked');
    expect(phaseOf(view({ status: 'suspended' }))).toBe('blocked');
  });
});

describe('stepsFor', () => {
  it('marks the first incomplete step next and the rest to do', () => {
    const steps = stepsFor(EMPTY_DRAFT, null, new Set());
    expect(steps.map((s) => [s.key, s.state])).toEqual([
      ['details', 'next'],
      ['pan', 'todo'],
      ['bank', 'todo'],
    ]);
  });

  it('marks a step done only when the contract accepts its fields', () => {
    const steps = stepsFor({ ...FULL, pan: 'abc' }, null, new Set());
    expect(steps.map((s) => s.state)).toEqual(['done', 'next', 'done']);
  });

  it('turns the step Razorpay asked about amber with a reason, until it is edited', () => {
    const asked = view({
      status: 'needs_clarification',
      requirements: [{ field: 'kyc.pan', reason: 'document_invalid' }],
    });

    const before = stepsFor(FULL, asked, new Set());
    expect(before[1]).toMatchObject({ key: 'pan', state: 'attention' });
    expect(before[1]?.reason).toMatch(/PAN/);

    const after = stepsFor(FULL, asked, new Set(['pan']));
    expect(after[1]?.state).toBe('done');
  });
});

describe('stepForField', () => {
  it('routes Razorpay field references to the step that edits them', () => {
    expect(stepForField('kyc.pan')).toBe('pan');
    expect(stepForField('settlements.beneficiary_name')).toBe('bank');
    expect(stepForField('settlements.ifsc_code')).toBe('bank');
    expect(stepForField('profile.addresses.registered.postal_code')).toBe('details');
    expect(stepForField('legal_business_name')).toBe('details');
  });
});
