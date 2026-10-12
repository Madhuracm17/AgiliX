import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Task, TaskSchema } from './schemas/task.schema';
import { Sprint, SprintSchema } from '../sprints/schemas/sprint.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      // Read-only use: checking a sprint before a task is added to it.
      { name: Sprint.name, schema: SprintSchema },
      // Read-only use: a Kanban project's WIP limit, checked before a task moves to In Progress.
      { name: Project.name, schema: ProjectSchema },
    ]),
    NotificationsModule,
    ApprovalsModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}