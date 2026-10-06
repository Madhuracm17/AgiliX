import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TeamInviteDocument = TeamInvite & Document;

export enum InviteStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
}

/**
 * A manager asking a developer or tester to join a project's team. The person
 * is only added to the team when they accept.
 */
@Schema({ timestamps: true })
export class TeamInvite {
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  project: Types.ObjectId;

  /** The developer or tester who is asked. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  invitee: Types.ObjectId;

  /** The manager who sent the request. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  invitedBy: Types.ObjectId;

  @Prop({ enum: InviteStatus, default: InviteStatus.PENDING })
  status: InviteStatus;

  @Prop({ type: Date, default: null })
  decidedAt: Date | null;
}

export const TeamInviteSchema = SchemaFactory.createForClass(TeamInvite);
