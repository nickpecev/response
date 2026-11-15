"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { IncidentBundle } from "@/lib/model/data/loader";
import { positionAt, type Simulation } from "@/lib/simulation/engine";
import {
    UNIT_STATES,
    callsAt,
    closureActive,
    formatClock,
    formatElapsed,
    formatLongDay,
    roadClosures,
    statusAt,
    stormCategory,
    stormPosition,
    zoneName,
    type UnitState,
} from "@/components/map/incident";

interface SituationPanelProps {
    bundle: IncidentBundle;
    simulation: Simulation | null;
    time: number;
    colors: [number, number, number][];
    onFocus: (lon: number, lat: number) => void;
}

/** Brightness tracks commitment: units on a call are brightest, idle ones grey, unavailable ones recede. */
const STATE_TONE: Record<UnitState, string> = {
    "En route": "bg-accent",
    "On scene": "bg-fg/75",
    Preparing: "bg-fg/55",
    Returning: "bg-fg/40",
    Available: "bg-dim",
    "Off shift": "bg-line",
};

const STORM_STATUS: Record<string, string> = {
    TD: "Tropical depression",
    TS: "Tropical storm",
    HU: "Hurricane",
    EX: "Extratropical",
    LO: "Low",
};

function Block({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
    return (
        <div>
            <div className="flex items-baseline justify-between gap-2">
                <span className="caps text-dim">{label}</span>
                {aside && <span className="truncate text-[11px] text-muted">{aside}</span>}
            </div>
            <div className="mt-1.5">{children}</div>
        </div>
    );
}

function Bar({ parts, total }: { parts: { value: number; tone: string; label: string }[]; total: number }) {
    return (
        <div className="mt-2 flex h-1 gap-px overflow-hidden rounded-full bg-rule">
            {parts
                .filter((part) => part.value > 0)
                .map((part) => (
                    <span key={part.label} className={part.tone} style={{ width: `${(part.value / Math.max(1, total)) * 100}%` }} title={`${part.label}: ${part.value}`} />
                ))}
        </div>
    );
}

export function SituationPanel({ bundle, simulation, time, colors, onFocus }: SituationPanelProps) {
    const timeZone = bundle.manifest.timezone;
    const start = Date.parse(bundle.manifest.timeRange.start);
    const [selected, setSelected] = useState("");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ "Off shift": true });

    const position = stormPosition(bundle.storm?.points ?? [], time);
    const category = position ? stormCategory(position.windKt) : 0;
    const calls = callsAt(bundle, simulation, time);
    const closed = useMemo(() => roadClosures(bundle).filter((item) => item.path.length > 1), [bundle]);
    const closedNow = closed.filter((item) => closureActive(item, time)).length;

    const units = (simulation?.units ?? []).map((unit, index) => ({
        unit,
        color: colors[index % colors.length],
        state: statusAt(unit, time),
    }));
    const groups = UNIT_STATES.map((state) => ({
        state,
        rows: units.filter((row) => row.state === state).sort((a, b) => a.unit.callSign.localeCompare(b.unit.callSign)),
    })).filter((group) => group.rows.length);
    const committed = units.filter((row) => row.state === "En route" || row.state === "On scene" || row.state === "Preparing").length;

    return (
        <aside className="flex min-h-0 flex-col overflow-hidden border-r border-line bg-panel">
            <div className="border-b border-rule px-5 pt-4 pb-4">
                <div className="text-[11px] text-muted">{formatLongDay(time, timeZone)}</div>
                <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-[30px] leading-none font-light tracking-tight tabular-nums">{formatClock(time, timeZone)}</span>
                    <span className="text-[11px] text-muted">{zoneName(time, timeZone)}</span>
                </div>
                <div className="mt-2 font-mono text-[11px] text-dim">{formatElapsed(time - start)}</div>
            </div>

            <div className="space-y-5 border-b border-rule px-5 py-4">
                {bundle.storm && (
                    <Block label="Storm" aside={bundle.storm.name}>
                        {position ? (
                            <div className="flex items-baseline justify-between gap-3">
                                <span className="text-[15px] text-fg">{category > 0 ? `Category ${category}` : (STORM_STATUS[position.status] ?? position.status)}</span>
                                <span className="text-[11px] tabular-nums text-muted">
                                    {position.windKt} kt · {position.pressureMb} mb
                                </span>
                            </div>
                        ) : (
                            <span className="text-[13px] text-dim">Before first fix</span>
                        )}
                    </Block>
                )}

                {calls && (
                    <Block label="Calls" aside={`${calls.received} received`}>
                        <div className="flex items-baseline gap-2">
                            <span className="text-[15px] tabular-nums text-fg">{calls.open}</span>
                            <span className="text-[13px] text-muted">open</span>
                            {calls.openUrgent > 0 && <span className="ml-auto text-[11px] tabular-nums text-signal">{calls.openUrgent} priority 1</span>}
                        </div>
                        <Bar
                            total={calls.received}
                            parts={[
                                { value: calls.openUrgent, tone: "bg-signal", label: "Open, priority 1" },
                                { value: calls.open - calls.openUrgent, tone: "bg-fg", label: "Open" },
                                { value: calls.handled, tone: "bg-fg/20", label: "Handled" },
                            ]}
                        />
                    </Block>
                )}

                {closed.length > 0 && (
                    <Block label="Roads closed">
                        <div className="flex items-baseline gap-2">
                            <span className={`text-[15px] tabular-nums ${closedNow ? "text-signal" : "text-fg"}`}>{closedNow}</span>
                            <span className="text-[13px] text-muted">of {closed.length} segments</span>
                        </div>
                    </Block>
                )}

                {units.length > 0 && (
                    <Block label="Units" aside={`${committed} committed`}>
                        <div className="flex items-baseline gap-2">
                            <span className="text-[15px] tabular-nums text-fg">{units.filter((row) => row.state !== "Off shift").length}</span>
                            <span className="text-[13px] text-muted">on shift of {units.length}</span>
                        </div>
                        <Bar total={units.length} parts={groups.map((group) => ({ value: group.rows.length, tone: STATE_TONE[group.state], label: group.state }))} />
                    </Block>
                )}
            </div>

            {groups.length > 0 && (
                <div className="min-h-0 flex-1 overflow-y-auto py-1">
                    {groups.map((group) => {
                        const closedGroup = collapsed[group.state];
                        return (
                            <section key={group.state}>
                                <button
                                    type="button"
                                    onClick={() => setCollapsed((current) => ({ ...current, [group.state]: !current[group.state] }))}
                                    aria-expanded={!closedGroup}
                                    className="sticky top-0 z-[1] flex w-full items-center gap-2 bg-panel px-5 py-2 text-left text-[11px] text-muted hover:text-fg"
                                >
                                    <span className={`h-1.5 w-1.5 rounded-full ${STATE_TONE[group.state]}`} />
                                    {group.state}
                                    <span className="tabular-nums text-dim">{group.rows.length}</span>
                                    <svg viewBox="0 0 8 5" className={`ml-auto h-1.5 w-2 text-dim transition-transform ${closedGroup ? "-rotate-90" : ""}`} aria-hidden>
                                        <path d="M0 0h8L4 5Z" fill="currentColor" />
                                    </svg>
                                </button>
                                {!closedGroup &&
                                    group.rows.map((row) => {
                                        const place = positionAt(row.unit.track, time) ?? row.unit.track[0] ?? null;
                                        const current = row.unit.id === selected;
                                        return (
                                            <button
                                                key={row.unit.id}
                                                type="button"
                                                onClick={() => {
                                                    if (!place) return;
                                                    setSelected(row.unit.id);
                                                    onFocus(place.lon, place.lat);
                                                }}
                                                className={`flex w-full items-center gap-3 py-1.5 pr-5 pl-[34px] text-left transition-colors hover:bg-raised ${current ? "bg-raised" : ""}`}
                                            >
                                                <span
                                                    className="h-2 w-2 shrink-0 rounded-full"
                                                    style={{ backgroundColor: `rgb(${row.color[0]}, ${row.color[1]}, ${row.color[2]})` }}
                                                />
                                                <span className={`font-mono text-[12px] ${group.state === "Off shift" ? "text-muted" : "text-fg"}`}>{row.unit.callSign}</span>
                                                <span className="ml-auto truncate text-[11px] text-dim first-letter:uppercase">{row.unit.type.replaceAll("_", " ")}</span>
                                            </button>
                                        );
                                    })}
                            </section>
                        );
                    })}
                </div>
            )}
        </aside>
    );
}
