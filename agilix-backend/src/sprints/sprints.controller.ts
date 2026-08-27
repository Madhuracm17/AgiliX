import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SprintsService } from './sprints.service';
import { CreateSprintDto } from './dto/create-sprint.dto';

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
}
