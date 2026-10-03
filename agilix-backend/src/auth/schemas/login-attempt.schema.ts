import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LoginAttemptDocument = LoginAttempt & Document;

/**
 * Wrong-password attempts for one email address. It is kept per email (not per
 * user) so an email that is not registered behaves exactly like one that is,
 * and login cannot be used to find out who has an account.
 */
@Schema({ timestamps: true })
export class LoginAttempt {
  @Prop({ required: true, unique: true })
  email: string;

  /** Wrong passwords since the last successful login (or since the last lock ended). */
  @Prop({ default: 0 })
  count: number;

  /** While this is in the future, the account cannot log in. */
  @Prop({ type: Date, default: null })
  lockedUntil: Date | null;
}

export const LoginAttemptSchema = SchemaFactory.createForClass(LoginAttempt);
