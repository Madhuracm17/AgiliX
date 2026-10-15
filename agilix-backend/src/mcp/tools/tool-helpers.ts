import { z } from 'zod';
import { AccessService } from '../../auth/access.service';
import { requireRole } from '../../auth/roles';
import { UserRole } from '../../users/schemas/user.schema';
import type { McpIdentity } from '../mcp-identity';
import type { McpToolContext } from '../mcp-tool.types';

/*
 * Shared pieces for the AgiliX business tools.
 *
 * Rule for every tool: resolve the acting user with ctx.user(), then run the
 * same AccessService / requireRole checks as the matching HTTP route, then call
 * the existing service. No business logic is duplicated here.
 */

/** A MongoDB id argument. Badly formed ids are rejected by AccessService with a 400. */
export const objectId = (what: string) =>
  z.string().trim().min(1).describe(`The ${what} id (24-character MongoDB ObjectId).`);

/** Same message the HTTP report routes use. */
export const TEAM_REPORTS_MESSAGE =
  'You do not have permission to view team reports. Please contact a manager or an admin.';

/** The acting user plus AccessService, which almost every tool needs. */
export async function actingUser(
  ctx: McpToolContext,
): Promise<{ user: McpIdentity; access: AccessService }> {
  const user = await ctx.user();
  return { user, access: ctx.get(AccessService) };
}

/** Team-wide reports: managers and admins only (as in ReportsController / AnalyticsController). */
export function requireTeamReports(user: McpIdentity): void {
  requireRole(user, TEAM_REPORTS_MESSAGE, UserRole.MANAGER, UserRole.ADMIN);
}

/* ---------- Output shaping ----------
 * Services return Mongoose documents. These helpers turn them into small,
 * predictable objects so the AI agent gets readable JSON and no internal
 * fields (review history, snapshots, version keys).
 */

type Doc = Record<string, unknown> & { toObject?: () => Record<string, unknown> };

function plain(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object') {
    const doc = input as Doc;
    return typeof doc.toObject === 'function' ? doc.toObject() : (doc as Record<string, unknown>);
  }
  return {};
}

function idOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'object' && '_id' in (value as object)) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}

/** { id, name, email } for a populated person, or { id } for a bare id. */
export function person(value: unknown): { id: string; name?: string; email?: string } | null {
  if (value == null) return null;
  const p = plain(value);
  const id = idOf(value);
  if (!id) return null;
  return {
    id,
    ...(typeof p.name === 'string' ? { name: p.name } : {}),
    ...(typeof p.email === 'string' ? { email: p.email } : {}),
  };
}

export function slimProject(input: unknown) {
  const p = plain(input);
  const members = Array.isArray(p.members) ? p.members : [];
  return {
    id: idOf(p._id),
    name: p.name,
    description: p.description ?? '',
    methodology: p.methodology,
    status: p.status ?? 'active',
    wipLimit: p.wipLimit ?? 0,
    githubRepo: p.githubRepo || null,
    owner: person(p.owner),
    members: members.map(person).filter(Boolean),
  };
}

export function slimTask(input: unknown) {
  const t = plain(input);
  return {
    id: idOf(t._id),
    title: t.title,
    description: t.description ?? '',
    type: t.type ?? null,
    status: t.status,
    priority: t.priority,
    storyPoints: t.storyPoints ?? 0,
    assignee: person(t.assignee),
    sprintId: idOf(t.sprint),
    startedAt: t.startedAt ?? null,
    completedAt: t.completedAt ?? null,
    createdAt: t.createdAt ?? null,
  };
}

export function slimSprint(input: unknown) {
  const s = plain(input);
  return {
    id: idOf(s._id),
    name: s.name,
    goal: s.goal ?? '',
    status: s.status,
    startDate: s.startDate,
    endDate: s.endDate,
    startedAt: s.startedAt ?? null,
    completedAt: s.completedAt ?? null,
    committedStoryPoints: s.committedStoryPoints ?? null,
    completedStoryPoints: s.completedStoryPoints ?? null,
  };
}
