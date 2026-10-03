import { Controller, Get, Header, Param } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';
import { AccessService } from '../auth/access.service';
import { requireRole } from '../auth/roles';
import { UserRole } from '../users/schemas/user.schema';

const TEAM_REPORTS_MESSAGE =
  'You do not have permission to view team reports. Please contact a manager.';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly access: AccessService,
  ) {}

  @Header('Cache-Control', 'no-store')
  @Get('summary/:projectId')
  async getSummary(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER);
    await this.access.assertProject(user, projectId);
    return this.analyticsService.getProjectSummary(projectId);
  }

  @Header('Cache-Control', 'no-store')
  @Get('workload/:projectId')
  async getWorkload(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER);
    await this.access.assertProject(user, projectId);
    return this.analyticsService.getWorkload(projectId);
  }
}