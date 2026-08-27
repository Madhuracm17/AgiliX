import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  create(@Body() dto: CreateTaskDto) {
    return this.tasksService.create(dto);
  }

  @Get()
  findAllForProject(@Query('project') project: string) {
    return this.tasksService.findAllForProject(project);
  }

  @Get('backlog')
  findBacklog(@Query('project') project: string) {
    return this.tasksService.findBacklog(project);
  }

  @Get('sprint/:sprintId')
  findForSprint(@Param('sprintId') sprintId: string) {
    return this.tasksService.findForSprint(sprintId);
  }

  @Get('sprint/:sprintId/stats')
  getSprintStats(@Param('sprintId') sprintId: string) {
    return this.tasksService.getSprintStats(sprintId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasksService.update(id, dto);
  }

  @Patch(':id/sprint/:sprintId')
  assignToSprint(@Param('id') id: string, @Param('sprintId') sprintId: string) {
    return this.tasksService.assignToSprint(id, sprintId);
  }
}
