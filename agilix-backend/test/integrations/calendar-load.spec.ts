import {
  computeCalendarLoad,
  countWorkdays,
  meetingDayKeys,
  mergeSpans,
  RawCalendarEvent,
  toMeeting,
} from '../../src/integrations/google-calendar/calendar-load';

const TZ = 'Asia/Kolkata'; // UTC+05:30, no daylight saving

/** A timed meeting on a 2026-10 day, in India time ("HH:MM"). */
function meeting(day: number, from: string, to: string, extra: Partial<RawCalendarEvent> = {}): RawCalendarEvent {
  const d = String(day).padStart(2, '0');
  return {
    status: 'confirmed',
    eventType: 'default',
    start: { dateTime: `2026-10-${d}T${from}:00+05:30` },
    end: { dateTime: `2026-10-${d}T${to}:00+05:30` },
    ...extra,
  };
}

// Window: Mon 12 Oct 00:00 to Mon 19 Oct 00:00 India time (5 working days + a weekend).
const SINCE = Date.parse('2026-10-12T00:00:00+05:30');
const NOW = Date.parse('2026-10-19T00:00:00+05:30');

describe('toMeeting', () => {
  it('accepts a normal timed meeting', () => {
    expect(toMeeting(meeting(13, '10:00', '11:00'))).not.toBeNull();
  });

  it.each([
    ['cancelled', { status: 'cancelled' }],
    ['declined by me', { attendees: [{ self: true, responseStatus: 'declined' }] }],
    ['marked free', { transparency: 'transparent' }],
    ['out of office', { eventType: 'outOfOffice' }],
    ['focus time', { eventType: 'focusTime' }],
  ])('ignores an event that is %s', (_label, extra) => {
    expect(toMeeting(meeting(13, '10:00', '11:00', extra as Partial<RawCalendarEvent>))).toBeNull();
  });

  it('ignores all-day events and broken times', () => {
    expect(toMeeting({ start: { date: '2026-10-13' }, end: { date: '2026-10-14' } })).toBeNull();
    expect(toMeeting(meeting(13, '11:00', '10:00'))).toBeNull();
  });

  it('ignores blocks longer than 10 hours', () => {
    expect(toMeeting(meeting(13, '08:00', '19:00'))).toBeNull();
  });

  it('keeps a meeting I accepted when others declined', () => {
    const event = meeting(13, '10:00', '11:00', {
      attendees: [
        { self: false, responseStatus: 'declined' },
        { self: true, responseStatus: 'accepted' },
      ],
    });
    expect(toMeeting(event)).not.toBeNull();
  });
});

describe('mergeSpans', () => {
  it('counts double-booked time once', () => {
    const merged = mergeSpans([
      { start: 0, end: 60 },
      { start: 30, end: 90 },
      { start: 120, end: 150 },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 90 },
      { start: 120, end: 150 },
    ]);
  });
});

describe('countWorkdays', () => {
  it('counts Monday to Friday only', () => {
    expect(countWorkdays(SINCE, NOW, TZ)).toBe(5);
  });
});

describe('computeCalendarLoad', () => {
  it('returns zeros for an empty calendar', () => {
    const load = computeCalendarLoad([], { since: SINCE, now: NOW, timeZone: TZ });
    expect(load.meetingHours).toBe(0);
    expect(load.meetings).toBe(0);
    expect(load.avgHoursPerWorkday).toBe(0);
    expect(load.next7Days).toEqual({ meetingHours: 0, meetings: 0, outOfOfficeDays: 0 });
  });

  it('measures hours, days, back-to-back meetings and busy days', () => {
    const events = [
      // Tue 13: four meetings, two of them back-to-back, one overlapping
      meeting(13, '09:00', '10:00'),
      meeting(13, '10:05', '11:00'), // back-to-back (5 min gap)
      meeting(13, '10:30', '11:30'), // overlaps: only 30 extra minutes
      meeting(13, '15:00', '16:00'),
      // Wed 14: one meeting late at night
      meeting(14, '22:30', '23:30'),
      // Sat 17: weekend meeting
      meeting(17, '11:00', '12:00'),
    ];
    const load = computeCalendarLoad(events, { since: SINCE, now: NOW, timeZone: TZ });

    // Tue: 09:00-10:00 + 10:05-11:30 + 15:00-16:00 = 1 + 1.4167 + 1 = 3.4 h
    expect(load.heaviestDayHours).toBe(3.4);
    expect(load.meetingHours).toBe(5.4); // 3.4 + 1 + 1
    expect(load.meetings).toBe(6);
    expect(load.meetingDays).toBe(3);
    expect(load.fragmentedDays).toBe(1); // Tuesday has 4 meetings
    expect(load.backToBackMeetings).toBe(1);
    expect(load.lateNightMeetingHours).toBe(1);
    expect(load.weekendMeetingHours).toBe(1);
    expect(load.avgHoursPerWorkday).toBe(1.1); // 5.4 h / 5 working days
  });

  it('separates the past window from the next 7 days', () => {
    const events = [
      meeting(16, '10:00', '11:00'), // in the window
      meeting(20, '10:00', '12:00'), // next week
      meeting(30, '10:00', '11:00'), // more than 7 days ahead: ignored
    ];
    const load = computeCalendarLoad(events, { since: SINCE, now: NOW, timeZone: TZ });
    expect(load.meetingHours).toBe(1);
    expect(load.next7Days.meetingHours).toBe(2);
    expect(load.next7Days.meetings).toBe(1);
  });

  it('counts out-of-office days, past and upcoming', () => {
    const events: RawCalendarEvent[] = [
      {
        eventType: 'outOfOffice',
        start: { dateTime: '2026-10-15T00:00:00+05:30' },
        end: { dateTime: '2026-10-17T00:00:00+05:30' },
      },
      {
        eventType: 'outOfOffice',
        start: { dateTime: '2026-10-21T00:00:00+05:30' },
        end: { dateTime: '2026-10-22T00:00:00+05:30' },
      },
    ];
    const load = computeCalendarLoad(events, { since: SINCE, now: NOW, timeZone: TZ });
    expect(load.outOfOfficeDays).toBe(2); // 15th and 16th
    expect(load.next7Days.outOfOfficeDays).toBe(1); // 21st
    expect(load.meetings).toBe(0); // out of office is not a meeting
  });

  it('cuts a meeting that is still running at the end of the window', () => {
    const running = {
      status: 'confirmed',
      start: { dateTime: '2026-10-18T23:30:00+05:30' },
      end: { dateTime: '2026-10-19T00:30:00+05:30' },
    };
    const load = computeCalendarLoad([running], { since: SINCE, now: NOW, timeZone: TZ });
    expect(load.meetingHours).toBe(0.5);
  });
});

describe('meetingDayKeys', () => {
  it('lists each day with a meeting once, in team time', () => {
    const days = meetingDayKeys(
      [meeting(13, '09:00', '10:00'), meeting(13, '15:00', '16:00'), meeting(14, '00:30', '01:00')],
      SINCE,
      NOW,
      TZ,
    );
    expect(days.sort()).toEqual(['2026-10-13', '2026-10-14']);
  });
});
