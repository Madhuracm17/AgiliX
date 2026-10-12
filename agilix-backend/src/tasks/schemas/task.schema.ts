import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TaskDocument = Task & Document;

export enum TaskStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  // Work is finished and waiting to be checked (Scrum Board "Review" column).
  REVIEW = 'review',
  DONE = 'done',
}

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

// What kind of work a task is (shown as a tag on the Scrum Board and backlog).
export enum TaskType {
  FRONTEND = 'frontend',
  BACKEND = 'backend',
  DATABASE = 'database',
  FEATURE = 'feature',
  BUG = 'bug',
  SECURITY = 'security',
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

  // When the task last reached Done (null while it is not Done). Used by the
  // Scrum burndown/burnup. Older tasks simply have no value.
  @Prop({ type: Date, default: null })
  completedAt?: Date | null;

  // When the task first moved to In Progress (kept if it later goes back).
  // Cycle time in the Kanban reports runs from here to Done. Older tasks have no value.
  @Prop({ type: Date, default: null })
  startedAt?: Date | null;

  // Every column change, oldest first: the Kanban cumulative flow diagram is
  // rebuilt from it. The task's start in To Do is its createdAt, so creation
  // adds no entry. Older tasks have an empty list.
  @Prop({ type: [{ status: { type: String, enum: TaskStatus }, at: Date, _id: false }], default: [] })
  statusHistory?: { status: TaskStatus; at: Date }[];

  // When the task was put into its current sprint. Tasks added after the
  // sprint started count as scope changes in the reports.
  @Prop({ type: Date, default: null })
  addedToSprintAt?: Date | null;

  // The comment a tester left when sending the task back from Review to In
  // Progress. Cleared when the task goes to Review again or is Done.
  @Prop({ type: Object, default: null })
  reviewNote?: { text: string; by: string; byName: string; at: Date } | null;

  // Every time someone reviewed the task (approved it, or sent it back from
  // Review). Lets a tester's report count the reviews they did.
  @Prop({ type: [Object], default: [] })
  reviews?: { by: string; outcome: 'approved' | 'sent_back'; at: Date }[];

  // Optional: older tasks simply have no type.
  @Prop({ type: String, enum: TaskType })
  type?: TaskType;
}

export const TaskSchema = SchemaFactory.createForClass(Task);
