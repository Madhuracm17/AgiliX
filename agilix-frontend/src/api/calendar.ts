import { api } from "./client";

/* Google Calendar: each person connects their own calendar; managers see the team's meeting load. */

export interface MyCalendarStatus {
  /** The server has Google OAuth set up (GOOGLE_CLIENT_ID / SECRET). */
  configured: boolean;
  connected: boolean;
  /** Google refused the saved connection (revoked or expired): connect again. */
  needsReconnect: boolean;
  googleEmail: string | null;
  connectedAt: string | null;
}

export interface CalendarLoad {
  meetingHours: number;
  meetings: number;
  meetingDays: number;
  heaviestDayHours: number;
  avgHoursPerWorkday: number;
  lateNightMeetingHours: number;
  weekendMeetingHours: number;
  backToBackMeetings: number;
  fragmentedDays: number;
  outOfOfficeDays: number;
  next7Days: { meetingHours: number; meetings: number; outOfOfficeDays: number };
}

export function getMyCalendar() {
  return api<MyCalendarStatus>("/integrations/google-calendar/me");
}

/** Sends the browser to Google's consent page; Google sends it back to AgiliX afterwards. */
export async function connectMyCalendar(): Promise<void> {
  const { url } = await api<{ url: string }>("/integrations/google-calendar/connect", { method: "POST" });
  window.location.assign(url);
}

export function disconnectMyCalendar() {
  return api<{ connected: false }>("/integrations/google-calendar/me", { method: "DELETE" });
}
