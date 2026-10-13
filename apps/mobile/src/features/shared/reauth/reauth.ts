import { meResponseSchema } from '@parkease/contracts/shared';
import { z } from 'zod';

import { api } from '@/lib/api';
import { confirmOtp, requestOtp } from '@/lib/firebase';

import { toApiFailure } from '../api/errors';

/**
 * Step-up for changes a stolen session must not be able to make (S-100): the server accepts a
 * bank change only with an ID token from a phone OTP completed in the last five minutes, on this
 * account's own phone. This is the app's half: send the code, confirm it, hand back the token.
 */
export interface ReauthDeps {
  readonly ownPhone: () => Promise<string>;
  readonly sendCode: (e164Phone: string) => Promise<void>;
  readonly confirmCode: (code: string) => Promise<string>;
}

const meEnvelope = z.object({ data: meResponseSchema });

export const reauthDeps: ReauthDeps = {
  ownPhone: async () => meEnvelope.parse((await api.get<unknown>('/me')).data).data.phone,
  sendCode: requestOtp,
  confirmCode: confirmOtp,
};

/** "+919876543210" → "+91 ••••• 43210": enough to recognise, not enough to read off a screen. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 5) return '•••••';
  const country = e164.startsWith('+91') ? '+91 ' : '';
  return `${country}••••• ${digits.slice(-5)}`;
}

/** The server's step-up refusal: the token was missing, stale, foreign or already used. */
export function isReauthRequired(error: unknown): boolean {
  const failure = toApiFailure(error);
  return failure.status === 403 && failure.code === 'REAUTH_REQUIRED';
}
