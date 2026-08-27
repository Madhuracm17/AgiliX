import { api } from "./client";

export interface User {
  _id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "developer";
}

export interface CreateUserData {
  name: string;
  email: string;
  password: string;
  role?: "admin" | "manager" | "developer";
}

export function getUsers() {
  return api<User[]>("/users");
}

export function createUser(data: CreateUserData) {
  return api<User>("/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}