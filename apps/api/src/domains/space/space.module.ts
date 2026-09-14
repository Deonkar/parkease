import { Module } from '@nestjs/common';

import { ApprovalService } from './approval.service.js';
import { CreateSpaceCommand } from './commands/create-space.command.js';
import { DeleteSpaceCommand } from './commands/delete-space.command.js';
import { SetSpacePhotosCommand } from './commands/set-space-photos.command.js';
import { ToggleSpaceCommand } from './commands/toggle-space.command.js';
import { UpdateSpaceCommand } from './commands/update-space.command.js';
import { SpaceService } from './space.service.js';

@Module({
  providers: [
    SpaceService,
    ApprovalService,
    CreateSpaceCommand,
    UpdateSpaceCommand,
    DeleteSpaceCommand,
    SetSpacePhotosCommand,
    ToggleSpaceCommand,
  ],
  exports: [
    SpaceService,
    CreateSpaceCommand,
    UpdateSpaceCommand,
    DeleteSpaceCommand,
    SetSpacePhotosCommand,
    ToggleSpaceCommand,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SpaceModule {}
