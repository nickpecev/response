"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AsciiField } from "@/components/base/AsciiField";
import { Standby } from "@/components/base/Standby";
import { analyticsMetrics, formatDuration, type AnalyticsFilter, type HistogramBin, type HourPoint, type NamedSlice } from "@/lib/analytics/metrics";
import { loadBundledIncident, loadGraph, type IncidentBundle, type RoadGraph } from "@/lib/model/data/loader";
import { simulate, type Simulation } from "@/lib/simulation/engine";
import { useApp } from "@/lib/store/app";

export function Analytics() {
    const activeIncidentId = useApp((state) => state.activeIncidentId);
    const [bundle, setBundle] = useState<IncidentBundle | null>(null);
    const [roads, setRoads] = useState<RoadGraph | null>(null);
    const [failed, setFailed] = useState(false);
    const [simulation, setSimulation] = useState<Simulation | null>(null);
    const [day, setDay] = useState("all");
    const [zone, setZone] = useState("all");
    const [category, setCategory] = useState("all");
    const [priority, setPriority] = useState("all");

    useEffect(() => {
        let current = true;
        setBundle(null);
        setRoads(null);
        setFailed(false);
        setDay("all");
        setZone("all");
        setCategory("all");
        setPriority("all");
        loadBundledIncident(activeIncidentId)
            .then(async (loaded) => {
                const graph = loaded.graphUrl ? await loadGraph(loaded.graphUrl) : null;
                if (!current) return;
                setRoads(graph);
                setBundle(loaded);
            })
            .catch(() => {
                if (current) setFailed(true);
            });
        return () => {
            current = false;
        };
    }, [activeIncidentId]);

    useEffect(() => {
        const exercise = bundle?.exercise;
        if (!exercise) {
            setSimulation(null);
            return;
        }
        let current = true;
        setSimulation(null);
        const handle = window.setTimeout(() => {
            const next = simulate(exercise, roads);
            if (!current) return;
            setSimulation(next);
        }, 0);
        return () => {
            current = false;
            window.clearTimeout(handle);
        };
    }, [bundle, roads]);

    if (failed) return <Standby incidentId={activeIncidentId} failed />;
    if (!bundle) return <Standby incidentId={activeIncidentId} />;

    const exercise = bundle.exercise;
    const timeZone = bundle.manifest.timezone;
    const days = exercise ? localDays(exercise.window.start, exercise.window.end, timeZone) : [];
    const selectedDay = days.find((item) => item.value === day);
    const filter: AnalyticsFilter = {
        from: selectedDay?.from,
        to: selectedDay?.to,
        zoneId: zone === "all" ? undefined : zone,
        category: category === "all" ? undefined : category,
        priority: priority === "all" ? undefined : Number(priority),
    };
    const metrics = exercise && simulation ? analyticsMetrics(exercise, simulation, filter) : null;
    const categories = exercise ? [...new Set(exercise.calls.map((call) => call.category))] : [];

    const start = exercise ? Date.parse(exercise.window.start) : 0;
    const end = exercise ? Date.parse(exercise.window.end) : 0;
    const suspension = exercise?.suspension ? { start: Date.parse(exercise.suspension.start), end: Date.parse(exercise.suspension.end) } : null;
    const filtered = day !== "all" || zone !== "all" || category !== "all" || priority !== "all";

    return (
        <div className="h-full overflow-y-auto">
            <header className="relative overflow-hidden border-b border-line bg-panel">
                <AsciiField variant="terrain" cell={10} className="absolute inset-y-0 right-0 h-full w-3/5" />
                <div className="absolute inset-y-0 left-2/5 w-40 bg-linear-to-r from-panel to-transparent" />
                <div className="relative px-8 py-8">
                    <h1 className="text-[28px] leading-tight font-light tracking-tight text-fg">Response performance</h1>
                    <p className="mt-2 text-[13px] text-muted">
                        {bundle.manifest.shortName}
                        {exercise && (
                            <>
                                <span className="mx-2 text-dim">·</span>
                                {formatSpan(exercise.window.start, exercise.window.end, timeZone)}
                                <span className="mx-2 text-dim">·</span>
                                {exercise.calls.length} calls, {exercise.units.length} units
                            </>
                        )}
                        {!exercise && " has no calls to measure."}
                    </p>
                </div>
            </header>

            {exercise && !metrics && <p className="px-8 py-10 text-[13px] text-muted">Running the response simulation…</p>}

            {exercise && metrics && (
                <>
                    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-bg/90 px-8 py-2.5 backdrop-blur-md">
                        <Filter label="Day" value={day} onChange={setDay} options={[{ value: "all", label: "Entire window" }, ...days.map((item) => ({ value: item.value, label: item.label }))]} />
                        <Filter label="Zone" value={zone} onChange={setZone} options={[{ value: "all", label: "All zones" }, ...exercise.zones.map((item) => ({ value: item.id, label: item.name }))]} />
                        <Filter label="Category" value={category} onChange={setCategory} options={[{ value: "all", label: "All categories" }, ...categories.map((item) => ({ value: item, label: item.replaceAll("_", " ") }))]} />
                        <Filter label="Priority" value={priority} onChange={setPriority} options={[{ value: "all", label: "All" }, { value: "1", label: "Priority 1" }, { value: "2", label: "Priority 2" }, { value: "3", label: "Priority 3" }]} />
                        {filtered && (
                            <button
                                type="button"
                                onClick={() => {
                                    setDay("all");
                                    setZone("all");
                                    setCategory("all");
                                    setPriority("all");
                                }}
                                className="ml-auto text-[12px] text-muted hover:text-accent"
                            >
                                Clear filters
                            </button>
                        )}
                    </div>

                    <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 xl:grid-cols-6">
                        <Figure
                            label="Completed"
                            value={String(metrics.completed)}
                            note={`of ${metrics.received} received · ${metrics.received ? Math.round((metrics.completed / metrics.received) * 100) : 0}%`}
                        />
                        <Figure label="Median to scene" value={formatDuration(metrics.response.median)} note={`${formatDuration(metrics.responseOutsideSuspension.median)} outside suspension`} />
                        <Figure label="90th percentile" value={formatDuration(metrics.response.p90)} note="to scene" />
                        <Figure label="Wait to assign" value={formatDuration(metrics.dispatch.median)} note={share(metrics.dispatch.median, metrics.response.median, "of time to scene")} />
                        <Figure label="Travel" value={formatDuration(metrics.travel.median)} note={share(metrics.travel.median, metrics.response.median, "of time to scene")} />
                        <Figure label="Still open" value={String(metrics.open)} note={metrics.open ? "never reached" : "all reached"} alert={metrics.open > 0} />
                    </dl>

                    <div className="grid border-t border-line xl:grid-cols-2">
                        <Section title="Queue" description="Calls waiting for a unit, against calls being worked, by hour." aside={<Legend items={[{ label: "Waiting", swatch: "h-2 w-3 bg-accent/40 border-t border-accent" }, { label: "In progress", swatch: "h-px w-3 bg-muted" }]} />}>
                            <Chart points={metrics.hours} start={start} end={end} timeZone={timeZone} suspension={suspension} variant="queue" />
                        </Section>
                        <Section
                            title="Availability"
                            description="Units actually free, against units dispatch believed were free. Red is the gap."
                            aside={<Legend items={[{ label: "Free", swatch: "h-px w-3 bg-fg" }, { label: "Shown free", swatch: "w-3 border-t border-dashed border-muted" }, { label: "Gap", swatch: "h-2 w-3 bg-signal/30" }]} />}
                        >
                            <Chart points={metrics.hours} start={start} end={end} timeZone={timeZone} suspension={suspension} variant="availability" />
                        </Section>
                        <Section title="Where time goes" description="Median and 90th percentile for each step of a response.">
                            <Table
                                head={["Step", "Calls", "Median", "90th"]}
                                rows={metrics.intervals.map((row) => [row.label, String(row.stats.n), formatDuration(row.stats.median), formatDuration(row.stats.p90)])}
                            />
                        </Section>
                        <Section title="Time to scene" description="How many requests were reached within each band. The brightest band holds the median.">
                            <Distribution rows={metrics.histogram} />
                        </Section>
                        <Section title="By priority" description="Slowest median in red.">
                            <SliceTable rows={metrics.priorities} first="Priority" />
                        </Section>
                        <Section title="By zone" description="Slowest median in red.">
                            <SliceTable rows={metrics.zones} first="Zone" />
                        </Section>
                        <Section title="By call type">
                            <SliceTable rows={metrics.categories} first="Type" />
                        </Section>
                        <Section title="Units" description="Assignments, utilisation, and mean cycle per unit.">
                            <Table
                                head={["Unit", "Type", "Calls", "Busy", "Cycle", "Distance"]}
                                mono
                                rows={metrics.units.map((row) => [
                                    row.callSign,
                                    row.type.replaceAll("_", " "),
                                    String(row.assignments),
                                    row.onCallPct === null ? "—" : `${Math.round(row.onCallPct)}%`,
                                    formatDuration(row.cycleMin),
                                    `${Math.round(row.distanceMi)} mi`,
                                ])}
                            />
                        </Section>
                    </div>
                    <footer className="flex flex-wrap items-center justify-between gap-2 px-8 py-6 text-[11px] text-dim">
                        <span>Figures are derived from the exercise simulation, not from dispatch records.</span>
                        <span>Aftermath</span>
                    </footer>
                </>
            )}
        </div>
    );
}

