import { z } from 'zod';

export const updateBankDetailsSchema = z.object({
  accountHolderName: z.string().min(1).max(200),
  accountNumber: z.string().min(5).max(30),
  ifscCode: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC code'),
  bankName: z.string().min(1).max(200).optional(),
});

export type UpdateBankDetails = z.infer<typeof updateBankDetailsSchema>;

export const bankDetailsResponseSchema = z.object({
  accountHolderName: z.string(),
  accountNumberMasked: z.string(),
  ifscCode: z.string(),
  bankName: z.string().nullable(),
  verified: z.boolean(),
});

export type BankDetailsResponse = z.infer<typeof bankDetailsResponseSchema>;
