"use client";

import { useEffect, useRef, useState } from "react";
import { analyticsMetrics, formatDuration, type AnalyticsFilter, type HourPoint } from "@/lib/analytics/metrics";
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

    if (failed) return <p className="p-6 text-sm text-muted">Could not load {activeIncidentId}.</p>;
    if (!bundle) return null;

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

    return (
        <div className="h-full overflow-y-auto">
            <div className="flex flex-col gap-8 px-6 py-6">
                <div className="flex flex-wrap items-baseline justify-between gap-4">
                    <h1 className="text-xs text-muted">Analytics</h1>
                    {exercise && <p className="text-[11px] text-dim">{formatSpan(exercise.window.start, exercise.window.end, timeZone)}</p>}
                    {!exercise && <p className="text-[13px] text-muted">No calls to measure.</p>}
                </div>

                {exercise && metrics && (
                    <>
                        <div className="flex flex-wrap gap-x-6 gap-y-3">
                            <Filter label="Day" value={day} onChange={setDay} options={[{ value: "all", label: "Entire window" }, ...days.map((item) => ({ value: item.value, label: item.label }))]} />
                            <Filter label="Zone" value={zone} onChange={setZone} options={[{ value: "all", label: "All zones" }, ...exercise.zones.map((item) => ({ value: item.id, label: item.name }))]} />
                            <Filter label="Category" value={category} onChange={setCategory} options={[{ value: "all", label: "All categories" }, ...categories.map((item) => ({ value: item, label: item.replaceAll("_", " ") }))]} />
                            <Filter label="Priority" value={priority} onChange={setPriority} options={[{ value: "all", label: "All priorities" }, { value: "1", label: "Priority 1" }, { value: "2", label: "Priority 2" }, { value: "3", label: "Priority 3" }]} />
                        </div>

                        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-y border-line py-4 sm:grid-cols-3">
                            <Figure label="Requests" value={`${metrics.completed} of ${metrics.received}`} />
                            <Figure label="Median to scene" value={formatDuration(metrics.response.median)} />
                            <Figure label="90th" value={formatDuration(metrics.response.p90)} />
                            <Figure label="Outside suspension" value={formatDuration(metrics.responseOutsideSuspension.median)} />
                            <Figure label="Wait to assign" value={formatDuration(metrics.dispatch.median)} />
                            <Figure label="Still open" value={String(metrics.open)} />
                        </dl>

                        <Table
                            title="Time"
                            head={["Interval", "Calls", "Median", "90th"]}
                            rows={metrics.intervals.map((row) => [row.label, String(row.stats.n), formatDuration(row.stats.median), formatDuration(row.stats.p90)])}
                        />

                        <section>
                            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                                <h2 className="text-xs text-muted">Queue</h2>
                                <p className="text-[11px] text-dim">Waiting · in progress</p>
                            </div>
                            <Lines points={metrics.hours} start={start} end={end} timeZone={timeZone} first="waiting" second="active" />
                        </section>

                        <section>
                            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                                <h2 className="text-xs text-muted">Availability</h2>
                                <p className="text-[11px] text-dim">Actually free · shown free to dispatch</p>
                            </div>
                            <Lines points={metrics.hours} start={start} end={end} timeZone={timeZone} first="available" second="believed" />
                        </section>

                        <Table title="Distribution" head={["Range", "Requests"]} rows={metrics.histogram.map((row) => [row.label, String(row.count)])} />

                        <Table
                            title="Priority"
                            head={["Priority", "Calls", "Open", "Median", "90th"]}
                            rows={metrics.priorities.map((row) => [row.label, String(row.count), String(row.open), formatDuration(row.median), formatDuration(row.p90)])}
                        />

                        <Table
                            title="Zone"
                            head={["Zone", "Calls", "Open", "Median", "90th"]}
                            rows={metrics.zones.map((row) => [row.label, String(row.count), String(row.open), formatDuration(row.median), formatDuration(row.p90)])}
                        />

                        <Table
                            title="Call type"
                            head={["Type", "Calls", "Open", "Median"]}
                            rows={metrics.categories.map((row) => [row.label, String(row.count), String(row.open), formatDuration(row.median)])}
                        />

                        <Table
                            title="Units"
                            head={["Unit", "Type", "Calls", "On a call", "Cycle", "Distance"]}
                            rows={metrics.units.map((row) => [
                                row.callSign,
                                row.type.replaceAll("_", " "),
                                String(row.assignments),
                                row.onCallPct === null ? "—" : `${Math.round(row.onCallPct)}%`,
                                formatDuration(row.cycleMin),
                                `${Math.round(row.distanceMi)} mi`,
                            ])}
                        />
                    </>
                )}
            </div>
        </div>
    );
}

