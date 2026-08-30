import { Controller, Get, Header, Param } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Header('Cache-Control', 'no-store')
  @Get('summary/:projectId')
  getSummary(@Param('projectId') projectId: string) {
    return this.analyticsService.getProjectSummary(projectId);
  }

  @Header('Cache-Control', 'no-store')
  @Get('workload/:projectId')
  getWorkload(@Param('projectId') projectId: string) {
    return this.analyticsService.getWorkload(projectId);
  }
}