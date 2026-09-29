import { Injectable } from '@nestjs/common';
import type { RouteStatus } from '@parkease/contracts/enums';
import type { RouteRequirement } from '@parkease/contracts/shared';
import { z } from 'zod';

import { razorpayRequest } from './razorpay-rest.js';

/**
 * Razorpay Route Linked Account onboarding (task 16b, ADR-013), in the four steps Razorpay's
 * API takes: account → stakeholder → Route product → settlement bank. Each `upsert*` creates
 * when given no id and PATCHes the existing one otherwise, so a resubmission after
 * `needs_clarification` corrects the account Razorpay already has.
 */
export const ROUTE = Symbol('ROUTE');

export interface RouteAccountInput {
  readonly email: string;
  /** Digits only, 8–15. */
  readonly phone: string;
  readonly legalName: string;
  readonly category: string;
  readonly subcategory: string;
  readonly street: string;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly referenceId: string;
}

export interface RouteSettlement {
  readonly status: RouteStatus;
  readonly requirements: RouteRequirement[];
}

export interface RouteClient {
  upsertAccount(accountId: string | null, input: RouteAccountInput): Promise<string>;
  upsertStakeholder(
    accountId: string,
    stakeholderId: string | null,
    input: { name: string; email: string; pan: string },
  ): Promise<string>;
  requestProduct(accountId: string): Promise<string>;
  configureSettlement(
    accountId: string,
    productId: string,
    input: { accountNumber: string; ifsc: string; beneficiaryName: string },
  ): Promise<RouteSettlement>;
}

const idResponse = z.object({ id: z.string().min(1) });

/** Razorpay's product states; `requested` is ours `pending`. */
const productResponse = z.object({
  id: z.string().min(1),
  activation_status: z.enum([
    'requested',
    'under_review',
    'needs_clarification',
    'activated',
    'rejected',
    'suspended',
  ]),
  requirements: z
    .array(z.object({ field_reference: z.string(), reason_code: z.string() }))
    .default([]),
});

export const toRouteStatus = (status: z.infer<typeof productResponse>['activation_status']) =>
  status === 'requested' ? 'pending' : status;

@Injectable()
export class RouteHttpClient implements RouteClient {
  async upsertAccount(accountId: string | null, input: RouteAccountInput): Promise<string> {
    const body = {
      email: input.email,
      phone: input.phone,
      legal_business_name: input.legalName,
      contact_name: input.legalName,
      business_type: 'individual',
      profile: {
        category: input.category,
        subcategory: input.subcategory,
        addresses: {
          registered: {
            street1: input.street,
            city: input.city,
            state: input.state,
            postal_code: input.postalCode,
            country: 'IN',
          },
        },
      },
    };
    const account =
      accountId === null
        ? await razorpayRequest('POST', '/v2/accounts', idResponse, {
            ...body,
            type: 'route',
            reference_id: input.referenceId,
          })
        : await razorpayRequest(
            'PATCH',
            `/v2/accounts/${encodeURIComponent(accountId)}`,
            idResponse,
            body,
          );
    return account.id;
  }

  async upsertStakeholder(
    accountId: string,
    stakeholderId: string | null,
    input: { name: string; email: string; pan: string },
  ): Promise<string> {
    const base = `/v2/accounts/${encodeURIComponent(accountId)}/stakeholders`;
    const body = { name: input.name, email: input.email, kyc: { pan: input.pan } };
    const stakeholder =
      stakeholderId === null
        ? await razorpayRequest('POST', base, idResponse, body)
        : await razorpayRequest(
            'PATCH',
            `${base}/${encodeURIComponent(stakeholderId)}`,
            idResponse,
            body,
          );
    return stakeholder.id;
  }

  async requestProduct(accountId: string): Promise<string> {
    const product = await razorpayRequest(
      'POST',
      `/v2/accounts/${encodeURIComponent(accountId)}/products`,
      idResponse,
      { product_name: 'route', tnc_accepted: true },
    );
    return product.id;
  }

  async configureSettlement(
    accountId: string,
    productId: string,
    input: { accountNumber: string; ifsc: string; beneficiaryName: string },
  ): Promise<RouteSettlement> {
    const product = await razorpayRequest(
      'PATCH',
      `/v2/accounts/${encodeURIComponent(accountId)}/products/${encodeURIComponent(productId)}`,
      productResponse,
      {
        settlements: {
          account_number: input.accountNumber,
          ifsc_code: input.ifsc,
          beneficiary_name: input.beneficiaryName,
        },
        tnc_accepted: true,
      },
    );
    return {
      status: toRouteStatus(product.activation_status),
      requirements: (product.requirements ?? []).map((r) => ({
        field: r.field_reference,
        reason: r.reason_code,
      })),
    };
  }
}
