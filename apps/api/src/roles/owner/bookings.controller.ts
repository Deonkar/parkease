import {
  Body,
  Controller,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import { type OwnerCheckInResult, ownerCheckInSchema } from '@parkease/contracts/owner';

import { BookingService } from '../../domains/booking/booking.service.js';
import { CheckInCommand } from '../../domains/booking/commands/check-in.command.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { IdempotencyInterceptor } from '../../platform/idempotency/idempotency.interceptor.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

import { toOwnerCheckInView } from './views/owner-booking.view.js';

/**
 * The owner-verified check-in. Two role folders, two authorisation contexts, two
 * response shapes — and one piece of business logic in `domains/booking`
 * (ADR-016). `findOnSpaceOwnedBy` joins through `spaces.owner_id`, so an owner
 * can only check in bookings on their own spaces; anything else is a 404.
 */
@Controller('owner/bookings')
@Roles(Role.OWNER)
export class OwnerBookingsController {
  constructor(
    private readonly bookings: BookingService,
    private readonly checkIn: CheckInCommand,
  ) {}

  @Post(':id/check-in')
  @UseInterceptors(IdempotencyInterceptor)
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

    return toOwnerCheckInView(booking, driver?.name ?? 'Driver');
  }
}
