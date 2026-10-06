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
import { TeamInvitesService } from '../team-invites/team-invites.service';

/** Fields of a person that the web pages need (the role tells managers from developers). */
const PERSON_FIELDS = 'name email role';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    private readonly invites: TeamInvitesService,
  ) {}

  /**
   * Whoever creates the project owns it. An admin picks managers, who are added
   * straight away. A manager picks developers and testers, who get a team request
   * and join once they accept.
   */
  async create(dto: CreateProjectDto, user: AuthUser) {
    const { members: chosen = [], ...rest } = dto;
    const ids = [...new Set(chosen)].filter((id) => id !== user.userId);

    const people = ids.length
      ? ((await this.projectModel.db
          .model('User')
          .find({ _id: { $in: ids } })
          .select('name role')
          .lean()
          .exec()) as unknown as Array<{ _id: unknown; role?: string }>)
      : [];
    if (people.length !== ids.length) {
      throw new BadRequestException('One of the chosen people does not exist.');
    }

    if (user.role === UserRole.ADMIN) {
      if (people.some((p) => p.role !== UserRole.MANAGER)) {
        throw new BadRequestException(
          'An admin can only add managers. The manager then invites developers and testers.',
        );
      }
      return new this.projectModel({ ...rest, owner: user.userId, members: ids }).save();
    }

    if (people.some((p) => p.role !== UserRole.DEVELOPER && p.role !== UserRole.TESTER)) {
      throw new BadRequestException('A manager can only ask developers and testers to join.');
    }
    const project = await new this.projectModel({ ...rest, owner: user.userId }).save();
    for (const id of ids) {
      await this.invites.send(user.userId, String(project._id), id);
    }
    return project;
  }

  async findAll(user: AuthUser) {
    if (user.role === UserRole.ADMIN) {
      return this.projectModel.find().populate('owner members', PERSON_FIELDS).exec();
    }

    const all = await this.projectModel.find().select('owner members').lean().exec();
    const visible = all.filter((p) => belongsTo(p, user.userId)).map((p) => p._id);
    return this.projectModel
      .find({ _id: { $in: visible } })
      .populate('owner members', PERSON_FIELDS)
      .exec();
  }

  /** `user` is left out by internal callers (the AI services), which skip the membership check. */
  async findOne(id: string, user?: AuthUser) {
    const access = await this.projectModel.findById(id).select('owner members').lean().exec();
    if (!access) throw new NotFoundException('Project not found');
    if (user && user.role !== UserRole.ADMIN && !belongsTo(access, user.userId)) {
      throw new ForbiddenException('You do not have access to this project. Please ask an admin to add you to the team.');
    }
    const project = await this.projectModel.findById(id).populate('owner members', PERSON_FIELDS);
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
        .select(PERSON_FIELDS)
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

  /** Admins add managers straight to a team. (Managers ask developers and testers instead.) */
  async addMember(projectId: string, userId: string) {
    if (!isValidObjectId(userId)) throw new BadRequestException('Invalid user id');
    const person = (await this.projectModel.db
      .model('User')
      .findById(userId)
      .select('role')
      .lean()
      .exec()) as unknown as { role?: string } | null;
    if (!person) throw new NotFoundException('That person does not exist');
    if (person.role !== UserRole.MANAGER) {
      throw new BadRequestException(
        'An admin can only add managers. A manager asks developers and testers to join.',
      );
    }
    const project = await this.projectModel.findByIdAndUpdate(
      projectId,
      { $addToSet: { members: userId } },
      { new: true },
    );
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  /**
   * Takes someone off the team. The owner cannot be removed, and a manager cannot
   * remove themselves or another manager (only an admin removes managers).
   */
  async removeMember(projectId: string, userId: string, user: AuthUser) {
    if (!isValidObjectId(projectId) || !isValidObjectId(userId)) {
      throw new BadRequestException('Invalid id');
    }
    const project = await this.projectModel.findById(projectId).select('owner').lean().exec();
    if (!project) throw new NotFoundException('Project not found');
    if (String(project.owner) === userId) {
      throw new BadRequestException('The project owner cannot be removed');
    }
    if (user.role === UserRole.MANAGER) {
      if (userId === user.userId) {
        throw new ForbiddenException('You cannot remove yourself from the team.');
      }
      const target = (await this.projectModel.db
        .model('User')
        .findById(userId)
        .select('role')
        .lean()
        .exec()) as unknown as { role?: string } | null;
      if (target?.role === UserRole.MANAGER) {
        throw new ForbiddenException('Only an admin can remove a manager from the team.');
      }
    }
    // Ids may be stored as ObjectIds or as plain text, so both forms are pulled.
    await this.projectModel.collection.updateOne(
      { _id: new Types.ObjectId(projectId) },
      { $pull: { members: { $in: [new Types.ObjectId(userId), userId] } } } as never,
    );
    return this.projectModel.findById(projectId).populate('owner members', PERSON_FIELDS);
  }
}
