import { randomBytes } from 'node:crypto';

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().startsWith('postgres'),
  REDIS_URL: z.string().url().startsWith('redis'),
  // The worker issues refunds, so it holds the key secret too. It never holds
  // the webhook secret: nothing here verifies a webhook (R-ENV-03).
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  /**
   * The RazorpayX current account payouts are drawn from (task 16a). Optional:
   * absent means payouts are off — the weekly run logs and pays nobody — so a
   * dev machine without a RazorpayX account still boots.
   */
  RAZORPAYX_ACCOUNT_NUMBER: z.string().min(1).optional(),
  /** Expo's push access token (task 19). Optional: Expo accepts unauthenticated sends. */
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
});

export type WorkerEnv = z.infer<typeof envSchema>;

/**
 * The free public demo (task 22, the API's DEMO_MODE): no Razorpay account exists, so refunds
 * and payouts fail through their normal failure paths. The secret is random per boot.
 */
const demoCredentials = () => ({
  RAZORPAY_KEY_ID: 'demo-disabled',
  RAZORPAY_KEY_SECRET: randomBytes(32).toString('hex'),
});

function loadEnv(): WorkerEnv {
  const source =
    process.env['DEMO_MODE'] === 'true' ? { ...demoCredentials(), ...process.env } : process.env;
  const parsed = envSchema.safeParse(source);
  if (parsed.success) return parsed.data;

  const problems = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .sort()
    .join('\n');

  process.stderr.write(
    `\nParkEase worker cannot start. ${String(parsed.error.issues.length)} environment problem(s):\n\n` +
      `${problems}\n\n`,
  );
  process.exit(1);
}

export const env: WorkerEnv = loadEnv();
