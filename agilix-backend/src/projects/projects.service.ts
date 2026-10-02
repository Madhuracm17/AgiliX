import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Project, ProjectDocument } from './schemas/project.schema';
import { CreateProjectDto } from './dto/create-project.dto';
import { AuthUser } from '../auth/jwt-config';
import { UserRole } from '../users/schemas/user.schema';

/** The two fields that decide who may see a project. */
interface ProjectAccess {
  _id: unknown;
  owner?: unknown;
  members?: unknown[];
}

/** True when the user owns the project or is on its member list. */
function belongsTo(project: ProjectAccess, userId: string): boolean {
  // Ids are compared as text because older records may store them as strings.
  if (project.owner != null && String(project.owner) === userId) return true;
  return (project.members ?? []).some((m) => String(m) === userId);
}

@Injectable()
export class ProjectsService {
  constructor(@InjectModel(Project.name) private projectModel: Model<ProjectDocument>) {}

  create(dto: CreateProjectDto, ownerId: string) {
    return new this.projectModel({ ...dto, owner: ownerId }).save();
  }

  async findAll(user: AuthUser) {
    if (user.role === UserRole.ADMIN) {
      return this.projectModel.find().populate('owner members', 'name email').exec();
    }

    const all = await this.projectModel.find().select('owner members').lean().exec();
    const visible = all.filter((p) => belongsTo(p, user.userId)).map((p) => p._id);
    return this.projectModel
      .find({ _id: { $in: visible } })
      .populate('owner members', 'name email')
      .exec();
  }

  /** `user` is left out by internal callers (the AI services), which skip the membership check. */
  async findOne(id: string, user?: AuthUser) {
    const access = await this.projectModel.findById(id).select('owner members').lean().exec();
    if (!access) throw new NotFoundException('Project not found');
    if (user && user.role !== UserRole.ADMIN && !belongsTo(access, user.userId)) {
      throw new ForbiddenException('You are not a member of this project');
    }
    const project = await this.projectModel.findById(id).populate('owner members', 'name email');
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async addMember(projectId: string, userId: string) {
    if (!isValidObjectId(userId)) throw new BadRequestException('Invalid user id');
    const project = await this.projectModel.findByIdAndUpdate(
      projectId,
      { $addToSet: { members: userId } },
      { new: true },
    );
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async removeMember(projectId: string, userId: string) {
    if (!isValidObjectId(projectId) || !isValidObjectId(userId)) {
      throw new BadRequestException('Invalid id');
    }
    const project = await this.projectModel.findById(projectId).select('owner').lean().exec();
    if (!project) throw new NotFoundException('Project not found');
    if (String(project.owner) === userId) {
      throw new BadRequestException('The project owner cannot be removed');
    }
    // Ids may be stored as ObjectIds or as plain text, so both forms are pulled.
    await this.projectModel.collection.updateOne(
      { _id: new Types.ObjectId(projectId) },
      { $pull: { members: { $in: [new Types.ObjectId(userId), userId] } } } as never,
    );
    return this.projectModel.findById(projectId).populate('owner members', 'name email');
  }
}
