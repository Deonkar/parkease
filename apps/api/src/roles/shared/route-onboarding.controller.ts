import { Body, Controller, Get, Put } from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import {
  type RouteOnboardingView,
  routeOnboardingViewSchema,
  submitRouteOnboardingSchema,
} from '@parkease/contracts/shared';

import { SubmitRouteOnboardingCommand } from '../../domains/payout/commands/submit-route-onboarding.command.js';
import { RouteOnboardingNotFoundError } from '../../domains/payout/errors.js';
import { type LinkedAccountRow, PayoutService } from '../../domains/payout/payout.service.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

/** Built from display columns only; `requirements` is jsonb, so it is parsed, never cast. */
const toView = (row: LinkedAccountRow): RouteOnboardingView =>
  parseOutgoing(
    routeOnboardingViewSchema,
    {
      status: row.kycStatus,
      legalName: row.legalName,
      bankLast4: row.settlementLast4,
      ifscPrefix: row.settlementIfscPrefix,
      requirements: row.requirements,
    },
    'route onboarding view',
  );

/**
 * Route onboarding for the payees Route pays: space owners and car wash partners (task 16b).
 * Valets are paid by RazorpayX and use `/me/bank-details` instead (ADR-030).
 */
@Controller('me/route-onboarding')
@Roles(Role.OWNER, Role.WASHER)
export class MeRouteOnboardingController {
  constructor(
    private readonly payouts: PayoutService,
    private readonly submit: SubmitRouteOnboardingCommand,
  ) {}

  @Put()
  async put(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<RouteOnboardingView> {
    const form = submitRouteOnboardingSchema.parse(body);
    const row = await this.submit.execute({
      userId: user.id,
      // The Razorpay category follows the roles held; only a user holding both is asked
      // which one they are setting up through the role they are acting as.
      role:
        !user.roles.includes(Role.OWNER) ||
        (user.roles.includes(Role.WASHER) && user.activeRole === Role.WASHER)
          ? Role.WASHER
          : Role.OWNER,
      form,
    });
    return toView(row);
  }

  @Get()
  async get(@CurrentUser() user: AuthUser): Promise<RouteOnboardingView> {
    const row = await this.payouts.linkedFor(user.id);
    if (row === undefined) throw new RouteOnboardingNotFoundError();
    return toView(row);
  }
}
