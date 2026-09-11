import { z } from 'zod';

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export type Logout = z.infer<typeof logoutSchema>;
