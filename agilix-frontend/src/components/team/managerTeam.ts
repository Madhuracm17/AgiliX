import type { Project } from "../../api/projects";
import type { JoinedInvite } from "../../api/teamInvites";
import type { User } from "../../api/users";
import { sameId } from "../scrum/taskDisplay";

/** The people of a project, owner first, each person once. */
export function projectPeople(project: Pick<Project, "owner" | "members">): User[] {
  const people: User[] = [];
  for (const person of [project.owner, ...(project.members ?? [])]) {
    if (person && person._id && !people.some((p) => p._id === person._id)) people.push(person);
  }
  return people;
}

/**
 * The developers and testers of `manager` in one project: the people they asked
 * who joined. People with no request on record (added before requests existed)
 * go under the project's owner when the owner is a manager, otherwise under every
 * manager of the project.
 */
export function teamOfManager(
  project: Pick<Project, "owner" | "members">,
  joined: JoinedInvite[],
  manager: Pick<User, "_id">,
): User[] {
  const people = projectPeople(project);
  const managers = people.filter((p) => p.role === "manager");
  const ownerIsManager = managers.some((m) => sameId(m, project.owner));
  return people
    .filter((p) => p.role === "developer" || p.role === "tester")
    .filter((member) => {
      const by = [...joined].reverse().find((j) => sameId(j.invitee, member._id))?.invitedBy ?? null;
      if (by && managers.some((m) => sameId(m, by))) return sameId(by, manager._id);
      return ownerIsManager ? sameId(manager, project.owner) : true;
    });
}

/**
 * The manager(s) a developer or tester works under: whoever asked them to join,
 * otherwise the project's owner when the owner is a manager, otherwise every
 * manager of the project.
 */
export function managersOf(
  project: Pick<Project, "owner" | "members">,
  joined: JoinedInvite[],
  member: Pick<User, "_id">,
): User[] {
  const people = projectPeople(project);
  const managers = people.filter((p) => p.role === "manager");
  const by = [...joined].reverse().find((j) => sameId(j.invitee, member._id))?.invitedBy ?? null;
  const asker = by ? managers.find((m) => sameId(m, by)) : undefined;
  if (asker) return [asker];
  const owner = managers.find((m) => sameId(m, project.owner));
  return owner ? [owner] : managers;
}
