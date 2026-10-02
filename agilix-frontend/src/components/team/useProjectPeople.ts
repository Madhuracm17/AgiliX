import { useEffect, useState } from "react";
import { getProject } from "../../api/projects";
import type { User } from "../../api/users";

export type Person = Pick<User, "_id" | "name" | "email">;

/**
 * The people on one project (its owner and members), for the "Assignee"
 * dropdowns. A manager only ever sees the team of the project they are in.
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
          if (person && person._id && !seen.has(person._id)) {
            seen.add(person._id);
            list.push({ _id: person._id, name: person.name, email: person.email });
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
