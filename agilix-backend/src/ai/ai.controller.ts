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
import { PriorityRecommendationService } from './priority-recommendation.service';
import { RecommendPriorityDto } from './dto/recommend-priority.dto';
import { TaskSuggestionService } from './task-suggestion.service';
import { SuggestTasksDto } from './dto/suggest-tasks.dto';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly storyPointEstimation: StoryPointEstimationService,
    private readonly priorityRecommendation: PriorityRecommendationService,
    private readonly taskSuggestions: TaskSuggestionService,
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

  // Returns a recommendation only — never creates or updates a task.
  @Post('priority')
  @HttpCode(200)
  recommendPriority(@Body() dto: RecommendPriorityDto) {
    return this.priorityRecommendation.recommend(dto);
  }

  // Returns suggestions only — never creates or updates a task.
  @Post('task-suggestions')
  @HttpCode(200)
  suggestTasks(@Body() dto: SuggestTasksDto) {
    return this.taskSuggestions.suggest(dto);
  }
}