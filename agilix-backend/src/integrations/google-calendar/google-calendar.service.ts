import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Model, Types } from 'mongoose';
import { DAY_MS, teamTimeZone } from '../../insights/team-time';
import { CalendarLoad, computeCalendarLoad, LOOKAHEAD_DAYS, meetingDayKeys } from './calendar-load';
import { CalendarConnection, CalendarConnectionDocument } from './calendar-connection.schema';
import { decryptToken, deriveKey, emailFromIdToken, encryptToken, signState, verifyState } from './calendar-crypto';
import { CalendarTokenRevokedError, GoogleCalendarClient } from './google-calendar.client';

const CACHE_MS = 10 * 60_000;
const WINDOWS = [7, 14, 30];
const DEFAULT_DAYS = 14;

export type MemberCalendarStatus = 'ok' | 'not_connected' | 'needs_reconnect' | 'error';

export interface MemberCalendar {
  status: MemberCalendarStatus;
  load: CalendarLoad | null;
  /** Days with meetings in the window (for working-day streaks). */
  meetingDays: string[];
}

export interface ProjectCalendarReport {
  projectId: string;
  windowDays: number;
  since: string;
  until: string;
  timezone: string;
  configured: boolean;
  members: Array<{ userId: string; name: string; role: string; status: MemberCalendarStatus; load: CalendarLoad | null }>;
  team: { connected: number; members: number; meetingHours: number; next7DaysMeetingHours: number; outOfOfficeDaysNext7: number };
}

/**
 * Google Calendar for AgiliX: each person connects their own calendar once
 * (OAuth), and AgiliX reads only meeting times to measure meeting load for
 * sprint health and burnout risk. Titles and attendees are never read.
 */
