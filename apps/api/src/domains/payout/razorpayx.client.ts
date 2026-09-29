import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { razorpayRequest } from './razorpay-rest.js';

/**
 * RazorpayX, as the API is allowed to see it: a Contact per payee and a Fund
 * Account per set of bank details (§16.5). The API creates both when bank
 * details are saved, so the worker only ever holds the opaque fund account id
 * and never a bank account number (ADR-030).
 *
 * Plain REST, not the SDK: `razorpay@2.9.8` has no contacts or payouts, and
 * its `fundAccount` resource is for Checkout customers, not RazorpayX.
 */
export const RAZORPAYX = Symbol('RAZORPAYX');

export interface RazorpayXClient {
  /** Returns the `cont_…` id. */
  createContact(input: { name: string; referenceId: string }): Promise<string>;
  /** Returns the `fa_…` id. */
  createFundAccount(input: {
    contactId: string;
    name: string;
    ifsc: string;
    accountNumber: string;
  }): Promise<string>;
}

const idResponse = z.object({ id: z.string().min(1) });

@Injectable()
export class RazorpayXHttpClient implements RazorpayXClient {
  async createContact(input: { name: string; referenceId: string }): Promise<string> {
    const contact = await razorpayRequest('POST', '/v1/contacts', idResponse, {
      name: input.name,
      type: 'vendor',
      reference_id: input.referenceId,
    });
    return contact.id;
  }

  async createFundAccount(input: {
    contactId: string;
    name: string;
    ifsc: string;
    accountNumber: string;
  }): Promise<string> {
    const account = await razorpayRequest('POST', '/v1/fund_accounts', idResponse, {
      contact_id: input.contactId,
      account_type: 'bank_account',
      bank_account: { name: input.name, ifsc: input.ifsc, account_number: input.accountNumber },
    });
    return account.id;
  }
}
