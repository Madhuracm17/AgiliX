import { Controller, ForbiddenException, Get, Header, Param, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';
import { AccessService } from '../auth/access.service';
import { requireRole } from '../auth/roles';
import { UserRole } from '../users/schemas/user.schema';

const TEAM_REPORTS_MESSAGE =
  'You do not have permission to view team reports. Please contact a manager or an admin.';
const MY_REPORT_MESSAGE =
  'You do not have permission to view reports. Please contact a manager.';

/**
 * Scrum reports. The team-wide reports (burndown, burnout, velocity, sprint
 * report) are for managers, and admins can view them. Developers and testers get "my" report, which only
 * ever contains their own tasks and time. Admins do not see reports.
 */
@Controller('reports/scrum')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly access: AccessService,
  ) {}

  @Header('Cache-Control', 'no-store')
  @Get('burndown/:sprintId')
  async burndown(@Param('sprintId') sprintId: string, @CurrentUser() user: AuthUser) {
    requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER, UserRole.ADMIN);
    await this.access.assertSprint(user, sprintId);
    return this.reportsService.getSeries(sprintId);
  }

  /** Hours tracked per person in a sprint, against a limit. Managers only. */
  @Header('Cache-Control', 'no-store')
  @Get('burnout/:sprintId')
  async burnout(@Param('sprintId') sprintId: string, @CurrentUser() user: AuthUser) {
    requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER, UserRole.ADMIN);
    await this.access.assertSprint(user, sprintId);
    return this.reportsService.getBurnout(sprintId);
  }

  @Header('Cache-Control', 'no-store')
  @Get('sprint-report/:sprintId')
  async sprintReport(@Param('sprintId') sprintId: string, @CurrentUser() user: AuthUser) {
    requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER, UserRole.ADMIN);
    await this.access.assertSprint(user, sprintId);
    return this.reportsService.getSprintReport(sprintId);
  }

  @Header('Cache-Control', 'no-store')
  @Get('velocity/:projectId')
  async velocity(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER, UserRole.ADMIN);
    await this.access.assertProject(user, projectId);
    return this.reportsService.getVelocity(projectId);
  }

  /**
   * The logged-in person's own report for a project. An admin can ask for one
   * developer's or tester's report with `?user=`, read only.
   */
  @Header('Cache-Control', 'no-store')
  @Get('my/:projectId')
  async my(
    @Param('projectId') projectId: string,
    @Query('user') target: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (target) {
      if (user.role !== UserRole.ADMIN) throw new ForbiddenException(MY_REPORT_MESSAGE);
      await this.access.assertProject(user, projectId);
      return this.reportsService.getUserReport(projectId, target);
    }
    requireRole(user, MY_REPORT_MESSAGE, UserRole.MANAGER, UserRole.DEVELOPER, UserRole.TESTER);
    await this.access.assertProject(user, projectId);
    return this.reportsService.getMyReport(projectId, user.userId, user.role);
  }
}
