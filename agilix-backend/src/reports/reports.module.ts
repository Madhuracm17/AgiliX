import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { Sprint, SprintSchema } from '../sprints/schemas/sprint.schema';
import { TimeEntry, TimeEntrySchema } from '../time-entries/schemas/time-entry.schema';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: Sprint.name, schema: SprintSchema },
      { name: TimeEntry.name, schema: TimeEntrySchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
