import { api } from "./client";

export interface User {
  _id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "developer" | "tester";
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