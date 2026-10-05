import { useEffect, useState } from "react";
import { getProject } from "../../api/projects";
import type { User } from "../../api/users";

export type Person = Pick<User, "_id" | "name" | "email" | "role">;

/**
 * The people on one project (its owner and members), for the "Assignee"
 * dropdowns. Admins are left out: they run the workspace, they do not take tasks.
 */
export function useProjectPeople(projectId: string | undefined): Person[] {
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    getProject(projectId)
      .then((project) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const list: Person[] = [];
        for (const person of [project.owner, ...(project.members ?? [])]) {
          if (person && person._id && !seen.has(person._id) && person.role !== "admin") {
            seen.add(person._id);
            list.push({
              _id: person._id,
              name: person.name,
              email: person.email,
              role: person.role,
            });
          }
        }
        setPeople(list);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return people;
}

/** What a dropdown shows for a person: "Myself" for the logged-in person, otherwise the name. */
export function personLabel(person: { _id: string; name: string }, myId: string): string {
  return person._id === myId ? "Myself" : person.name;
}
