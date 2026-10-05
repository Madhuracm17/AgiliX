import { api } from "./client";

/** A message saved by the backend for the logged-in person. */
export interface ServerNotification {
  _id: string;
  text: string;
  detail?: string;
  link?: string;
  kind:
    | "review_returned"
    | "approval_requested"
    | "approval_decided"
    | "team_invite"
    | "team_invite_decided";
  createdAt: string;
}

export function getNotifications() {
  return api<ServerNotification[]>("/notifications");
}
