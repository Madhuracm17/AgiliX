import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query } from '@nestjs/common';
import { TeamInvitesService } from './team-invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';

@Controller('team-invites')
export class TeamInvitesController {
  constructor(private readonly invites: TeamInvitesService) {}

  /** A manager asks a developer or tester to join a project. */
  @Post('project/:projectId')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateInviteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invites.create(user, projectId, dto.userId);
  }

  /** Requests still waiting on a project (empty for developers and testers). */
  @Header('Cache-Control', 'no-store')
  @Get()
  forProject(@Query('project') project: string, @CurrentUser() user: AuthUser) {
    return this.invites.listForProject(user, project);
  }

  /** The requests waiting for the logged-in person. */
  @Header('Cache-Control', 'no-store')
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.invites.listMine(user);
  }

  @Patch(':id/accept')
  accept(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.invites.decide(user, id, true);
  }

  @Patch(':id/decline')
  decline(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.invites.decide(user, id, false);
  }

  /** Withdraw a request that has not been answered yet. */
  @Delete(':id')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.invites.cancel(user, id);
  }
}
