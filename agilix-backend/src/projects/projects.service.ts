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
import { UpdateProjectDto } from './dto/update-project.dto';
import { AuthUser } from '../auth/jwt-config';
import { UserRole } from '../users/schemas/user.schema';
import { belongsTo } from '../auth/access.service';

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

  /** Edit the name, description or status. `user` must belong to the project (or be an admin). */
  async update(id: string, dto: UpdateProjectDto, user: AuthUser) {
    await this.findOne(id, user);
    const changes: Record<string, unknown> = {};
    if (dto.name !== undefined) changes.name = dto.name.trim();
    if (dto.description !== undefined) changes.description = dto.description.trim();
    if (dto.status !== undefined) changes.status = dto.status;
    const project = await this.projectModel.findByIdAndUpdate(id, changes, { new: true });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  /**
   * Deletes the project together with its tasks, sprints and time entries.
   * Admins can delete any project; a manager can delete only a project they own.
   * Ids may be stored as ObjectIds or as plain text, so both forms are matched.
   */
  async remove(id: string, user: AuthUser) {
    if (!isValidObjectId(id)) throw new BadRequestException('Invalid project id');
    const project = await this.projectModel.findById(id).select('owner').lean().exec();
    if (!project) throw new NotFoundException('Project not found');
    if (user.role !== UserRole.ADMIN && String(project.owner) !== user.userId) {
      throw new ForbiddenException(
        'Only an admin or the project owner can delete a project.',
      );
    }

    const match = { project: { $in: [new Types.ObjectId(id), id] } } as never;
    const db = this.projectModel.db;
    const [tasks, sprints, entries] = await Promise.all([
      db.model('Task').collection.deleteMany(match),
      db.model('Sprint').collection.deleteMany(match),
      db.model('TimeEntry').collection.deleteMany(match),
    ]);
    await this.projectModel.deleteOne({ _id: id });
    return {
      deleted: true,
      tasks: tasks.deletedCount,
      sprints: sprints.deletedCount,
      timeEntries: entries.deletedCount,
    };
  }

  async addMember(projectId: string, userId: string) {
    if (!isValidObjectId(userId)) throw new BadRequestException('Invalid user id');
    if (!(await this.projectModel.db.model('User').exists({ _id: userId }))) {
      throw new NotFoundException('That person does not exist');
    }
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
