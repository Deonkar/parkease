import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().startsWith('postgres'),
  REDIS_URL: z.string().url().startsWith('redis'),
  // The worker issues refunds, so it holds the key secret too. It never holds
  // the webhook secret: nothing here verifies a webhook (R-ENV-03).
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
});

export type WorkerEnv = z.infer<typeof envSchema>;

function loadEnv(): WorkerEnv {
  const parsed = envSchema.safeParse(process.env);
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
