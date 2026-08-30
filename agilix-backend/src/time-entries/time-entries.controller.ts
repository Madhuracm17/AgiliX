import { Body, Controller, Get, Header, Param, Patch, Post, Query } from '@nestjs/common';
import { TimeEntriesService } from './time-entries.service';
import { StartTimerDto } from './dto/start-timer.dto';

@Controller('time-entries')
export class TimeEntriesController {
  constructor(private readonly timeEntriesService: TimeEntriesService) {}

  @Post('start')
  start(@Body() dto: StartTimerDto) {
    return this.timeEntriesService.start(dto);
  }

  @Patch(':id/stop')
  stop(@Param('id') id: string) {
    return this.timeEntriesService.stop(id);
  }

  // These values change every time the timer runs, so the browser must
  // never cache them — otherwise a refresh can show a stale total.
  @Header('Cache-Control', 'no-store')
  @Get('task/:taskId')
  findForTask(@Param('taskId') taskId: string) {
    return this.timeEntriesService.findForTask(taskId);
  }

  @Header('Cache-Control', 'no-store')
  @Get('task/:taskId/active')
  findActiveForTask(
    @Param('taskId') taskId: string,
    @Query('user') user: string,
  ) {
    return this.timeEntriesService.findActiveForTask(taskId, user);
  }

  @Header('Cache-Control', 'no-store')
  @Get('task/:taskId/total')
  getTaskTotal(@Param('taskId') taskId: string) {
    return this.timeEntriesService.getTaskTotal(taskId);
  }

  @Header('Cache-Control', 'no-store')
  @Get('project/:projectId')
  findForProject(@Param('projectId') projectId: string) {
    return this.timeEntriesService.findForProject(projectId);
  }
}