import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { verifyDemoToken } from '../src/platform/auth/firebase-verifier.service.js';
import { demoCredentials, envSchema } from '../src/platform/config/env.schema.js';

const EXTERNAL = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

const withoutExternal = (): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !EXTERNAL.includes(key)));

describe('DEMO_MODE environment', () => {
  it('without it, the external credentials stay required', () => {
    expect(envSchema.safeParse(withoutExternal()).success).toBe(false);
  });

  it('fills every external credential, so the API boots with none of them', () => {
    const parsed = envSchema.safeParse({
      ...demoCredentials(),
      ...withoutExternal(),
      DEMO_MODE: 'true',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.DEMO_MODE).toBe(true);
  });

  it('never fills a secret with a known value: a public webhook secret would forge payments', () => {
    expect(demoCredentials()['RAZORPAY_WEBHOOK_SECRET']).not.toBe(
      demoCredentials()['RAZORPAY_WEBHOOK_SECRET'],
    );
  });

  it('lets real credentials win over the fills', () => {
    const parsed = envSchema.safeParse({ ...demoCredentials(), ...process.env, DEMO_MODE: 'true' });
    expect(parsed.data?.RAZORPAY_KEY_ID).toBe(process.env['RAZORPAY_KEY_ID']);
  });
});

describe('verifyDemoToken', () => {
  it('signs in a demo account by its phone', () => {
    expect(verifyDemoToken('demo:+919900000001')).toMatchObject({
      phone: '+919900000001',
      firebaseUid: 'demo:+919900000001',
    });
  });

  it.each(['demo:+919812345678', '+919900000001', 'demo:', 'a-firebase-id-token'])(
    'refuses %s: only the fixed demo accounts sign in',
    (token) => {
      expect(() => verifyDemoToken(token)).toThrow(UnauthorizedException);
    },
  );
});
