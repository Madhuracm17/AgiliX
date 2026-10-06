import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeamInvite, TeamInviteSchema } from './schemas/team-invite.schema';
import { TeamInvitesService } from './team-invites.service';
import { TeamInvitesController } from './team-invites.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: TeamInvite.name, schema: TeamInviteSchema }]),
    NotificationsModule,
  ],
  controllers: [TeamInvitesController],
  providers: [TeamInvitesService],
  exports: [TeamInvitesService],
})
export class TeamInvitesModule {}
