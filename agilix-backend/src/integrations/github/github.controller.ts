import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { AccessService } from '../../auth/access.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/jwt-config';
import { requireRole } from '../../auth/roles';
import { UserRole } from '../../users/schemas/user.schema';
import { GithubActivityService } from './github-activity.service';
import { GithubMcpClient } from './github-mcp.client';

const TEAM_REPORTS_MESSAGE =
  'You do not have permission to view team reports. Please contact a manager or an admin.';

/** GitHub data, read through GitHub's MCP server. Team-level, so managers and admins only. */
@Controller('integrations/github')
export class GithubController {
  constructor(
    private readonly activity: GithubActivityService,
    private readonly github: GithubMcpClient,
    private readonly access: AccessService,
  ) {}

  /** Is GitHub connected? Lists the GitHub MCP tools AgiliX can use. */
  @Header('Cache-Control', 'no-store')
  @Get('status')
  async status(@CurrentUser() user: AuthUser) {
    requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER, UserRole.ADMIN);
    if (!this.github.isConfigured()) {
      return { configured: false, connected: false, tools: [] as string[] };
    }
    try {
      const tools = await this.github.listToolNames();
      return { configured: true, connected: true, tools };
    } catch (error) {
      return {
        configured: true,
        connected: false,
        tools: [] as string[],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** `?days=` is 7, 14 or 30 (default 14). */
  @Header('Cache-Control', 'no-store')
  @Get(':projectId/activity')
  async projectActivity(
    @Param('projectId') projectId: string,
    @Query('days') days: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER, UserRole.ADMIN);
    await this.access.assertProject(user, projectId);
    return this.activity.getActivity(projectId, days);
  }
}
