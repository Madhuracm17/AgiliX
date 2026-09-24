import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { AiService } from './ai.service';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('sprint-risk/:sprintId')
  getSprintRisk(@Param('sprintId') sprintId: string) {
    if (!OBJECT_ID_PATTERN.test(sprintId)) {
      throw new BadRequestException('sprintId must be a valid MongoDB ObjectId');
    }
    return this.aiService.predictSprintRisk(sprintId);
  }
}