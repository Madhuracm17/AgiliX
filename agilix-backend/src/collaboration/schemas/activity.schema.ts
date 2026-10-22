import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ActivityDocument = Activity & Document;

/** One line of a project's activity log, e.g. "Jovika moved “Login page” to Review". */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Activity {
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  project: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actor: Types.ObjectId;

  /** The actor's name when it happened (kept even if the account is renamed or removed). */
  @Prop({ default: '' })
  actorName: string;

  /** e.g. task.moved, sprint.started, comment.added (see activity-events.ts). */
  @Prop({ required: true })
  action: string;

  /** What happened, without the actor's name. */
  @Prop({ required: true })
  text: string;

  @Prop({ type: Types.ObjectId, ref: 'Task', default: null })
  task: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Sprint', default: null })
  sprint: Types.ObjectId | null;
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);
ActivitySchema.index({ project: 1, createdAt: -1 });
ActivitySchema.index({ task: 1, createdAt: -1 });
// MongoDB removes entries by itself after 180 days.
ActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });
