import type { BurnoutReport, SeriesDay, VelocityReport } from "../../api/reports";

const WIDTH = 640;
const HEIGHT = 290;
const PAD = { top: 16, right: 16, bottom: 58, left: 56 };

const ACCENT = "#c4a04d";
const MUTED = "#9a9d8f";
const GOOD = "#829172";
const CLAY = "#b98262";
const AXIS = "#4a4f46";

/** The two axis titles: one under the plot, one rotated beside it. */
function AxisTitles({ xLabel, yLabel }: { xLabel: string; yLabel: string }) {
  const plotMidY = PAD.top + (HEIGHT - PAD.top - PAD.bottom) / 2;
  const plotMidX = PAD.left + (WIDTH - PAD.left - PAD.right) / 2;
  return (
    <g fontSize="12" fontWeight="600" fill={AXIS}>
      <text x={plotMidX} y={HEIGHT - 8} textAnchor="middle">
        {xLabel}
      </text>
      <text transform={`translate(14 ${plotMidY}) rotate(-90)`} textAnchor="middle">
        {yLabel}
      </text>
    </g>
  );
}

/** "2026-03-24" -> "Mar 24" */
function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

interface Line {
  name: string;
  color: string;
  dashed?: boolean;
  values: (number | null)[];
}

/** 0.5 -> "30m", 2.25 -> "2.25h". Short times read better in minutes. */
export function formatHours(hours: number): string {
  return hours < 1 ? `${Math.round(hours * 60)}m` : `${Math.round(hours * 100) / 100}h`;
}

/**
 * A top for the chart's scale that divides into four whole steps, so every grid
 * line is a clean number (12 -> 0, 3, 6, 9, 12 rather than 0, 3.75, 7.5 ...).
 */
function niceMax(value: number): number {
  const step = value <= 20 ? 4 : value <= 40 ? 8 : value <= 100 ? 20 : 40;
  return Math.max(step, Math.ceil(value / step) * step);
}

function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="rpt-legend">
      {items.map((item) => (
        <li key={item.name}>
          <span
            className={`rpt-swatch ${item.dashed ? "rpt-swatch-dashed" : ""}`}
            style={{ background: item.dashed ? "transparent" : item.color, borderColor: item.color }}
          />
          {item.name}
        </li>
      ))}
    </ul>
  );
}

