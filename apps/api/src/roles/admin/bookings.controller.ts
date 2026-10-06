import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  adminBookingDetailSchema,
  adminBookingListItemSchema,
  adminBookingsQuerySchema,
  adminRefundSchema,
  reasonSchema,
} from '@parkease/contracts/admin';
import { Role } from '@parkease/contracts/enums';
import { offsetPageOf } from '@parkease/contracts/primitives';
import type { FastifyRequest } from 'fastify';

import { AdminBookingQueries } from '../../domains/booking/admin-booking.queries.js';
import { CancelBookingCommand } from '../../domains/booking/commands/cancel-booking.command.js';
import { AdminRefundCommand } from '../../domains/payment/commands/admin-refund.command.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import type { AdminActor } from '../../platform/observability/audit.service.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

const bookingsPageSchema = offsetPageOf(adminBookingListItemSchema);

/**
 * Bookings, their money, and the two things an admin may do to one (task 18a): cancel it at the
 * admin tier, or refund a finished one. Both answer with the booking as it now stands — ledger,
 * refunds and remaining balance included — so the screen redraws from the response.
 */
@Controller('admin/bookings')
@Roles(Role.ADMIN)
export class AdminBookingsController {
  constructor(
    private readonly queries: AdminBookingQueries,
    private readonly cancelBooking: CancelBookingCommand,
    private readonly adminRefund: AdminRefundCommand,
  ) {}

  @Get()
  async list(@Query() query: unknown) {
    const q = adminBookingsQuerySchema.parse(query ?? {});
    const { items, total } = await this.queries.list(q);
    return parseOutgoing(
      bookingsPageSchema,
      { items, meta: { page: q.page, pageSize: q.pageSize, total } },
      'admin booking list',
    );
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.view(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ) {
    const { reason } = reasonSchema.parse(body);
    await this.cancelBooking.execute({
      bookingId: id,
      reason,
      by: { kind: 'admin', actor: actorOf(user, request) },
    });
    return this.view(id);
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  async refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ) {
    const input = adminRefundSchema.parse(body);
    await this.adminRefund.execute(id, input, actorOf(user, request));
    return this.view(id);
  }

  private async view(id: string) {
    const found = await this.queries.detail(id);
    if (found === undefined) throw new NotFoundException('That booking does not exist.');
    return parseOutgoing(adminBookingDetailSchema, found, 'admin booking detail');
  }
}

/** The IP is a property of the connection; the audit row is written three layers down. */
const actorOf = (user: AuthUser, request: FastifyRequest): AdminActor => ({
  userId: user.id,
  ipAddress: request.ip,
});