function share(part: number | null, whole: number | null, suffix: string) {
    if (part === null || whole === null || whole <= 0) return suffix;
    return `${Math.round((part / whole) * 100)}% ${suffix}`;
}

function Section({ title, description, aside, children }: { title: string; description?: string; aside?: ReactNode; children: ReactNode }) {
    return (
        <section className="min-w-0 border-b border-line px-8 py-7 xl:odd:border-r">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                <div>
                    <h2 className="text-[15px] text-fg">{title}</h2>
                    {description && <p className="mt-1 text-[12px] text-muted">{description}</p>}
                </div>
                {aside}
            </div>
            {children}
        </section>
    );
}

function Legend({ items }: { items: { label: string; swatch: string }[] }) {
    return (
        <p className="flex flex-wrap items-center gap-4 text-[11px] text-muted">
            {items.map((item) => (
                <span key={item.label} className="flex items-center gap-1.5">
                    <span className={`inline-block ${item.swatch}`} />
                    {item.label}
                </span>
            ))}
        </p>
    );
}

function Figure({ label, value, note, alert = false }: { label: string; value: string; note?: string; alert?: boolean }) {
    return (
        <div className="flex flex-col gap-3 bg-panel px-6 py-5">
            <dt className="text-[12px] text-muted">{label}</dt>
            <dd>
                <span className={`block text-[26px] leading-none font-light tracking-tight tabular-nums ${alert ? "text-signal" : "text-fg"}`}>{value}</span>
                <span className="mt-2 block text-[11px] text-dim">{note ?? " "}</span>
            </dd>
        </div>
    );
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
    const active = value !== "all";
    return (
        <label className="relative flex items-center gap-2 text-[12px]">
            <span className="text-dim">{label}</span>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className={`field-sizing-content appearance-none rounded-sm py-1 pr-5 pl-2 capitalize outline-none transition-colors hover:bg-raised ${active ? "bg-raised text-accent" : "text-fg"}`}
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
            <svg viewBox="0 0 8 5" className="pointer-events-none absolute right-1.5 h-1.5 w-2 text-muted" aria-hidden>
                <path d="M0 0h8L4 5Z" fill="currentColor" />
            </svg>
        </label>
    );
}

