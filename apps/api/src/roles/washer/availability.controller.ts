import { Body, Controller, Patch } from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import { setWasherAvailabilitySchema } from '@parkease/contracts/washer';

import { SetWasherAvailabilityCommand } from '../../domains/carwash/commands/set-availability.command.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

@Controller('washer/availability')
@Roles(Role.WASHER)
export class WasherAvailabilityController {
  constructor(private readonly setAvailability: SetWasherAvailabilityCommand) {}

  /**
   * Online/offline, and the heartbeat fix.
   *
   * The same endpoint serves both because they are the same fact: a partner is
   * dispatchable when they have said so *and* we have heard from them recently.
   * Splitting the heartbeat into its own route would invite a client that
   * toggles online and never beats again — permanently willing, permanently
   * unreachable, and invisible to every candidate query.
   */
  @Patch()
  async update(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<{ isOnline: boolean; lastSeenAt: string }> {
    const input = setWasherAvailabilitySchema.parse(body);

    const result = await this.setAvailability.execute({
      washerUserId: user.id,
      isOnline: input.isOnline,
      ...(input.location === undefined ? {} : { location: input.location }),
    });

    return { isOnline: result.isOnline, lastSeenAt: result.lastSeenAt.toISOString() };
  }
}