function LineChart({ title, days, lines }: { title: string; days: SeriesDay[]; lines: Line[] }) {
  const all = lines.flatMap((l) => l.values).filter((v): v is number => v !== null);
  const max = niceMax(Math.max(0, ...all));
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (days.length > 1 ? (i / (days.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f * 10) / 10);
  const labelEvery = Math.max(1, Math.ceil(days.length / 7));

  return (
    <div className="rpt-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} stroke="#e6dfcd" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b6f62">
              {t}
            </text>
          </g>
        ))}

        {days.map((day, i) =>
          i % labelEvery === 0 || i === days.length - 1 ? (
            <text key={day.date} x={x(i)} y={HEIGHT - PAD.bottom + 18} textAnchor="middle" fontSize="11" fill="#6b6f62">
              {shortDate(day.date)}
            </text>
          ) : null,
        )}

        {lines.map((line) => {
          let path = "";
          line.values.forEach((value, i) => {
            if (value === null) return;
            const started = path !== "" && line.values[i - 1] !== null;
            path += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(value).toFixed(1)} `;
          });
          return (
            <path
              key={line.name}
              d={path}
              fill="none"
              stroke={line.color}
              strokeWidth={line.dashed ? 1.5 : 2.5}
              strokeDasharray={line.dashed ? "5 4" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
        <AxisTitles xLabel="Date" yLabel="Story points" />
      </svg>
      <Legend items={lines} />
    </div>
  );
}

/** Remaining points against the ideal line. */
export function BurndownChart({ days }: { days: SeriesDay[] }) {
  return (
    <LineChart
      title="Sprint burndown"
      days={days}
      lines={[
        { name: "Ideal", color: MUTED, dashed: true, values: days.map((d) => d.ideal) },
        { name: "Remaining", color: ACCENT, values: days.map((d) => d.remaining) },
      ]}
    />
  );
}

/** Hours tracked per person in the sprint, against the hour limit. Over the limit turns clay. */
export function BurnoutChart({ report }: { report: BurnoutReport }) {
  const people = report.people;
  const top = Math.max(report.limitHours, ...people.map((p) => p.hours));
  // Small limits (like 30 minutes) need a finer scale than the 5-hour steps used for big ones.
  const max = top <= 1 ? 1 : top <= 2 ? 2 : niceMax(top);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const group = plotW / Math.max(1, people.length);
  const bar = Math.min(48, group * 0.55);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f * 100) / 100);
  const colorOf = (level: "ok" | "near" | "high") =>
    level === "high" ? CLAY : level === "near" ? ACCENT : GOOD;

  return (
    <div className="rpt-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Team workload in hours">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} stroke="#e6dfcd" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b6f62">
              {t}
            </text>
          </g>
        ))}

        {people.map((p, i) => {
          const cx = PAD.left + group * i + group / 2;
          return (
            <g key={p.userId}>
              <rect
                x={cx - bar / 2}
                y={y(p.hours)}
                width={bar}
                height={PAD.top + plotH - y(p.hours)}
                fill={colorOf(p.level)}
                rx="3"
              />
              <text x={cx} y={y(p.hours) - 5} textAnchor="middle" fontSize="11" fontWeight="600" fill={AXIS}>
                {formatHours(p.hours)}
              </text>
              <text x={cx} y={HEIGHT - PAD.bottom + 18} textAnchor="middle" fontSize="11" fill="#6b6f62">
                {p.name.length > 12 ? `${p.name.slice(0, 11)}…` : p.name}
              </text>
            </g>
          );
        })}

        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={y(report.limitHours)}
          y2={y(report.limitHours)}
          stroke={CLAY}
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />

        <AxisTitles xLabel="Team member" yLabel="Hours tracked" />
      </svg>
      <Legend
        items={[
          { name: "Within limit", color: GOOD },
          { name: "Near limit", color: ACCENT },
          { name: "Over limit", color: CLAY },
          { name: `Limit (${formatHours(report.limitHours)})`, color: CLAY, dashed: true },
        ]}
      />
    </div>
  );
}

/**
 * Committed against completed points for each finished sprint. Every bar is
 * labelled with its number, a dashed line marks the average of the last three
 * sprints, and a small table below spells the same figures out.
 */
export function VelocityChart({
  sprints,
  average,
}: {
  sprints: VelocityReport["sprints"];
  average?: number;
}) {
  const top = Math.max(0, average ?? 0, ...sprints.flatMap((s) => [s.committed, s.completed]));
  const max = niceMax(top);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const group = plotW / Math.max(1, sprints.length);
  const bar = Math.min(56, group / 2.6);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f * 10) / 10);
  const showAverage = average !== undefined && average > 0 && sprints.length > 1;

  return (
    <div className="rpt-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Team velocity">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} stroke="#e6dfcd" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b6f62">
              {t}
            </text>
          </g>
        ))}
        {sprints.map((s, i) => {
          const cx = PAD.left + group * i + group / 2;
          return (
            <g key={s.sprintId}>
              <rect x={cx - bar - 2} y={y(s.committed)} width={bar} height={PAD.top + plotH - y(s.committed)} fill={MUTED} rx="3" />
              <rect x={cx + 2} y={y(s.completed)} width={bar} height={PAD.top + plotH - y(s.completed)} fill={ACCENT} rx="3" />
              <text x={cx - bar / 2 - 2} y={y(s.committed) - 5} textAnchor="middle" fontSize="11" fontWeight="600" fill={AXIS}>
                {s.committed}
              </text>
              <text x={cx + bar / 2 + 2} y={y(s.completed) - 5} textAnchor="middle" fontSize="11" fontWeight="600" fill={AXIS}>
                {s.completed}
              </text>
              <text x={cx} y={HEIGHT - PAD.bottom + 18} textAnchor="middle" fontSize="11" fill="#6b6f62">
                {s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name}
              </text>
            </g>
          );
        })}
        {showAverage && (
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={y(average as number)}
            y2={y(average as number)}
            stroke={GOOD}
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />
        )}
        <AxisTitles xLabel="Sprint" yLabel="Story points" />
      </svg>
      <Legend
        items={[
          { name: "Planned (committed)", color: MUTED },
          { name: "Finished (completed)", color: ACCENT },
          ...(showAverage ? [{ name: `Average ${average} pts`, color: GOOD, dashed: true }] : []),
        ]}
      />

      <table className="rpt-velocity-table">
        <thead>
          <tr>
            <th>Sprint</th>
            <th>Planned</th>
            <th>Finished</th>
            <th>Finished share</th>
          </tr>
        </thead>
        <tbody>
          {sprints.map((s) => (
            <tr key={s.sprintId}>
              <td>{s.name}</td>
              <td>{s.committed} pts</td>
              <td>{s.completed} pts</td>
              <td>{s.committed > 0 ? `${Math.round((s.completed / s.committed) * 100)}%` : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
