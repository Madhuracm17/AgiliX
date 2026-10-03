import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ApprovalRequestDocument = ApprovalRequest & Document;

export enum ApprovalType {
  CREATE_TASK = 'create_task',
  DELETE_TASK = 'delete_task',
}

export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/**
 * A developer or tester asking a manager to create or delete a task. A task
 * that is waiting for approval does not exist yet (create), or still exists
 * unchanged (delete), until a manager approves.
 */
@Schema({ timestamps: true })
export class ApprovalRequest {
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  project: Types.ObjectId;

  @Prop({ enum: ApprovalType, required: true })
  type: ApprovalType;

  @Prop({ enum: ApprovalStatus, default: ApprovalStatus.PENDING })
  status: ApprovalStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  requestedBy: Types.ObjectId;

  /** The task to delete (delete requests only). */
  @Prop({ type: Types.ObjectId, default: null })
  task: Types.ObjectId | null;

  /** Shown in lists, so it is still readable after the task is gone. */
  @Prop({ default: '' })
  taskTitle: string;

  /** What to create when approved (create requests only). */
  @Prop({ type: Object, default: null })
  taskData: Record<string, unknown> | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  decidedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  decidedAt: Date | null;
}

export const ApprovalRequestSchema = SchemaFactory.createForClass(ApprovalRequest);
