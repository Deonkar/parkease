import process from 'node:process';

import { z } from 'zod';

const seedEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BOOTSTRAP_ADMIN_PHONE: z.string().min(1),
  BOOTSTRAP_ADMIN_NAME: z.string().min(1).default('ParkEase Admin'),
});

export function parseSeedEnv() {
  const result = seedEnvSchema.safeParse(process.env);
  if (!result.success) {
    // eslint-disable-next-line no-console -- seed script output
    console.error('Missing required environment variables for seed:');
    for (const issue of result.error.issues) {
      // eslint-disable-next-line no-console -- seed script output
      console.error(`  ${String(issue.path[0])}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export type SeedEnv = ReturnType<typeof parseSeedEnv>;
