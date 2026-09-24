import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { StoryPointEstimationService } from './story-point-estimation.service';
import { EstimateStoryPointsDto } from './dto/estimate-story-points.dto';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly storyPointEstimation: StoryPointEstimationService,
  ) {}

  @Get('sprint-risk/:sprintId')
  getSprintRisk(@Param('sprintId') sprintId: string) {
    if (!OBJECT_ID_PATTERN.test(sprintId)) {
      throw new BadRequestException('sprintId must be a valid MongoDB ObjectId');
    }
    return this.aiService.predictSprintRisk(sprintId);
  }

  // Returns a suggestion only — never creates or updates a task.
  @Post('story-points')
  @HttpCode(200)
  estimateStoryPoints(@Body() dto: EstimateStoryPointsDto) {
    return this.storyPointEstimation.estimate(dto);
  }
}