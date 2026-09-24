import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { SprintsModule } from '../sprints/sprints.module';
import { ProjectsModule } from '../projects/projects.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { LlmService } from './llm.service';
import { StoryPointEstimationService } from './story-point-estimation.service';

@Module({
  imports: [TasksModule, SprintsModule, ProjectsModule],
  controllers: [AiController],
  providers: [AiService, LlmService, StoryPointEstimationService],
  exports: [AiService, LlmService],
})
export class AiModule {}