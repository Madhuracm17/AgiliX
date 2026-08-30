import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { TimeEntry, TimeEntrySchema } from '../time-entries/schemas/time-entry.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: TimeEntry.name, schema: TimeEntrySchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}