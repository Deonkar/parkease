import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import {
  type OwnerBookingsQuery,
  type OwnerCheckInResult,
  ownerBookingsQuerySchema,
  ownerBookingSchema,
  ownerCheckInResultSchema,
  ownerCheckInSchema,
} from '@parkease/contracts/owner';
import { cursorPageOf } from '@parkease/contracts/primitives';

import { BookingService } from '../../domains/booking/booking.service.js';
import { CheckInCommand } from '../../domains/booking/commands/check-in.command.js';
import { OwnerBalanceQuery } from '../../domains/ledger/queries/owner-balance.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

import { shortName } from './views/earnings.view.js';
import { toOwnerBookingView, toOwnerCheckInView } from './views/owner-booking.view.js';

const ownerBookingsPageSchema = cursorPageOf(ownerBookingSchema);

/**
 * The owner-verified check-in, plus the owner's own bookings lists. Two role
 * folders, two authorisation contexts, two response shapes — and one piece of
 * business logic in `domains/booking` (ADR-016). `findOnSpaceOwnedBy` and
 * `ownsSpace` both join through `spaces.owner_id`, so an owner can only reach
 * bookings on their own spaces; anything else is a 404.
 */
@Controller('owner')
@Roles(Role.OWNER)
export class OwnerBookingsController {
  constructor(
    private readonly bookings: BookingService,
    private readonly checkIn: CheckInCommand,
    private readonly balance: OwnerBalanceQuery,
  ) {}

  @Post('bookings/:id/check-in')
  async scan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<OwnerCheckInResult> {
    const input = ownerCheckInSchema.parse(body);

    const booking = await this.checkIn.execute({
      bookingId: id,
      actorId: user.id,
      by: 'owner',
      token: input.token,
    });
    if (booking === undefined) throw new NotFoundException('That booking does not exist.');

    // The owner is told who arrived. Not what anything cost — the driver's price
    // breakdown is none of the owner's business beyond their own earnings.
    const driver = await this.bookings.findDriver(booking.driverId);

    // "Ravi K.", never the full name (S-85): the owner learns who arrived and nothing more.
    return parseOutgoing(
      ownerCheckInResultSchema,
      toOwnerCheckInView(booking, shortName(driver?.name ?? null)),
      'owner check-in',
    );
  }

  @Get('bookings')
  async list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.page(user.id, ownerBookingsQuerySchema.parse(query ?? {}));
  }

  @Get('spaces/:id/bookings')
  async forSpace(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) spaceId: string,
    @Query() query: unknown,
  ) {
    // Ownership before anything else, and a miss is 404 — never confirm that
    // another owner's space exists (R-SEC-04).
    if (!(await this.bookings.ownsSpace(user.id, spaceId))) {
      throw new NotFoundException('Space not found.');
    }
    return this.page(user.id, { ...ownerBookingsQuerySchema.parse(query ?? {}), spaceId });
  }

  private async page(ownerId: string, q: OwnerBookingsQuery & { spaceId?: string }) {
    const page = await this.bookings.listForOwner(ownerId, q);
    const earned = await this.balance.netByBooking(
      ownerId,
      page.items.map((row) => row.booking.id),
    );
    return parseOutgoing(
      ownerBookingsPageSchema,
      {
        items: page.items.map((row) => toOwnerBookingView(row, earned.get(row.booking.id) ?? 0)),
        meta: { limit: q.limit, hasMore: page.hasMore, nextCursor: page.nextCursor },
      },
      'owner bookings page',
    );
  }
}
