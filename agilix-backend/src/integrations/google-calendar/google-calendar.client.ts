import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import type { RawCalendarEvent } from './calendar-load';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** Read-only access to events, plus the email so people can see which account is linked. */
export const CALENDAR_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events.readonly'];

/** Only the fields AgiliX uses: times, type and the person's own answer. No titles, no attendees' details. */
const EVENT_FIELDS =
  'nextPageToken,items(status,eventType,transparency,start,end,attendees(self,responseStatus))';

const TIMEOUT_MS = 15_000;
const MAX_PAGES = 5;

/** Google said the refresh token is no longer valid (revoked, or expired after 7 days in "Testing" mode). */
export class CalendarTokenRevokedError extends Error {}

/**
 * Talks to Google: OAuth 2.0 (authorization-code flow with offline access) and
 * the Calendar API's events.list, read-only.
 */
@Injectable()
export class GoogleCalendarClient {
  private readonly logger = new Logger('Google Calendar');

  isConfigured(): boolean {
    return !!this.clientId() && !!this.clientSecret();
  }

  /** Where Google sends the person back to (must be listed in the Google Cloud OAuth client). */
  redirectUri(): string {
    const port = process.env.PORT || 3000;
    return (
      process.env.GOOGLE_REDIRECT_URI?.trim() ||
      `http://localhost:${port}/integrations/google-calendar/callback`
    );
  }

  authUrl(state: string): string {
    this.assertConfigured();
    const params = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: CALENDAR_SCOPES.join(' '),
      access_type: 'offline', // gives a refresh token, so AgiliX can read later without the person
      prompt: 'consent', // always return a refresh token, also on reconnect
      include_granted_scopes: 'true',
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{ refreshToken: string; idToken?: string; scope: string }> {
    this.assertConfigured();
    const data = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri(),
    });
    if (!data.refresh_token) {
      throw new BadGatewayException('Google did not return a refresh token. Please try connecting again.');
    }
    return { refreshToken: data.refresh_token, idToken: data.id_token, scope: data.scope ?? '' };
  }

  async accessToken(refreshToken: string): Promise<string> {
    this.assertConfigured();
    const data = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (!data.access_token) throw new BadGatewayException('Google did not return an access token.');
    return data.access_token;
  }

  /** Events of the person's primary calendar in [timeMin, timeMax), recurring events expanded. */
  async listEvents(accessToken: string, timeMin: Date, timeMax: Date): Promise<RawCalendarEvent[]> {
    const events: RawCalendarEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      try {
        const { data } = await axios.get<{ items?: RawCalendarEvent[]; nextPageToken?: string }>(EVENTS_URL, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 2500,
            fields: EVENT_FIELDS,
            ...(pageToken ? { pageToken } : {}),
          },
          timeout: TIMEOUT_MS,
        });
        events.push(...(data.items ?? []));
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      } catch (error) {
        throw this.toError('Reading the calendar', error);
      }
    }
    return events;
  }

  /** Best effort: tells Google to forget the grant. */
  async revoke(token: string): Promise<void> {
    try {
      await axios.post(REVOKE_URL, new URLSearchParams({ token }).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: TIMEOUT_MS,
      });
    } catch (error) {
      this.logger.warn(`Revoking the Google token failed: ${describe(error)}`);
    }
  }

  private async tokenRequest(fields: Record<string, string>) {
    try {
      const { data } = await axios.post<{
        access_token?: string;
        refresh_token?: string;
        id_token?: string;
        scope?: string;
      }>(
        TOKEN_URL,
        new URLSearchParams({ ...fields, client_id: this.clientId(), client_secret: this.clientSecret() }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: TIMEOUT_MS },
      );
      return data;
    } catch (error) {
      const code = (error as AxiosError<{ error?: string }>).response?.data?.error;
      if (code === 'invalid_grant') {
        throw new CalendarTokenRevokedError('Google no longer accepts this connection. Please reconnect your calendar.');
      }
      throw this.toError('Signing in to Google', error);
    }
  }

  private toError(action: string, error: unknown): Error {
    const status = (error as AxiosError).response?.status;
    if (status === 401) {
      return new CalendarTokenRevokedError('Google no longer accepts this connection. Please reconnect your calendar.');
    }
    this.logger.warn(`${action} failed: ${describe(error)}`);
    return new BadGatewayException(`${action} failed. Please try again in a moment.`);
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Google Calendar is not set up on this server (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env).',
      );
    }
  }

  private clientId(): string {
    return process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
  }

  private clientSecret(): string {
    return process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
  }
}

function describe(error: unknown): string {
  const ax = error as AxiosError<{ error?: string; error_description?: string }>;
  if (ax?.response) {
    return `HTTP ${ax.response.status} ${ax.response.data?.error ?? ''} ${ax.response.data?.error_description ?? ''}`.trim();
  }
  return error instanceof Error ? error.message : String(error);
}
