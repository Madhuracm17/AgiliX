import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProjectMethodology = 'scrum' | 'kanban';

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
}

export const ProjectSchema = SchemaFactory.createForClass(Project);