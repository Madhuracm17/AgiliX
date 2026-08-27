import { Controller, Get, Param } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('sprint-risk/:sprintId')
  getSprintRisk(@Param('sprintId') sprintId: string) {
    return this.aiService.predictSprintRisk(sprintId);
  }
}
