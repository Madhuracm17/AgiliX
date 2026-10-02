import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SprintDocument = Sprint & Document;

export enum SprintStatus {
  PLANNED = 'planned',
  ACTIVE = 'active',
  COMPLETED = 'completed',
}

@Schema({ timestamps: true })
export class Sprint {
  @Prop({ required: true })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  project: Types.ObjectId;

  // What the team wants to achieve in this sprint (optional).
  @Prop({ default: '' })
  goal: string;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  // planned → active (Start Sprint) → completed (Complete Sprint).
  // Only one sprint per project can be active at a time.
  @Prop({ enum: SprintStatus, default: SprintStatus.PLANNED })
  status: SprintStatus;

  // When the sprint was actually started / completed (null until then).
  // Used later for velocity and burndown.
  @Prop({ type: Date, default: null })
  startedAt: Date | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  // Snapshot taken when the sprint is completed, before unfinished tasks
  // go back to the backlog, so the sprint's history is not lost.
  @Prop({ type: Number, default: null })
  committedStoryPoints: number | null;

  @Prop({ type: Number, default: null })
  completedStoryPoints: number | null;

  // Copy of the sprint's tasks taken when it is completed, because unfinished
  // tasks move on to another sprint. The Scrum reports (burndown, burnup,
  // sprint report) read this for completed sprints. Empty for sprints that were
  // completed before this existed.
  @Prop({ type: [Object], default: [] })
  snapshot: Record<string, unknown>[];

  // Points/day the team has historically completed, used as an input
  // to the AI sprint-risk prediction (see ai/ai.service.ts)
  @Prop({ default: 0 })
  teamVelocity: number;
}

export const SprintSchema = SchemaFactory.createForClass(Sprint);