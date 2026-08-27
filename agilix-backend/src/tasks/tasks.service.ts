import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, TaskDocument, TaskStatus } from './schemas/task.schema';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  constructor(@InjectModel(Task.name) private taskModel: Model<TaskDocument>) {}

  create(dto: CreateTaskDto) {
    return new this.taskModel(dto).save();
  }

  findAllForProject(projectId: string) {
    return this.taskModel.find({ project: projectId }).populate('assignee', 'name email').exec();
  }

  // Backlog = tasks not yet pulled into a sprint
  findBacklog(projectId: string) {
    return this.taskModel.find({ project: projectId, sprint: null }).exec();
  }

  findForSprint(sprintId: string) {
    return this.taskModel.find({ sprint: sprintId }).populate('assignee', 'name email').exec();
  }

  async update(id: string, dto: UpdateTaskDto) {
    const task = await this.taskModel.findByIdAndUpdate(id, dto, { new: true });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  // Pull a backlog task into a sprint (Manager selects tasks for sprint)
  assignToSprint(taskId: string, sprintId: string) {
    return this.update(taskId, { sprint: sprintId } as UpdateTaskDto);
  }

  /**
   * Raw counts used by both the analytics dashboard (burndown/velocity charts)
   * and the AI sprint-risk prediction endpoint. Kept as pure data here —
   * no prediction logic lives in this service, that's in ai.service.ts.
   */
  async getSprintStats(sprintId: string) {
    const tasks = await this.taskModel.find({ sprint: sprintId }).exec();
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === TaskStatus.DONE).length;
    const inProgress = tasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length;
    const todo = tasks.filter((t) => t.status === TaskStatus.TODO).length;
    const totalStoryPoints = tasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);
    const completedStoryPoints = tasks
      .filter((t) => t.status === TaskStatus.DONE)
      .reduce((sum, t) => sum + (t.storyPoints || 0), 0);

    return { total, done, inProgress, todo, totalStoryPoints, completedStoryPoints };
  }
}
