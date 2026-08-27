import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Sprint, SprintDocument } from './schemas/sprint.schema';
import { CreateSprintDto } from './dto/create-sprint.dto';

@Injectable()
export class SprintsService {
  constructor(@InjectModel(Sprint.name) private sprintModel: Model<SprintDocument>) {}

  create(dto: CreateSprintDto) {
    return new this.sprintModel(dto).save();
  }

  findAllForProject(projectId: string) {
    return this.sprintModel.find({ project: projectId }).exec();
  }

  async findOne(id: string) {
    const sprint = await this.sprintModel.findById(id);
    if (!sprint) throw new NotFoundException('Sprint not found');
    return sprint;
  }
}
