import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProjectMethodology = 'scrum' | 'kanban';
export type ProjectStatus = 'active' | 'on_hold' | 'completed';

export type ProjectDocument = Project & Document;

@Schema({ timestamps: true })
export class Project {
  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  owner: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  members: Types.ObjectId[];

  // Defaults to 'scrum' so existing projects created before this field
  // existed still load correctly instead of coming back as undefined.
  @Prop({ type: String, enum: ['scrum', 'kanban'], default: 'scrum' })
  methodology: ProjectMethodology;

  // Where the project stands. Older projects have no value and count as active.
  @Prop({ type: String, enum: ['active', 'on_hold', 'completed'], default: 'active' })
  status: ProjectStatus;

  // Kanban only: the most tasks allowed in the In Progress column at once
  // (the WIP limit). 0 means no limit. Older projects have no value: no limit.
  @Prop({ type: Number, default: 0, min: 0 })
  wipLimit: number;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);