import { z } from 'zod';

import { routeStatusSchema } from '../enums/route-status.js';

/**
 * `PUT /me/route-onboarding` (owner, washer; task 16b). Everything Razorpay needs to create and
 * activate a Route Linked Account for an individual. The PAN and the account number go to
 * Razorpay and are never stored here.
 */
export const submitRouteOnboardingSchema = z
  .object({
    legalName: z.string().trim().min(4, 'Enter your name as on your PAN').max(120),
    email: z.string().trim().email('Enter a valid email'),
    pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN, like ABCDE1234F'),
    street: z
      .string()
      .trim()
      .min(4, 'Enter your street address')
      .max(100, 'Keep the street address under 100 characters'),
    city: z.string().trim().min(2, 'Enter your city').max(100),
    state: z
      .string()
      .trim()
      .min(2, 'Enter your state')
      .max(32, 'Keep the state under 32 characters'),
    postalCode: z.string().regex(/^\d{6}$/, 'Enter a 6-digit PIN code'),
    accountNumber: z.string().regex(/^\d{9,18}$/, 'Enter a valid account number'),
    ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC code'),
  })
  .strict();

export type SubmitRouteOnboarding = z.infer<typeof submitRouteOnboardingSchema>;

/** A field Razorpay asked about on `needs_clarification`, and its reason code. */
export const routeRequirementSchema = z.object({ field: z.string(), reason: z.string() });
export type RouteRequirement = z.infer<typeof routeRequirementSchema>;

export const routeOnboardingViewSchema = z.object({
  status: routeStatusSchema,
  legalName: z.string().nullable(),
  bankLast4: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  ifscPrefix: z
    .string()
    .regex(/^[A-Z]{4}$/)
    .nullable(),
  requirements: z.array(routeRequirementSchema),
});

export type RouteOnboardingView = z.infer<typeof routeOnboardingViewSchema>;
