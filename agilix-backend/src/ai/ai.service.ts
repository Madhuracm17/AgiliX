import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { TasksService } from '../tasks/tasks.service';
import { SprintsService } from '../sprints/sprints.service';

export type RiskLevel = 'green' | 'yellow' | 'red';

export interface SprintRiskResult {
  risk: RiskLevel;
  reasoning: string;
  completionForecastPercent: number;
}

const FALLBACK_MODELS = [
  'openai/gpt-oss-20b:free',
  'google/gemma-4-26b-a4b:free',
  'google/gemma-4-31b:free',
  'inclusionai/ling-3.0-flash:free',
  'poolside/laguna-xs-2.1:free',
];

@Injectable()
export class AiService {
  constructor(
    private readonly tasksService: TasksService,
    private readonly sprintsService: SprintsService,
  ) {}

  async predictSprintRisk(
    sprintId: string,
  ): Promise<SprintRiskResult> {
    const sprint = await this.sprintsService.findOne(sprintId);
    const stats = await this.tasksService.getSprintStats(sprintId);

    const now = new Date();
    const start = new Date(sprint.startDate);
    const end = new Date(sprint.endDate);

    const totalDays = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 86400000),
    );

    const daysElapsed = Math.max(
      0,
      Math.round((now.getTime() - start.getTime()) / 86400000),
    );

    const daysRemaining = Math.max(
      0,
      totalDays - daysElapsed,
    );

    const prompt = `
You are an Agile Coach AI.

Analyze this sprint and respond ONLY with valid JSON.

Sprint Name:
${sprint.name}

Days:
Total: ${totalDays}
Elapsed: ${daysElapsed}
Remaining: ${daysRemaining}

Tasks:
Total: ${stats.total}
Done: ${stats.done}
In Progress: ${stats.inProgress}
Todo: ${stats.todo}

Story Points:
Total: ${stats.totalStoryPoints}
Completed: ${stats.completedStoryPoints}

Velocity:
${sprint.teamVelocity}

Return ONLY:

{
  "risk":"green",
  "reasoning":"short explanation",
  "completionForecastPercent":85
}
`;

    let lastError: any = null;

    for (const model of FALLBACK_MODELS) {
      try {
        console.log(`Trying model: ${model}`);

        const response = await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            model,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'http://localhost:3000',
              'X-Title': 'Agilix',
            },
            timeout: 20000,
          },
        );

        const raw =
          response.data.choices[0].message.content;

        const cleaned = raw
          .replace(/```json/g, '')
          .replace(/```/g, '')
          .trim();

        console.log('AI Response:');
        console.log(cleaned);

        return JSON.parse(cleaned);
      } catch (err: any) {
        lastError = err;

        console.log('==============================');
        console.log(`Model failed: ${model}`);
        console.log(err.response?.data || err.message);
        console.log('==============================');
      }
    }

    console.log('All models failed.');

    return {
      risk: 'yellow',
      reasoning: 'AI request failed.',
      completionForecastPercent: 50,
    };
  }
}