function Figure({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className="text-[11px] text-dim">{label}</dt>
            <dd className="mt-1 text-[13px] tabular-nums text-fg">{value}</dd>
        </div>
    );
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
    return (
        <label className="text-[13px] text-muted">
            <span className="mr-2 text-[11px] text-dim">{label}</span>
            <select value={value} onChange={(event) => onChange(event.target.value)} className="bg-bg text-[13px] text-muted outline-none">
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </label>
    );
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
    return (
        <section>
            <h2 className="mb-3 text-xs text-muted">{title}</h2>
            <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                    <thead>
                        <tr className="border-b border-line text-[11px] text-dim">
                            {head.map((label, index) => (
                                <th key={label} className={`px-3 py-2 font-normal ${index === 0 ? "pl-0 text-left" : "text-right"}`}>
                                    {label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.join("|")} className="border-b border-line">
                                {row.map((value, index) =>
                                    index === 0 ? (
                                        <th key={index} className="py-2 pr-3 text-left font-normal text-fg">
                                            {value}
                                        </th>
                                    ) : (
                                        <td key={index} className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-fg">
                                            {value}
                                        </td>
                                    ),
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function Lines({
    points,
    start,
    end,
    timeZone,
    first,
    second,
}: {
    points: HourPoint[];
    start: number;
    end: number;
    timeZone: string;
    first: "waiting" | "available";
    second: "active" | "believed";
}) {
    const frame = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const node = frame.current;
        if (!node) return;
        const watch = new ResizeObserver(() => setWidth(node.clientWidth));
        watch.observe(node);
        setWidth(node.clientWidth);
        return () => watch.disconnect();
    }, []);

    const height = 200;
    const padL = 32;
    const padR = 12;
    const padT = 22;
    const padB = 8;
    const plotW = Math.max(1, width - padL - padR);
    const plotH = height - padT - padB;
    const span = Math.max(1, end - start);
    const x = (t: number) => padL + ((t - start) / span) * plotW;
    const peak = Math.max(1, ...points.flatMap((point) => [point[first], point[second]]));
    const top = Math.ceil(peak / 4) * 4;
    const y = (value: number) => padT + (1 - value / top) * plotH;
    const marks = [0, top / 2, top];
    const days = dayTicks(start, end, timeZone);

    return (
        <div ref={frame}>
            <svg width={width || "100%"} height={height} className="block" role="img" aria-label="Counts over time" style={{ pointerEvents: "none" }}>
                {width > 0 && (
                    <>
                        {marks.map((mark) => (
                            <g key={mark}>
                                <line x1={padL} x2={padL + plotW} y1={y(mark)} y2={y(mark)} stroke="#222" />
                                <text x={padL - 6} y={y(mark) + 3} textAnchor="end" fontSize={10} fill="#8a8a8a">
                                    {mark}
                                </text>
                            </g>
                        ))}
                        {days.map((day) => (
                            <g key={day}>
                                <line x1={x(day)} x2={x(day)} y1={padT} y2={padT + plotH} stroke="#222" />
                                <text x={x(day) + 4} y={12} fontSize={10} fill="#8a8a8a">
                                    {formatDay(day, timeZone)}
                                </text>
                            </g>
                        ))}
                        <path d={linePath(points, (point) => point[first], x, y)} fill="none" stroke="#f2f2f2" strokeWidth={1} />
                        <path d={linePath(points, (point) => point[second], x, y)} fill="none" stroke="#8a8a8a" strokeWidth={1} />
                    </>
                )}
            </svg>
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

function formatSpan(start: string, end: string, timeZone: string) {
    const day = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" });
    return `${day.format(new Date(start))} – ${day.format(new Date(end))}`;
}
