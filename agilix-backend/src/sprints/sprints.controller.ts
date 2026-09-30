import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SprintsService } from './sprints.service';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import { CompleteSprintDto } from './dto/complete-sprint.dto';

@Controller('sprints')
export class SprintsController {
  constructor(private readonly sprintsService: SprintsService) {}

  @Post()
  create(@Body() dto: CreateSprintDto) {
    return this.sprintsService.create(dto);
  }

  @Get()
  findAllForProject(@Query('project') project: string) {
    return this.sprintsService.findAllForProject(project);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sprintsService.findOne(id);
  }

  /** Edit name, goal or dates (not allowed once completed). */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSprintDto) {
    return this.sprintsService.update(id, dto);
  }

  /** planned → active (only one active sprint per project). */
  @Patch(':id/start')
  start(@Param('id') id: string) {
    return this.sprintsService.start(id);
  }

  /**
   * active → completed. Unfinished tasks go to the planned sprint given in
   * { moveUnfinishedTo }, or back to the backlog when it is left out.
   */
  @Patch(':id/complete')
  complete(@Param('id') id: string, @Body() dto: CompleteSprintDto) {
    return this.sprintsService.complete(id, dto);
  }
}