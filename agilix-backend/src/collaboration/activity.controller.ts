import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { AccessService } from '../auth/access.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';
import { ActivityService } from './activity.service';

/** The activity log: everyone on the project's team (and admins) can read it. */
@Controller('activity')
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly access: AccessService,
  ) {}

  /** Newest first. `?limit=50&before=<ISO date>` pages back. */
  @Header('Cache-Control', 'no-store')
  @Get('project/:projectId')
  async project(
    @Param('projectId') projectId: string,
    @Query('limit') limit: string | undefined,
    @Query('before') before: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    await this.access.assertProject(user, projectId);
    return this.activity.forProject(projectId, limit, before);
  }

  /** One task's history (shown next to its comments). */
  @Header('Cache-Control', 'no-store')
  @Get('task/:taskId')
  async task(@Param('taskId') taskId: string, @CurrentUser() user: AuthUser) {
    await this.access.assertTask(user, taskId);
    return this.activity.forTask(taskId);
  }
}