function Distribution({ rows }: { rows: HistogramBin[] }) {
    const peak = Math.max(1, ...rows.map((row) => row.count));
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    let running = 0;
    let medianIndex = -1;
    rows.forEach((row, index) => {
        running += row.count;
        if (medianIndex < 0 && running >= total / 2) medianIndex = index;
    });
    return (
        <div className="flex flex-col gap-1.5">
            {rows.map((row, index) => (
                <div key={row.label} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3 text-[12px]">
                    <span className={`truncate ${index === medianIndex ? "text-accent" : "text-muted"}`}>{row.label}</span>
                    <span className="h-3.5 rounded-[1px] bg-rule">
                        <span className={`block h-full rounded-[1px] ${index === medianIndex ? "bg-accent" : "bg-fg/35"}`} style={{ width: `${(row.count / peak) * 100}%` }} />
                    </span>
                    <span className="text-right tabular-nums text-fg">{row.count}</span>
                </div>
            ))}
        </div>
    );
}

function SliceTable({ rows, first }: { rows: NamedSlice[]; first: string }) {
    let worst = -1;
    let worstValue = -Infinity;
    if (rows.length > 1) {
        rows.forEach((row, index) => {
            if (row.median !== null && row.median > worstValue) {
                worstValue = row.median;
                worst = index;
            }
        });
    }
    return (
        <Table
            head={[first, "Calls", "Open", "Median", "90th"]}
            rows={rows.map((row) => [row.label, String(row.count), String(row.open), formatDuration(row.median), formatDuration(row.p90)])}
            highlight={worst >= 0 ? { row: worst, col: 3 } : undefined}
        />
    );
}

