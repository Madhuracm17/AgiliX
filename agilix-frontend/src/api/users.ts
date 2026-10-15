import { api } from "./client";

export interface User {
  _id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "developer" | "tester";
  /** GitHub login used to match commits and pull requests. Empty = not linked. */
  githubUsername?: string;
}

export interface CreateUserData {
  name: string;
  email: string;
  password: string;
  /** Sign-up can only create developers or testers. */
  role?: "developer" | "tester";
}

export function getUsers() {
  return api<User[]>("/users");
}

/** Admin only. */
export function setUserRole(id: string, role: User["role"]) {
  return api<User>(`/users/${id}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export function createUser(data: CreateUserData) {
  return api<User>("/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export function getUser(id: string) {
  return api<User>(`/users/${id}`);
}

/** Links the logged-in person's GitHub username ("" unlinks it). */
export function setMyGithubUsername(githubUsername: string) {
  return api<User>("/users/me/github", {
    method: "PATCH",
    body: JSON.stringify({ githubUsername }),
  });
}
