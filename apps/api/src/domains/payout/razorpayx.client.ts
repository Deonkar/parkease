import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { env } from '../../platform/config/env.schema.js';

/**
 * RazorpayX, as the API is allowed to see it: a Contact per payee and a Fund
 * Account per set of bank details (§16.5). The API creates both when bank
 * details are saved, so the worker only ever holds the opaque fund account id
 * and never a bank account number (ADR-030).
 *
 * Plain `fetch`, not the SDK: `razorpay@2.9.8` has no contacts or payouts, and
 * its `fundAccount` resource is for Checkout customers, not RazorpayX. Every
 * response is parsed (R-VAL-01).
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

/**
 * `status` is the HTTP status RazorpayX answered with, or null when it never
 * answered. A 4xx is RazorpayX refusing what we sent; anything else is it
 * being unavailable — the two get different answers to the user.
 */
export class RazorpayXError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'RazorpayXError';
  }

  get rejected(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }
}

const idResponse = z.object({ id: z.string().min(1) });

const BASE_URL = 'https://api.razorpay.com/v1';

@Injectable()
export class RazorpayXHttpClient implements RazorpayXClient {
  async createContact(input: { name: string; referenceId: string }): Promise<string> {
    return this.post('/contacts', {
      name: input.name,
      type: 'vendor',
      reference_id: input.referenceId,
    });
  }

  async createFundAccount(input: {
    contactId: string;
    name: string;
    ifsc: string;
    accountNumber: string;
  }): Promise<string> {
    return this.post('/fund_accounts', {
      contact_id: input.contactId,
      account_type: 'bank_account',
      bank_account: { name: input.name, ifsc: input.ifsc, account_number: input.accountNumber },
    });
  }

  private async post(path: string, body: unknown): Promise<string> {
    const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString(
      'base64',
    );
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new RazorpayXError(null, `RazorpayX ${path} unreachable: ${String(error)}`);
    }
    if (!response.ok) {
      // The body names the field RazorpayX refused; it can echo what we sent,
      // so it is not logged — only the status crosses into the error.
      throw new RazorpayXError(
        response.status,
        `RazorpayX ${path} answered ${String(response.status)}`,
      );
    }
    return idResponse.parse(await response.json()).id;
  }
}