function Table({ head, rows, highlight, mono = false }: { head: string[]; rows: string[][]; highlight?: { row: number; col: number }; mono?: boolean }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
                <thead>
                    <tr className="border-b border-line">
                        {head.map((label, index) => (
                            <th key={label} className={`px-3 pb-2 text-[11px] font-normal text-dim last:pr-0 ${index === 0 ? "pl-0 text-left" : "text-right"}`}>
                                {label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, rowIndex) => (
                        <tr key={row.join("|")} className="transition-colors hover:bg-raised">
                            {row.map((value, index) => {
                                const hot = highlight?.row === rowIndex && highlight.col === index;
                                return index === 0 ? (
                                    <th key={index} className={`py-1.5 pr-3 text-left font-normal capitalize ${mono ? "font-mono text-[12px]" : ""} text-fg`}>
                                        {value}
                                    </th>
                                ) : (
                                    <td key={index} className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap last:pr-0 ${hot ? "text-signal" : index === 1 && mono ? "text-muted capitalize" : "text-fg"}`}>
                                        {value}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Chart({
    points,
    start,
    end,
    timeZone,
    suspension,
    variant,
}: {
    points: HourPoint[];
    start: number;
    end: number;
    timeZone: string;
    suspension: { start: number; end: number } | null;
    variant: "queue" | "availability";
}) {
    const frame = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    const [hover, setHover] = useState<number | null>(null);
    useEffect(() => {
        const node = frame.current;
        if (!node) return;
        const watch = new ResizeObserver(() => setWidth(node.clientWidth));
        watch.observe(node);
        setWidth(node.clientWidth);
        return () => watch.disconnect();
    }, []);

    const first = variant === "queue" ? "waiting" : "available";
    const second = variant === "queue" ? "active" : "believed";
    const height = 220;
    const padL = 28;
    const padR = 4;
    const padT = 22;
    const padB = 6;
    const plotW = Math.max(1, width - padL - padR);
    const plotH = height - padT - padB;
    const span = Math.max(1, end - start);
    const x = (t: number) => padL + ((t - start) / span) * plotW;
    const peak = Math.max(1, ...points.flatMap((point) => [point[first], point[second]]));
    const top = Math.ceil(peak / 4) * 4;
    const y = (value: number) => padT + (1 - value / top) * plotH;
    const marks = [0, top / 2, top];
    const days = dayTicks(start, end, timeZone);
    const base = y(0);

    const firstLine = linePath(points, (point) => point[first], x, y);
    const secondLine = linePath(points, (point) => point[second], x, y);
    const area = points.length ? `${firstLine} L${x(points[points.length - 1].t).toFixed(1)},${base} L${x(points[0].t).toFixed(1)},${base} Z` : "";
    const gap = points.length
        ? `${linePath(points, (point) => Math.max(point.believed, point.available), x, y)} ${points
              .slice()
              .reverse()
              .map((point) => `L${x(point.t).toFixed(1)},${y(point.available).toFixed(1)}`)
              .join(" ")} Z`
        : "";

    const hovered = hover === null ? null : points[hover];

    return (
        <div ref={frame} className="relative">
            <svg
                width={width || "100%"}
                height={height}
                className="block"
                role="img"
                aria-label={variant === "queue" ? "Calls waiting and in progress over time" : "Units free and shown free over time"}
                onPointerMove={(event) => {
                    if (!points.length) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const t = start + ((event.clientX - rect.left - padL) / plotW) * span;
                    let best = 0;
                    for (let index = 1; index < points.length; index++) {
                        if (Math.abs(points[index].t - t) < Math.abs(points[best].t - t)) best = index;
                    }
                    setHover(best);
                }}
                onPointerLeave={() => setHover(null)}
            >
                {width > 0 && (
                    <>
                        {suspension && (
                            <g>
                                <rect x={x(suspension.start)} width={Math.max(1, x(suspension.end) - x(suspension.start))} y={padT} height={plotH} className="fill-fg" opacity={0.04} />
                                <text x={x(suspension.start) + 4} y={padT + 11} className="fill-dim text-[10px]">
                                    Suspended
                                </text>
                            </g>
                        )}
                        {marks.map((mark) => (
                            <g key={mark}>
                                <line x1={padL} x2={padL + plotW} y1={y(mark)} y2={y(mark)} className={mark === 0 ? "stroke-line" : "stroke-rule"} />
                                <text x={padL - 8} y={y(mark) + 3} textAnchor="end" className="fill-dim text-[10px] tabular-nums">
                                    {mark}
                                </text>
                            </g>
                        ))}
                        {days.map((day) => (
                            <g key={day}>
                                <line x1={x(day)} x2={x(day)} y1={padT - 6} y2={padT + plotH} className="stroke-rule" />
                                <text x={x(day) + 4} y={11} className="fill-dim font-mono text-[9px] tracking-[0.08em]">
                                    {formatDay(day, timeZone).toUpperCase()}
                                </text>
                            </g>
                        ))}
                        {variant === "queue" ? (
                            <>
                                <path d={area} className="fill-accent" opacity={0.14} />
                                <path d={secondLine} fill="none" className="stroke-muted" strokeWidth={1} strokeLinejoin="round" />
                                <path d={firstLine} fill="none" className="stroke-accent" strokeWidth={1.5} strokeLinejoin="round" />
                            </>
                        ) : (
                            <>
                                <path d={gap} className="fill-signal" opacity={0.28} />
                                <path d={secondLine} fill="none" className="stroke-muted" strokeWidth={1} strokeDasharray="3 2" strokeLinejoin="round" />
                                <path d={firstLine} fill="none" className="stroke-fg" strokeWidth={1.5} strokeLinejoin="round" />
                            </>
                        )}
                        {hovered && (
                            <g>
                                <line x1={x(hovered.t)} x2={x(hovered.t)} y1={padT} y2={padT + plotH} className="stroke-muted" strokeDasharray="2 3" />
                                <circle cx={x(hovered.t)} cy={y(hovered[first])} r={3} className={variant === "queue" ? "fill-accent" : "fill-fg"} />
                                <circle cx={x(hovered.t)} cy={y(hovered[second])} r={2.5} className="fill-muted" />
                            </g>
                        )}
                    </>
                )}
            </svg>
            {hovered && (
                <div
                    className="pointer-events-none absolute top-6 rounded-sm bg-raised px-2.5 py-1.5 text-[11px] shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-line"
                    style={x(hovered.t) > width - 170 ? { right: width - x(hovered.t) + 10 } : { left: x(hovered.t) + 10 }}
                >
                    <div className="text-muted">{formatHour(hovered.t, timeZone)}</div>
                    <div className="mt-0.5 tabular-nums text-fg">
                        {variant === "queue" ? `${hovered.waiting} waiting · ${hovered.active} in progress` : `${hovered.available} free · ${hovered.believed} shown free`}
                    </div>
                </div>
            )}
        </div>
    );
}

function linePath(points: HourPoint[], value: (point: HourPoint) => number, x: (t: number) => number, y: (value: number) => number) {
    return points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.t).toFixed(1)},${y(value(point)).toFixed(1)}`).join(" ");
}

function localDays(startIso: string, endIso: string, timeZone: string) {
    const start = Date.parse(startIso);
    const end = Date.parse(endIso);
    const label = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" });
    const key = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    const days: { value: string; label: string; from: number; to: number }[] = [];
    let from = localMidnight(start, timeZone);
    while (from < end && days.length < 40) {
        const next = localMidnight(from + 36 * 60 * 60 * 1000, timeZone);
        days.push({ value: key.format(from + 12 * 60 * 60 * 1000), label: label.format(Math.max(from, start)), from: Math.max(from, start), to: Math.min(next, end) });
        from = next;
    }
    return days;
}

function localMidnight(time: number, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(time);
    const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    let hour = pick("hour");
    if (hour === 24) hour = 0;
    return time - ((hour * 60 + pick("minute")) * 60 + pick("second")) * 1000;
}

function dayTicks(start: number, end: number, timeZone: string) {
    const ticks: number[] = [];
    const day = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    let last = "";
    for (let t = start; t <= end; t += 60 * 60 * 1000) {
        const key = day.format(t);
        if (key === last) continue;
        ticks.push(t);
        last = key;
    }
    return ticks;
}

function formatDay(ms: number, timeZone: string) {
    return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(ms);
}

function formatHour(ms: number, timeZone: string) {
    return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(ms);
}

function formatSpan(start: string, end: string, timeZone: string) {
    const day = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" });
    return `${day.format(new Date(start))} – ${day.format(new Date(end))}`;
}
