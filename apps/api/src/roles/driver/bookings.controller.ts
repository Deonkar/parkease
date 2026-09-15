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
import {
  cancelBookingSchema,
  createBookingSchema,
  type DriverBooking,
  type DriverBookingsPage,
  extendBookingSchema,
  listBookingsQuerySchema,
} from '@parkease/contracts/driver';
import { Role } from '@parkease/contracts/enums';

import { BookingService } from '../../domains/booking/booking.service.js';
import { CancelBookingCommand } from '../../domains/booking/commands/cancel-booking.command.js';
import { CheckInCommand } from '../../domains/booking/commands/check-in.command.js';
import { CreateBookingCommand } from '../../domains/booking/commands/create-booking.command.js';
import { ExtendBookingCommand } from '../../domains/booking/commands/extend-booking.command.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { env } from '../../platform/config/env.schema.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

import { toDriverBookingView } from './views/booking.view.js';

/**
 * Rate limits come from the `POST /api/v1/driver/bookings` family of policies in
 * platform/ratelimit/policies.ts — 10/min per user on every mutation. A route
 * with no policy inherits the strictest default.
 *
 * Every mutation here carries an Idempotency-Key (ADR-011) — enforced by the
 * global `IdempotencyInterceptor` in AppModule, which covers every non-GET route
 * in the application. Do NOT also declare it with `@UseInterceptors` here: it
 * then runs twice, and the second `claim()` finds the row the first one just
 * took and answers `in_flight`, so every mutation returns 409. An earlier
 * version of this file did exactly that.
 */
@Controller('driver/bookings')
@Roles(Role.DRIVER)
export class DriverBookingsController {
  constructor(
    private readonly bookings: BookingService,
    private readonly createBooking: CreateBookingCommand,
    private readonly cancelBooking: CancelBookingCommand,
    private readonly extendBooking: ExtendBookingCommand,
    private readonly checkIn: CheckInCommand,
  ) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<DriverBooking> {
    const input = createBookingSchema.parse(body);

    const result = await this.createBooking.execute({
      driverId: user.id,
      spaceId: input.spaceId,
      vehicleType: input.vehicleType,
      durationType: input.durationType,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      vehicleNumber: input.vehicleNumber ?? null,
    });

    return toDriverBookingView(
      result.booking,
      result.space,
      result.slotIndex,
      env.BOOKING_QR_SECRET,
    );
  }

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: unknown): Promise<DriverBookingsPage> {
    const parsed = listBookingsQuerySchema.parse(query);
    const page = await this.bookings.listForDriver(user.id, parsed);

    return {
      items: page.items.map((row) =>
        toDriverBookingView(row.booking, row.space, row.slotIndex, env.BOOKING_QR_SECRET),
      ),
      meta: { limit: parsed.limit, hasMore: page.hasMore, nextCursor: page.nextCursor },
    };
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DriverBooking> {
    // Ownership is re-resolved per resource, and a miss is a 404 rather than a
    // 403 (R-SEC-04, R-API-08). A booking made before its space was deactivated
    // stays readable — prd.md §8's "existing bookings honoured".
    const owned = await this.bookings.findOwnedByDriver(id, user.id);
    if (owned === undefined) throw new NotFoundException('That booking does not exist.');

    const row = await this.bookings.findWithSpace(id);
    if (row === undefined) throw new NotFoundException('That booking does not exist.');

    return toDriverBookingView(row.booking, row.space, row.slotIndex, env.BOOKING_QR_SECRET);
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<DriverBooking> {
    const input = cancelBookingSchema.parse(body ?? {});

    await this.cancelBooking.execute({
      bookingId: id,
      driverId: user.id,
      reason: input.reason ?? null,
    });

    return this.detail(user, id);
  }

  @Post(':id/extend')
  async extend(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<DriverBooking> {
    const input = extendBookingSchema.parse(body);

    await this.extendBooking.execute({
      bookingId: id,
      driverId: user.id,
      newEndsAt: new Date(input.newEndsAt),
    });

    return this.detail(user, id);
  }

  /** The unattended-space fallback: no token, gated on time instead. */
  @Post(':id/check-in')
  async selfCheckIn(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DriverBooking> {
    await this.checkIn.execute({ bookingId: id, actorId: user.id, by: 'driver' });
    return this.detail(user, id);
  }
}
