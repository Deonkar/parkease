import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_VERSION: z.string().min(1).default('0.0.0-dev'),

  DATABASE_URL: z.string().url().startsWith('postgres'),
  REDIS_URL: z.string().url().startsWith('redis'),

  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string().min(1),

  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),

  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),

  ENCRYPTION_KEY: z.string().length(64, 'must be 32 bytes as 64 hex characters'),

  CORS_ALLOWED_ORIGINS: z.string().transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  SENTRY_DSN: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (parsed.success) return parsed.data;

  const problems = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .sort()
    .join('\n');

  process.stderr.write(
    `\nParkEase cannot start. ${String(parsed.error.issues.length)} environment problem(s):\n\n` +
      `${problems}\n\n` +
      `Copy .env.example to .env.development and fill these in.\n\n`,
  );
  process.exit(1);
}

export const env: Env = loadEnv();
