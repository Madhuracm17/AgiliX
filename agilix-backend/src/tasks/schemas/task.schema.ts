import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TaskDocument = Task & Document;

export enum TaskStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
}

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

@Schema({ timestamps: true })
export class Task {
  @Prop({ required: true })
  title: string;

  @Prop()
  description: string;

  @Prop({ enum: TaskStatus, default: TaskStatus.TODO })
  status: TaskStatus;

  @Prop({ enum: TaskPriority, default: TaskPriority.MEDIUM })
  priority: TaskPriority;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  project: Types.ObjectId;

  // null/undefined while the task sits in the backlog, unselected for a sprint
  @Prop({ type: Types.ObjectId, ref: 'Sprint', default: null })
  sprint: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  assignee: Types.ObjectId | null;

  @Prop({ default: 0 })
  storyPoints: number;
}

export const TaskSchema = SchemaFactory.createForClass(Task);
