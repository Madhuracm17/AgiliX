import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationDocument = Notification & Document;

/** A message for one person, shown in the bell. */
@Schema({ timestamps: true })
export class Notification {
  /** Who it is for. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  /** What happened, e.g. "Sam sent “Login page” back to In Progress". */
  @Prop({ required: true })
  text: string;

  /** Smaller line under the text (usually the project name, or the tester's comment). */
  @Prop({ default: '' })
  detail: string;

  /** Where clicking it goes, e.g. /projects/<id>/sprints. */
  @Prop({ default: '' })
  link: string;

  /** review_returned | approval_requested | approval_decided | team_invite | team_invite_decided */
  @Prop({ required: true })
  kind: string;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// MongoDB removes a notification by itself 30 days after it was created.
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
