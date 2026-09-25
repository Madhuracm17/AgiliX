import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

export enum UserRole {
  ADMIN = 'admin',
  MANAGER = 'manager',
  DEVELOPER = 'developer',
}

@Schema({
  timestamps: true,
  toJSON: {
    // Safety net: the password hash is never included in any API response.
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      delete ret.passwordHash;
      return ret;
    },
  },
})
export class User {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  email: string;

  // select: false → not loaded by queries unless explicitly requested
  // with .select('+passwordHash') (needed later by login only).
  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ enum: UserRole, default: UserRole.DEVELOPER })
  role: UserRole;
}

export const UserSchema = SchemaFactory.createForClass(User);