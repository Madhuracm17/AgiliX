import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { SprintsModule } from '../sprints/sprints.module';
import { TasksModule } from '../tasks/tasks.module';
import { BurnoutRiskService } from './burnout-risk.service';
import { InsightsController } from './insights.controller';
import { SprintHealthService } from './sprint-health.service';
import { StandupService } from './standup.service';
import { TeamContextService } from './team-context.service';

/**
 * AI team insights (the "LLM API → AI insights" part of the architecture):
 * TeamContextService aggregates AgiliX + GitHub (MCP) data into a context
 * payload, and the LLM turns it into burnout risk and sprint health.
 */
@Module({
  imports: [AiModule, IntegrationsModule, SprintsModule, TasksModule],
  controllers: [InsightsController],
  providers: [TeamContextService, BurnoutRiskService, SprintHealthService, StandupService],
  exports: [TeamContextService, BurnoutRiskService, SprintHealthService, StandupService],
})
export class InsightsModule {}
