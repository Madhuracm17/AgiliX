import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TimeEntryDocument = TimeEntry & Document;

@Schema({ timestamps: true })
export class TimeEntry {
  @Prop({ type: Types.ObjectId, ref: 'Task', required: true })
  task: Types.ObjectId;

  // Denormalized so project-level time reports don't need a Task lookup per entry.
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  project: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ required: true })
  startTime: Date;

  // null while the timer is still running
  @Prop({ default: null })
  endTime: Date | null;

  // Stored once stopped so totals don't need to be recomputed from dates every read.
  @Prop({ default: 0 })
  durationSeconds: number;
}

export const TimeEntrySchema = SchemaFactory.createForClass(TimeEntry);