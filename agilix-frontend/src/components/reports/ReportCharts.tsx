import type { SeriesDay, VelocityReport } from "../../api/reports";

const WIDTH = 640;
const HEIGHT = 290;
const PAD = { top: 16, right: 16, bottom: 58, left: 56 };

const ACCENT = "#c4a04d";
const MUTED = "#9a9d8f";
const GOOD = "#829172";
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

function niceMax(value: number): number {
  if (value <= 5) return 5;
  const step = value <= 20 ? 5 : value <= 50 ? 10 : 20;
  return Math.ceil(value / step) * step;
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

/** Total scope against completed points. A jump in scope is a scope change. */
export function BurnupChart({ days }: { days: SeriesDay[] }) {
  return (
    <LineChart
      title="Sprint burnup"
      days={days}
      lines={[
        { name: "Scope", color: MUTED, dashed: true, values: days.map((d) => d.scope) },
        { name: "Completed", color: GOOD, values: days.map((d) => d.completed) },
      ]}
    />
  );
}

/** Committed against completed points for each finished sprint. */
export function VelocityChart({ sprints }: { sprints: VelocityReport["sprints"] }) {
  const max = niceMax(Math.max(0, ...sprints.flatMap((s) => [s.committed, s.completed])));
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const group = plotW / Math.max(1, sprints.length);
  const bar = Math.min(34, group / 3);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f * 10) / 10);

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
              <text x={cx} y={HEIGHT - PAD.bottom + 18} textAnchor="middle" fontSize="11" fill="#6b6f62">
                {s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name}
              </text>
            </g>
          );
        })}
        <AxisTitles xLabel="Sprint" yLabel="Story points" />
      </svg>
      <Legend
        items={[
          { name: "Committed", color: MUTED },
          { name: "Completed", color: ACCENT },
        ]}
      />
    </div>
  );
}
