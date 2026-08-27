import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { SprintsModule } from '../sprints/sprints.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

@Module({
  imports: [TasksModule, SprintsModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
