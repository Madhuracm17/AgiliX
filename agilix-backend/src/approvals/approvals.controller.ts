import { Controller, Get, Header, Param, Patch, Query } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { AccessService } from '../auth/access.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';

/**
 * Requests are made through the normal task routes (POST /tasks and
 * DELETE /tasks/:id answer a developer or tester with "pending approval").
 * These routes are for looking at the requests and deciding them.
 */
@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly access: AccessService,
  ) {}

  /** Requests on a project: everyone's for managers and admins, your own otherwise. */
  @Header('Cache-Control', 'no-store')
  @Get()
  async list(@Query('project') project: string, @CurrentUser() user: AuthUser) {
    await this.access.assertProject(user, project);
    return this.approvals.list(user, project);
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.approvals.decide(user, id, true);
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.approvals.decide(user, id, false);
  }
}
