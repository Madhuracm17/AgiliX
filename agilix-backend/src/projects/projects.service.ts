import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Project, ProjectDocument } from './schemas/project.schema';
import { CreateProjectDto } from './dto/create-project.dto';

@Injectable()
export class ProjectsService {
  constructor(@InjectModel(Project.name) private projectModel: Model<ProjectDocument>) {}

  create(dto: CreateProjectDto) {
    return new this.projectModel(dto).save();
  }

  findAll() {
    return this.projectModel.find().populate('owner members', 'name email').exec();
  }

  async findOne(id: string) {
    const project = await this.projectModel.findById(id).populate('owner members', 'name email');
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async addMember(projectId: string, userId: string) {
    const project = await this.projectModel.findByIdAndUpdate(
      projectId,
      { $addToSet: { members: userId } },
      { new: true },
    );
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }
}
