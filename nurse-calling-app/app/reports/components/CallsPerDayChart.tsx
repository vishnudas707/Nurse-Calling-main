"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { formatDayKey } from "../../lib/date-format";
import { toDayKey } from "../lib/report-utils";

type Stamped = { timestamp?: unknown };
type HourPoint = { day: string; hour: number; count: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const PLOT_H = 260;
const PAD = { top: 16, right: 16, bottom: 56, left: 48 };
// 5px/hour keeps each day wide enough for its date and 12 AM / 11:59 PM labels.
const MIN_HOUR_W = 5;
// Days shown at each zoom level; the last level always shows the full range.
const ZOOM_SPANS = [1, 3, 7, 14, 30, 90];

function parseDayKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}

function toKey(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function hourLabel(h: number, minutes: string) {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${minutes} ${h < 12 ? "AM" : "PM"}`;
}

// Smooth wave through the points (monotone cubic, Fritsch-Carlson). Plain
// Bezier smoothing overshoots, which would draw the curve below zero calls on
// a quiet hour; the monotone variant never goes past a neighbouring point.
function smoothPath(pts: { x: number; y: number }[]) {
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  const n = pts.length;
  const dx = pts.slice(1).map((p, i) => p.x - pts[i].x);
  const m = pts.slice(1).map((p, i) => (p.y - pts[i].y) / dx[i]);
  const t = pts.map((_, i) => {
    if (i === 0) return m[0];
    if (i === n - 1) return m[n - 2];
    return m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  });
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i].x + h},${pts[i].y + t[i] * h} ${pts[i + 1].x - h},${pts[i + 1].y - t[i + 1] * h} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

// Whole-number y ticks: step is 1/2/5 x 10^n, axis top is a multiple of it.
function yScale(max: number) {
  const target = Math.max(max, 1) / 4;
  const pow = 10 ** Math.floor(Math.log10(target));
  const step = Math.max(1, ([1, 2, 5, 10].find((s) => s * pow >= target) ?? 10) * pow);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

/**
 * Calls per hour on a continuous timeline: each day is a shaded 12 AM - 12 AM
 * band split into 24 hourly points, joined by a smooth wave. Hours with no
 * calls sit on zero so quiet periods are visible instead of skipped.
 */
export default function CallsPerDayChart({
  calls,
  startDate,
  endDate,
}: {
  calls: Stamped[];
  startDate?: string;
  endDate?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [level, setLevel] = useState(0);
  const [viewW, setViewW] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { days: allDays, hours: allHours } = useMemo(() => {
    const counts = new Map<string, number>();
    let firstKey = "";
    let lastKey = "";
    for (const c of calls) {
      const dayKey = toDayKey(c?.timestamp);
      if (!dayKey) continue;
      const hour = new Date(c.timestamp as string).getHours();
      const k = `${dayKey}|${hour}`;
      counts.set(k, (counts.get(k) || 0) + 1);
      if (!firstKey || dayKey < firstKey) firstKey = dayKey;
      if (!lastKey || dayKey > lastKey) lastKey = dayKey;
    }
    const first = parseDayKey(startDate || "") ?? parseDayKey(firstKey);
    const last = parseDayKey(endDate || "") ?? parseDayKey(lastKey);
    if (first === null || last === null || last < first) return { days: [], hours: [] };
    const dayList: string[] = [];
    // Cap the span so a mistyped year cannot render thousands of slots.
    for (let t = first; t <= last && dayList.length < 366; t += DAY_MS) dayList.push(toKey(t));
    const hourList: HourPoint[] = [];
    for (const day of dayList) {
      for (let h = 0; h < 24; h++) hourList.push({ day, hour: h, count: counts.get(`${day}|${h}`) || 0 });
    }
    return { days: dayList, hours: hourList };
  }, [calls, startDate, endDate]);

  // Track the visible width so the shown days always fill it.
  const hasData = allDays.length > 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasData]);

  if (allDays.length === 0) {
    return <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">No data</div>;
  }

  // Zoom levels are day spans: start on today alone, each zoom-out adds more
  // dates, ending with the whole range.
  const spans = [...ZOOM_SPANS.filter((s) => s < allDays.length), allDays.length];
  const lvl = Math.min(level, spans.length - 1);
  const span = spans[lvl];
  // Focus on today, or the last day of the range if today is outside it.
  const todayIdx = allDays.indexOf(toDayKey(new Date()));
  const focusIdx = todayIdx >= 0 ? todayIdx : allDays.length - 1;
  const startIdx = Math.max(0, Math.min(focusIdx - span + 1, allDays.length - span));
  const days = allDays.slice(startIdx, startIdx + span);
  const hours = allHours.slice(startIdx * 24, (startIdx + span) * 24);

  const hourW = Math.max(MIN_HOUR_W, ((viewW || 1000) - PAD.left - PAD.right) / hours.length);
  const dayW = hourW * 24;

  const applyLevel = (next: number) => {
    setHover(null);
    setLevel(next);
  };
  const zoomIn = () => applyLevel(Math.max(0, lvl - 1));
  const zoomOut = () => applyLevel(Math.min(spans.length - 1, lvl + 1));
  const spanLabel = lvl === 0 && todayIdx >= 0 ? "Today" : span === allDays.length && lvl > 0 ? "All dates" : `${span} day${span === 1 ? "" : "s"}`;

  const { top: yMax, ticks: yTicks } = yScale(Math.max(...hours.map((h) => h.count)));
  const plotW = hours.length * hourW;
  const width = PAD.left + plotW + PAD.right;
  const height = PAD.top + PLOT_H + PAD.bottom;
  const y = (v: number) => PAD.top + PLOT_H - (v / yMax) * PLOT_H;
  const baseY = PAD.top + PLOT_H;
  // Each hour's count sits at the middle of that hour.
  const points = hours.map((h, i) => ({ x: PAD.left + i * hourW + hourW / 2, y: y(h.count) }));
  const curve = smoothPath(points);

  const hovered = hover !== null ? hours[hover] : null;

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left - PAD.left;
    const i = Math.floor(x / hourW);
    setHover(i >= 0 && i < hours.length ? i : null);
  };

  const btn =
    "h-8 min-w-[2rem] px-2 rounded border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600";

  return (
    <div>
      <div className="mb-2 flex items-center justify-end gap-2">
        <span className="mr-1 text-xs text-gray-500 dark:text-gray-400">{spanLabel}</span>
        <button type="button" className={btn} onClick={zoomOut} disabled={lvl >= spans.length - 1} aria-label="Zoom out">
          −
        </button>
        <button type="button" className={btn} onClick={zoomIn} disabled={lvl === 0} aria-label="Zoom in">
          +
        </button>
        <button type="button" className={btn} onClick={() => applyLevel(0)} disabled={lvl === 0}>
          Today
        </button>
      </div>

      <div ref={scrollRef} className="relative overflow-x-auto">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Number of calls per hour"
          className="block min-w-full"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* Background shade for the early-morning hours, 12 AM to 6 AM, of each day. */}
          {days.map((d, i) => (
            <rect
              key={`band-${d}`}
              x={PAD.left + i * dayW}
              y={PAD.top}
              width={hourW * 6}
              height={PLOT_H}
              className="fill-indigo-100/70 dark:fill-indigo-900/30"
            />
          ))}

          {/* Y grid + labels */}
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={y(t)}
                y2={y(t)}
                className="stroke-gray-200 dark:stroke-gray-700"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-gray-500 dark:fill-gray-400 text-[11px] tabular-nums"
              >
                {t}
              </text>
            </g>
          ))}
          <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={baseY} className="stroke-gray-400 dark:stroke-gray-500" />

          {/* Smooth wave: 2px line through each hour's midpoint */}
          <path d={curve} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-blue-600 dark:stroke-blue-400" />

          {/* Dots only once zoomed in far enough to tell hours apart */}
          {hourW >= 10 &&
            points.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={3}
                strokeWidth={1.5}
                className="fill-white stroke-blue-600 dark:fill-gray-800 dark:stroke-blue-400"
              />
            ))}

          {hover !== null && (
            <>
              <line
                x1={points[hover].x}
                x2={points[hover].x}
                y1={PAD.top}
                y2={baseY}
                strokeDasharray="3 3"
                className="stroke-gray-400 dark:stroke-gray-500"
              />
              <circle
                cx={points[hover].x}
                cy={points[hover].y}
                r={5}
                strokeWidth={2}
                className="fill-white stroke-blue-600 dark:fill-gray-800 dark:stroke-blue-400"
              />
            </>
          )}

          {/* X axis: time of day ticks, date under each day */}
          <line x1={PAD.left} x2={PAD.left + plotW} y1={baseY} y2={baseY} className="stroke-gray-400 dark:stroke-gray-500" />
          {days.map((d, i) => {
            const x0 = PAD.left + i * dayW;
            const x1 = x0 + dayW;
            return (
              <g key={`ticks-${d}`}>
                <line x1={x0} x2={x0} y1={baseY} y2={baseY + 6} className="stroke-gray-400 dark:stroke-gray-500" />
                <text x={x0 + 3} y={baseY + 18} textAnchor="start" className="fill-gray-600 dark:fill-gray-300 text-[10px] tabular-nums">
                  12 AM
                </text>
                <text x={x1 - 3} y={baseY + 18} textAnchor="end" className="fill-gray-600 dark:fill-gray-300 text-[10px] tabular-nums">
                  11:59 PM
                </text>
              </g>
            );
          })}
          <line x1={PAD.left + plotW} x2={PAD.left + plotW} y1={baseY} y2={baseY + 6} className="stroke-gray-400 dark:stroke-gray-500" />
          {days.map((d, i) => (
            <text
              key={d}
              x={PAD.left + i * dayW + dayW / 2}
              y={baseY + 34}
              textAnchor="middle"
              className="fill-gray-700 dark:fill-gray-200 text-[11px] font-medium"
            >
              {formatDayKey(d).slice(0, 5)}
            </text>
          ))}
          <text x={PAD.left + plotW / 2} y={height - 4} textAnchor="middle" className="fill-gray-500 dark:fill-gray-400 text-[11px]">
            Date / Time
          </text>
          <text
            transform={`translate(12, ${PAD.top + PLOT_H / 2}) rotate(-90)`}
            textAnchor="middle"
            className="fill-gray-500 dark:fill-gray-400 text-[11px]"
          >
            Calls
          </text>
        </svg>

        {hovered && hover !== null && (
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-gray-200 bg-white px-3 py-2 text-xs shadow-md dark:border-gray-600 dark:bg-gray-800"
            style={{
              left: Math.min(Math.max(points[hover].x, 70), width - 70),
              top: Math.max(0, points[hover].y - 72),
              transform: "translateX(-50%)",
            }}
          >
            <div className="font-semibold text-gray-900 dark:text-gray-100">{formatDayKey(hovered.day)}</div>
            <div className="text-gray-500 dark:text-gray-400">
              {hourLabel(hovered.hour, "00")} – {hourLabel(hovered.hour, "59")}
            </div>
            <div className="mt-1 font-semibold tabular-nums text-gray-900 dark:text-gray-100">
              {hovered.count} call{hovered.count === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
