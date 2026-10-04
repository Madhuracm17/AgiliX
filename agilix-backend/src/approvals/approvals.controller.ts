import { Body, Controller, Get, Header, Param, Patch, Query } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { DecideApprovalDto } from './dto/decide-approval.dto';
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

  /** Tasks that cannot be asked about again: a delete request is waiting, or was declined. */
  @Header('Cache-Control', 'no-store')
  @Get('pending-deletes')
  async pendingDeletes(@Query('project') project: string, @CurrentUser() user: AuthUser) {
    await this.access.assertProject(user, project);
    return this.approvals.deleteRequestState(project);
  }

  /**
   * Approving a create request can say where the task goes (action "backlog",
   * the default, or "sprint" for the current sprint). Approving a delete request
   * deletes the task.
   */
  @Patch(':id/approve')
  approve(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto?: DecideApprovalDto,
  ) {
    return this.approvals.decide(user, id, true, dto?.action);
  }

  /**
   * Rejecting a delete request can also move the task (action "backlog" or
   * "sprint"); without an action the task simply stays where it is.
   */
  @Patch(':id/reject')
  reject(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto?: DecideApprovalDto,
  ) {
    return this.approvals.decide(user, id, false, dto?.action);
  }
}