@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger('Google Calendar');
  private readonly cache = new Map<string, { at: number; value: MemberCalendar }>();

  constructor(
    @InjectModel(CalendarConnection.name) private readonly connections: Model<CalendarConnectionDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly google: GoogleCalendarClient,
  ) {}

  isConfigured(): boolean {
    return this.google.isConfigured();
  }

  /** Is this person's calendar connected? */
  async status(userId: string) {
    const doc = await this.connections.findOne({ user: userId }).lean().exec();
    return {
      configured: this.google.isConfigured(),
      connected: !!doc,
      needsReconnect: !!doc?.lastError,
      googleEmail: doc?.googleEmail || null,
      connectedAt: (doc as { createdAt?: Date } | null)?.createdAt ?? null,
    };
  }

  /** The Google consent page address for this person. */
  connectUrl(userId: string): { url: string } {
    return { url: this.google.authUrl(signState(userId, this.key('state'))) };
  }

  /** Google sent the person back. Returns the AgiliX user id the connection was saved for. */
  async handleCallback(code: string | undefined, state: string | undefined): Promise<string> {
    const userId = verifyState(state ?? '', this.key('state'));
    if (!userId) throw new BadRequestException('This calendar link has expired or is not valid. Please try again.');
    if (!code) throw new BadRequestException('Google did not send an authorization code.');

    const { refreshToken, idToken, scope } = await this.google.exchangeCode(code);
    await this.connections.updateOne(
      { user: new Types.ObjectId(userId) },
      {
        $set: {
          refreshTokenEnc: encryptToken(refreshToken, this.key('token')),
          googleEmail: emailFromIdToken(idToken) ?? '',
          scope,
          lastError: null,
        },
      },
      { upsert: true },
    );
    this.forget(userId);
    this.logger.log(`Calendar connected for user ${userId}`);
    return userId;
  }

  async disconnect(userId: string): Promise<{ connected: false }> {
    const doc = await this.connections.findOne({ user: userId }).select('+refreshTokenEnc').exec();
    if (doc) {
      try {
        await this.google.revoke(decryptToken(doc.refreshTokenEnc, this.key('token')));
      } catch {
        // The token could not be read (key changed): deleting it is still right.
      }
      await doc.deleteOne();
    }
    this.forget(userId);
    return { connected: false };
  }

  /** Meeting load of one person. Never throws: a problem becomes a status. */
  async memberCalendar(userId: string, since: number, now: number): Promise<MemberCalendar> {
    const cacheKey = `${userId}:${Math.round((now - since) / DAY_MS)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

    const value = await this.readMember(userId, since, now);
    if (value.status === 'ok') this.cache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  /** Meeting load of a project's team (owner and members, admins left out). */
  async projectReport(projectId: string, daysParam?: number | string): Promise<ProjectCalendarReport> {
    if (!isValidObjectId(projectId)) throw new BadRequestException('Invalid project id');
    const asked = Number(daysParam);
    const days = WINDOWS.includes(asked) ? asked : DEFAULT_DAYS;
    const project = (await this.connection
      .model('Project')
      .findById(projectId)
      .select('owner members')
      .lean()
      .exec()) as { owner?: unknown; members?: unknown[] } | null;
    if (!project) throw new NotFoundException('Project not found');

    const ids = [...new Set([project.owner, ...(project.members ?? [])].filter((v) => v != null).map(String))].filter(
      (id) => isValidObjectId(id),
    );
    const users = (await this.connection
      .model('User')
      .find({ _id: { $in: ids } })
      .select('name role')
      .lean()
      .exec()) as Array<{ _id: unknown; name?: string; role?: string }>;

    const now = Date.now();
    const since = now - days * DAY_MS;
    const team = users.filter((u) => u.role !== 'admin');
    const members = await Promise.all(
      team.map(async (u) => {
        const cal = await this.memberCalendar(String(u._id), since, now);
        return { userId: String(u._id), name: u.name ?? '', role: u.role ?? 'developer', status: cal.status, load: cal.load };
      }),
    );
    const connected = members.filter((m) => m.load);
    const sum = (pick: (l: CalendarLoad) => number) =>
      Math.round(connected.reduce((total, m) => total + pick(m.load as CalendarLoad), 0) * 10) / 10;

    return {
      projectId,
      windowDays: days,
      since: new Date(since).toISOString(),
      until: new Date(now).toISOString(),
      timezone: teamTimeZone(),
      configured: this.google.isConfigured(),
      members,
      team: {
        connected: connected.length,
        members: members.length,
        meetingHours: sum((l) => l.meetingHours),
        next7DaysMeetingHours: sum((l) => l.next7Days.meetingHours),
        outOfOfficeDaysNext7: sum((l) => l.next7Days.outOfOfficeDays),
      },
    };
  }

  private async readMember(userId: string, since: number, now: number): Promise<MemberCalendar> {
    const none = (status: MemberCalendarStatus): MemberCalendar => ({ status, load: null, meetingDays: [] });
    if (!this.google.isConfigured()) return none('not_connected');

    const doc = await this.connections.findOne({ user: userId }).select('+refreshTokenEnc').exec();
    if (!doc) return none('not_connected');
    if (doc.lastError) return none('needs_reconnect');

    try {
      const accessToken = await this.google.accessToken(decryptToken(doc.refreshTokenEnc, this.key('token')));
      const events = await this.google.listEvents(
        accessToken,
        new Date(since),
        new Date(now + LOOKAHEAD_DAYS * DAY_MS),
      );
      const timeZone = teamTimeZone();
      return {
        status: 'ok',
        load: computeCalendarLoad(events, { since, now, timeZone }),
        meetingDays: meetingDayKeys(events, since, now, timeZone),
      };
    } catch (error) {
      if (error instanceof CalendarTokenRevokedError) {
        await this.connections.updateOne({ _id: doc._id }, { $set: { lastError: error.message } });
        return none('needs_reconnect');
      }
      this.logger.warn(`Calendar of user ${userId} unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return none('error');
    }
  }

  private forget(userId: string): void {
    for (const key of this.cache.keys()) if (key.startsWith(`${userId}:`)) this.cache.delete(key);
  }

  /** Separate keys for signing the OAuth state and for encrypting tokens. */
  private key(purpose: 'state' | 'token'): Buffer {
    const secret = process.env.CALENDAR_TOKEN_KEY?.trim() || process.env.JWT_SECRET?.trim();
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException(
        'Google Calendar needs CALENDAR_TOKEN_KEY (or JWT_SECRET) of at least 32 characters in .env.',
      );
    }
    return deriveKey(secret, `calendar-${purpose}`);
  }
}
