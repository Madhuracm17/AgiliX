import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CalendarConnectionDocument = CalendarConnection & Document;

/**
 * One person's Google Calendar connection. Kept in its own collection so the
 * User records (and the code that manages them) are not changed.
 */
@Schema({ timestamps: true, collection: 'calendarconnections' })
export class CalendarConnection {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  user: Types.ObjectId;

  /** The Google account that was connected (shown to the person, never to the AI). */
  @Prop({ default: '' })
  googleEmail: string;

  /** Google refresh token, encrypted with AES-256-GCM (see calendar-crypto.ts). */
  @Prop({ required: true, select: false })
  refreshTokenEnc: string;

  @Prop({ default: '' })
  scope: string;

  /** Set when Google refuses the token (revoked, expired), so the person is asked to reconnect. */
  @Prop({ type: String, default: null })
  lastError: string | null;
}

export const CalendarConnectionSchema = SchemaFactory.createForClass(CalendarConnection);
