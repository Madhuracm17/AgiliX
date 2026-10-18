import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { AccessService } from '../auth/access.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';
import { requireRole } from '../auth/roles';
import { UserRole } from '../users/schemas/user.schema';
import { BurnoutRiskService } from './burnout-risk.service';
import { SprintHealthService } from './sprint-health.service';
import { TeamContextService } from './team-context.service';

const TEAM_INSIGHTS_MESSAGE =
  'You do not have permission to view team insights. Please contact a manager or an admin.';

/**
 * AI team insights: the backend collects data from AgiliX and GitHub (MCP),
 * the LLM analyses it. Team-level, so managers and admins only, and only for
 * projects they can access. `?refresh=1` skips the 10-minute cache.
 */
@Controller('insights')
export class InsightsController {
  constructor(
    private readonly burnout: BurnoutRiskService,
    private readonly health: SprintHealthService,
    private readonly context: TeamContextService,
    private readonly access: AccessService,
  ) {}

  /** AI burnout risk per team member. `?days=` 7, 14 or 30 (default 14). */
  @Header('Cache-Control', 'no-store')
  @Get(':projectId/burnout')
  async burnoutRisk(
    @Param('projectId') projectId: string,
    @Query('days') days: string | undefined,
    @Query('refresh') refresh: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    requireRole(user, TEAM_INSIGHTS_MESSAGE, UserRole.MANAGER, UserRole.ADMIN);
    await this.access.assertProject(user, projectId);
    return this.burnout.assess(projectId, days, refresh === '1' || refresh === 'true');
  }

  /** AI sprint health (active sprint) or flow health (Kanban / no sprint). */
  @Header('Cache-Control', 'no-store')
  @Get(':projectId/sprint-health')
  async sprintHealth(
    @Param('projectId') projectId: string,
    @Query('refresh') refresh: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    requireRole(user, TEAM_INSIGHTS_MESSAGE, UserRole.MANAGER, UserRole.ADMIN);
    await this.access.assertProject(user, projectId);
    return this.health.assess(projectId, refresh === '1' || refresh === 'true');
  }

  /** The raw context payload the AI receives (no AI call). Useful for checking the numbers. */
  @Header('Cache-Control', 'no-store')
  @Get(':projectId/context')
  async teamContext(
    @Param('projectId') projectId: string,
    @Query('days') days: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    requireRole(user, TEAM_INSIGHTS_MESSAGE, UserRole.MANAGER, UserRole.ADMIN);
    await this.access.assertProject(user, projectId);
    return this.context.build(projectId, days);
  }
}
