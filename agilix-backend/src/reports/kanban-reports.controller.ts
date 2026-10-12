import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { KanbanReportsService } from './kanban-reports.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';
import { AccessService } from '../auth/access.service';
import { requireRole } from '../auth/roles';
import { UserRole } from '../users/schemas/user.schema';

const TEAM_REPORTS_MESSAGE =
  'You do not have permission to view team reports. Please contact a manager or an admin.';

/**
 * Kanban reports (cumulative flow, throughput, lead and cycle time). Team-wide,
 * so for managers and admins, like the Scrum team reports.
 */
@Controller('reports/kanban')
export class KanbanReportsController {
  constructor(
    private readonly kanbanReports: KanbanReportsService,
    private readonly access: AccessService,
  ) {}

  /** `?days=` is 14, 30 or 90 (default 30). */
  @Header('Cache-Control', 'no-store')
  @Get(':projectId')
  async report(
    @Param('projectId') projectId: string,
    @Query('days') days: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER, UserRole.ADMIN);
    await this.access.assertProject(user, projectId);
    return this.kanbanReports.getReport(projectId, days);
  }
}
