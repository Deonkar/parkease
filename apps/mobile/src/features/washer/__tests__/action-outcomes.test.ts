import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { acceptOutcomeFor, advanceOutcomeFor, TAKEN_COPY } from '../action-outcomes';
import { IN_FLIGHT_COPY, OUTDATED_COPY } from '../api/errors';

/**
 * What the partner is told, and what the screen keeps, when Accept or a status
 * change fails (G2, G3). Pure, so every branch is a unit test rather than a
 * wiring grep over a screen.
 */

const mocks = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/log', () => ({ warn: mocks.warn }));

const envelope = (status: number, code: string, message = `server says ${code}`) => ({
  response: { status, data: { error: { code, message, traceId: 't-1' } } },
});
const offline = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

beforeEach(() => {
  mocks.warn.mockReset();
});

describe('acceptOutcomeFor', () => {
  it('removes the card and says so inline when another partner won the race', () => {
    expect(acceptOutcomeFor(envelope(409, 'WASH_JOB_TAKEN'))).toEqual({
      keepIntent: false,
      removeCard: true,
      notice: TAKEN_COPY,
    });
  });

  it('removes the card for a 404: the offer is gone', () => {
    const outcome = acceptOutcomeFor(envelope(404, 'ERROR', 'Not Found'));
    expect(outcome.keepIntent).toBe(false);
    expect(outcome.removeCard).toBe(true);
    expect(outcome.notice).toMatch(/no longer available/);
  });

  it('removes the card for a bare proxy 404 with no envelope too', () => {
    const outcome = acceptOutcomeFor({ response: { status: 404, data: 'Not Found' } });
    expect(outcome.removeCard).toBe(true);
    expect(outcome.keepIntent).toBe(false);
  });

  it.each([
    [403, 'WASHER_NOT_VERIFIED'],
    [403, 'WASHER_NOT_ONBOARDED'],
    [400, 'SERVICE_NOT_OFFERED'],
    [409, 'WASH_JOB_NOT_OFFERED'],
  ])('keeps the card for a %i %s and shows the server s own words', (status, code) => {
    const outcome = acceptOutcomeFor(envelope(status, code));
    expect(outcome).toEqual({
      keepIntent: false,
      removeCard: false,
      notice: `server says ${code}`,
    });
  });

  it('says something honest for a refusal with no message in it', () => {
    const outcome = acceptOutcomeFor({ response: { status: 400, data: 'Bad Request' } });
    expect(outcome.removeCard).toBe(false);
    expect(outcome.keepIntent).toBe(false);
    expect(outcome.notice).toMatch(/couldn't accept/i);
    expect(outcome.notice).not.toMatch(/no longer available/);
  });

  it('keeps the intent and the card through a transport failure', () => {
    const outcome = acceptOutcomeFor(offline);
    expect(outcome.keepIntent).toBe(true);
    expect(outcome.removeCard).toBe(false);
    expect(outcome.notice).toMatch(/connection/i);
  });

  it('keeps the intent and the card through a 5xx', () => {
    const outcome = acceptOutcomeFor({ response: { status: 503, data: 'down' } });
    expect(outcome.keepIntent).toBe(true);
    expect(outcome.removeCard).toBe(false);
  });

  it('keeps the intent while the first attempt is still being processed', () => {
    expect(acceptOutcomeFor(envelope(409, 'REQUEST_IN_FLIGHT'))).toEqual({
      keepIntent: true,
      removeCard: false,
      notice: IN_FLIGHT_COPY,
    });
  });

  it('drops the intent and says "Update the app" for an answer it could not read', () => {
    expect(acceptOutcomeFor(new ZodError([]))).toEqual({
      keepIntent: false,
      removeCard: false,
      notice: OUTDATED_COPY,
    });
  });

  it.each([
    ['taken', envelope(409, 'WASH_JOB_TAKEN')],
    ['gone', envelope(404, 'ERROR')],
    ['refused', envelope(403, 'WASHER_NOT_VERIFIED')],
    ['offline', offline],
    ['in flight', envelope(409, 'REQUEST_IN_FLIGHT')],
    ['outdated', new ZodError([])],
  ])('logs the %s branch at warn with the error', (_name, error) => {
    acceptOutcomeFor(error);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn.mock.calls[0]?.[1]).toBe(error);
  });
});

describe('advanceOutcomeFor', () => {
  it('says nothing for ILLEGAL_CARWASH_TRANSITION: the refetch corrects the screen', () => {
    expect(advanceOutcomeFor(envelope(409, 'ILLEGAL_CARWASH_TRANSITION'))).toEqual({
      keepIntent: false,
      notice: null,
    });
  });

  it.each([
    [409, 'BEFORE_PHOTO_REQUIRED'],
    [409, 'AFTER_PHOTO_REQUIRED'],
    [403, 'FORBIDDEN'],
    [404, 'WASH_JOB_NOT_FOUND'],
  ])('tells a %i %s in the server s own words and drops the intent', (status, code) => {
    expect(advanceOutcomeFor(envelope(status, code))).toEqual({
      keepIntent: false,
      notice: `server says ${code}`,
    });
  });

  it('says something honest for a refusal with no message', () => {
    const outcome = advanceOutcomeFor({ response: { status: 400, data: 'Bad Request' } });
    expect(outcome.keepIntent).toBe(false);
    expect(outcome.notice).not.toBeNull();
    expect(outcome.notice).not.toMatch(/connection/i);
  });

  it('keeps the intent and says the connection for a transport failure', () => {
    const outcome = advanceOutcomeFor(offline);
    expect(outcome.keepIntent).toBe(true);
    expect(outcome.notice).toMatch(/connection/i);
  });

  it('keeps the intent while the first attempt is still being processed', () => {
    expect(advanceOutcomeFor(envelope(409, 'REQUEST_IN_FLIGHT'))).toEqual({
      keepIntent: true,
      notice: IN_FLIGHT_COPY,
    });
  });

  it('drops the intent for an answer it could not read', () => {
    expect(advanceOutcomeFor(new ZodError([]))).toEqual({
      keepIntent: false,
      notice: OUTDATED_COPY,
    });
  });

  it('logs every branch at warn with the error', () => {
    for (const error of [
      envelope(409, 'ILLEGAL_CARWASH_TRANSITION'),
      envelope(409, 'BEFORE_PHOTO_REQUIRED'),
      offline,
      new ZodError([]),
    ]) {
      mocks.warn.mockReset();
      advanceOutcomeFor(error);
      expect(mocks.warn).toHaveBeenCalledTimes(1);
      expect(mocks.warn.mock.calls[0]?.[1]).toBe(error);
    }
  });
});
