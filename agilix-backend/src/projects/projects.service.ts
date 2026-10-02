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
      throw new ForbiddenException('You do not have access to this project. Please ask an admin to add you to the team.');
    }
    const project = await this.projectModel.findById(id).populate('owner members', 'name email');
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  /**
   * For the web pages. If the owner or a member comes back as a bare id instead of
   * { _id, name, email }, this looks that person up and fills the details in, so the
   * Team page and the Assignee dropdowns always get names. People who no longer exist
   * are left out. The AI services do not use this; they call findOne as before.
   */
  async withPeople(input: unknown): Promise<any> {
    type Plain = { owner?: unknown; members?: unknown[] };
    const list = (Array.isArray(input) ? input : [input]) as Array<{ toObject?: () => Plain }>;
    const plain = list.map((p) => (typeof p.toObject === 'function' ? p.toObject() : (p as Plain)));

    const isPerson = (v: unknown) => !!v && typeof v === 'object' && 'name' in (v as object);

    const missing = new Set<string>();
    for (const p of plain) {
      for (const v of [p.owner, ...(p.members ?? [])]) {
        if (v != null && !isPerson(v)) missing.add(String(v));
      }
    }

    const found = new Map<string, unknown>();
    const ids = [...missing].filter((id) => isValidObjectId(id)).map((id) => new Types.ObjectId(id));
    if (ids.length > 0) {
      const users = (await this.projectModel.db
        .model('User')
        .find({ _id: { $in: ids } })
        .select('name email')
        .lean()
        .exec()) as Array<{ _id: unknown }>;
      for (const u of users) found.set(String(u._id), u);
    }

    const fill = (v: unknown) => (isPerson(v) ? v : (found.get(String(v)) ?? null));
    const out = plain.map((p) => ({
      ...p,
      owner: fill(p.owner),
      members: (p.members ?? []).map(fill).filter((m) => m !== null),
    }));
    return Array.isArray(input) ? out : out[0];
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
