import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CommentDocument = Comment & Document;

export const COMMENT_MAX_LENGTH = 2000;

/** A comment on a task, written by a team member. */
@Schema({ timestamps: true })
export class Comment {
  @Prop({ type: Types.ObjectId, ref: 'Task', required: true, index: true })
  task: Types.ObjectId;

  /** Copied from the task so a project's comments can be found and counted quickly. */
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  project: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  author: Types.ObjectId;

  @Prop({ required: true, maxlength: COMMENT_MAX_LENGTH })
  text: string;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);
CommentSchema.index({ task: 1, createdAt: 1 });
