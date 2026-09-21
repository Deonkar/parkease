import { Body, Controller, Patch } from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import { setValetAvailabilitySchema } from '@parkease/contracts/valet';

import { SetAvailabilityCommand } from '../../domains/valet/commands/set-availability.command.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

@Controller('valet/availability')
@Roles(Role.VALET)
export class ValetAvailabilityController {
  constructor(private readonly setAvailability: SetAvailabilityCommand) {}

  /**
   * Online/offline, and the heartbeat fix.
   *
   * The same endpoint serves both because they are the same fact: a valet is
   * dispatchable when they have said so *and* we have heard from them recently.
   * Splitting the heartbeat into its own route would invite a client that toggles
   * online and never beats again — permanently willing, permanently unreachable,
   * and invisible to every candidate query.
   */
  @Patch()
  async update(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<{ isOnline: boolean; lastSeenAt: string }> {
    const input = setValetAvailabilitySchema.parse(body);

    const result = await this.setAvailability.execute({
      valetUserId: user.id,
      isOnline: input.isOnline,
      ...(input.location === undefined ? {} : { location: input.location }),
    });

    return { isOnline: result.isOnline, lastSeenAt: result.lastSeenAt.toISOString() };
  }
}
