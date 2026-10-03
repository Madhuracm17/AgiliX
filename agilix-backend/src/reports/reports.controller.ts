import { Controller, Get, Header, Param } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';
import { requireRole } from '../auth/roles';
import { UserRole } from '../users/schemas/user.schema';

const TEAM_REPORTS_MESSAGE =
  'You do not have permission to view team reports. Please contact a manager.';
const MY_REPORT_MESSAGE =
  'You do not have permission to view reports. Please contact a manager.';

/**
 * Scrum reports. The team-wide reports (burndown, burnup, velocity, sprint
 * report) are for managers. Developers and testers get "my" report, which only
 * ever contains their own tasks and time. Admins do not see reports.
 */
@Controller('reports/scrum')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Header('Cache-Control', 'no-store')
  @Get('burndown/:sprintId')
  burndown(@Param('sprintId') sprintId: string, @CurrentUser() user: AuthUser) {
    requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER);
    return this.reportsService.getSeries(sprintId);
  }

  @Header('Cache-Control', 'no-store')
  @Get('burnup/:sprintId')
  burnup(@Param('sprintId') sprintId: string, @CurrentUser() user: AuthUser) {
    requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER);
    return this.reportsService.getSeries(sprintId);
  }

  /** Hours tracked per person in a sprint, against a limit. Managers only. */
  @Header('Cache-Control', 'no-store')
  @Get('burnout/:sprintId')
  burnout(@Param('sprintId') sprintId: string, @CurrentUser() user: AuthUser) {
    requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER);
    return this.reportsService.getBurnout(sprintId);
  }

  @Header('Cache-Control', 'no-store')
  @Get('sprint-report/:sprintId')
  sprintReport(@Param('sprintId') sprintId: string, @CurrentUser() user: AuthUser) {
    requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER);
    return this.reportsService.getSprintReport(sprintId);
  }

  @Header('Cache-Control', 'no-store')
  @Get('velocity/:projectId')
  velocity(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER);
    return this.reportsService.getVelocity(projectId);
  }

  /** The logged-in person's own report for a project. Not shown to admins. */
  @Header('Cache-Control', 'no-store')
  @Get('my/:projectId')
  my(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    requireRole(user, MY_REPORT_MESSAGE, UserRole.MANAGER, UserRole.DEVELOPER, UserRole.TESTER);
    return this.reportsService.getMyReport(projectId, user.userId);
  }
}
