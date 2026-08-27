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

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ enum: SprintStatus, default: SprintStatus.PLANNED })
  status: SprintStatus;

  // Points/day the team has historically completed, used as an input
  // to the AI sprint-risk prediction (see ai/ai.service.ts)
  @Prop({ default: 0 })
  teamVelocity: number;
}

export const SprintSchema = SchemaFactory.createForClass(Sprint);
