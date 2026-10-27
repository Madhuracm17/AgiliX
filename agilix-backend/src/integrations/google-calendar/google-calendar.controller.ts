import { Controller, Delete, Get, Header, Logger, Param, Post, Query, Res } from '@nestjs/common';
import { AccessService } from '../../auth/access.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/jwt-config';
import { Public } from '../../auth/public.decorator';
import { requireRole } from '../../auth/roles';
import { UserRole } from '../../users/schemas/user.schema';
import { GoogleCalendarService } from './google-calendar.service';

const TEAM_REPORTS_MESSAGE =
  'You do not have permission to view team reports. Please contact a manager or an admin.';

/** Where the browser goes after Google: the AgiliX web app. */
function frontendUrl(): string {
  return (process.env.FRONTEND_URL?.trim() || 'http://localhost:5173').replace(/\/+$/, '');
}

/**
 * Google Calendar connection.
 *  - Everyone connects or disconnects their OWN calendar.
 *  - The team's meeting load is a team report: managers and admins only.
 */
@Controller('integrations/google-calendar')
export class GoogleCalendarController {
  private readonly logger = new Logger('Google Calendar');

  constructor(
    private readonly calendar: GoogleCalendarService,
    private readonly access: AccessService,
  ) {}

  @Header('Cache-Control', 'no-store')
  @Get('me')
  status(@CurrentUser() user: AuthUser) {
    return this.calendar.status(user.userId);
  }

  /** Returns the Google consent page address; the browser then goes there. */
  @Post('connect')
  connect(@CurrentUser() user: AuthUser) {
    return this.calendar.connectUrl(user.userId);
  }

  @Delete('me')
  disconnect(@CurrentUser() user: AuthUser) {
    return this.calendar.disconnect(user.userId);
  }

  /**
   * Google redirects the browser here (no AgiliX login token on this request),
   * so it is public. The signed `state` says which AgiliX user started it.
   */
  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: { redirect: (url: string) => void },
  ) {
    if (error) return res.redirect(`${frontendUrl()}/?calendar=cancelled`);
    try {
      await this.calendar.handleCallback(code, state);
      return res.redirect(`${frontendUrl()}/?calendar=connected`);
    } catch (err) {
      this.logger.warn(`Calendar callback failed: ${err instanceof Error ? err.message : String(err)}`);
      return res.redirect(`${frontendUrl()}/?calendar=failed`);
    }
  }

  /** Meeting load of the project's team. `?days=` is 7, 14 or 30 (default 14). */
  @Header('Cache-Control', 'no-store')
  @Get(':projectId/load')
  async projectLoad(
    @Param('projectId') projectId: string,
    @Query('days') days: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER, UserRole.ADMIN);
    await this.access.assertProject(user, projectId);
    return this.calendar.projectReport(projectId, days);
  }
}
