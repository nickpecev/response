"use client";

import { useState } from "react";
import { positionAt, type SimulatedUnit } from "@/lib/simulation/engine";

interface UnitListProps {
    units: SimulatedUnit[];
    colors: [number, number, number][];
    time: number;
    onSelect: (lon: number, lat: number) => void;
    layers: { id: string; label: string }[];
    visible: Record<string, boolean>;
    onToggle: (id: string) => void;
}

function statusAt(unit: SimulatedUnit, time: number) {
    const first = unit.track[0];
    if (!first || time < first.t || time > unit.shiftEnd) return "Off shift";
    const trip = unit.trips.find((item) => time >= item.start && time < item.end);
    if (!trip) return "Available";

    const held: { start: number; end: number }[] = [];
    for (let index = 1; index < unit.track.length; index++) {
        const from = unit.track[index - 1];
        const to = unit.track[index];
        if (to.t <= trip.start || from.t >= trip.end) continue;
        if (from.lon !== to.lon || from.lat !== to.lat) continue;
        if (to.t - from.t < 30_000) continue;
        held.push({ start: Math.max(from.t, trip.start), end: Math.min(to.t, trip.end) });
    }

    const scene = held[held.length - 1];
    if (!scene) return "En route";
    if (time >= scene.start && time < scene.end) return "On scene";
    if (time >= scene.end) return "Returning";
    for (const span of held) {
        if (time >= span.start && time < span.end) return "Preparing";
    }
    return "En route";
}

function placeAt(unit: SimulatedUnit, time: number) {
    return positionAt(unit.track, time) ?? unit.track[0] ?? null;
}

export function UnitList({ units, colors, time, onSelect, layers, visible, onToggle }: UnitListProps) {
    const [tab, setTab] = useState<"units" | "layers">("units");
    const [selected, setSelected] = useState("");
    const rows = units
        .map((unit, index) => ({
            unit,
            color: colors[index % colors.length],
            status: statusAt(unit, time),
            place: placeAt(unit, time),
        }))
        .sort((a, b) => a.unit.callSign.localeCompare(b.unit.callSign));

    return (
        <aside className="absolute top-12 bottom-56 left-3 z-10 flex w-56 flex-col border border-line bg-bg">
            <div className="flex border-b border-line">
                <button
                    type="button"
                    onClick={() => setTab("units")}
                    className={`flex-1 px-2 py-1.5 text-xs ${tab === "units" ? "text-fg" : "text-dim"}`}
                >
                    Units
                </button>
                <button
                    type="button"
                    onClick={() => setTab("layers")}
                    className={`flex-1 border-l border-line px-2 py-1.5 text-xs ${tab === "layers" ? "text-fg" : "text-dim"}`}
                >
                    Layers
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {tab === "units" &&
                    rows.map((row) => {
                        const current = row.unit.id === selected;
                        const quiet = row.status === "Off shift";
                        return (
                            <button
                                key={row.unit.id}
                                type="button"
                                onClick={() => {
                                    if (!row.place) return;
                                    setSelected(row.unit.id);
                                    onSelect(row.place.lon, row.place.lat);
                                }}
                                className={`flex w-full items-start gap-2 border-b border-l-2 border-line px-2 py-1.5 text-left ${current ? "border-l-fg" : "border-l-transparent"} ${quiet ? "text-dim" : "text-fg"}`}
                            >
                                <span
                                    className="mt-1 h-2 w-2 shrink-0"
                                    style={{ backgroundColor: `rgb(${row.color[0]}, ${row.color[1]}, ${row.color[2]})` }}
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[13px]">{row.unit.callSign}</span>
                                    <span className="block truncate text-[11px] text-dim">
                                        {row.unit.type.replaceAll("_", " ")}
                                        {" · "}
                                        {row.status}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                {tab === "layers" &&
                    layers.map((layer) => (
                        <button
                            key={layer.id}
                            type="button"
                            onClick={() => onToggle(layer.id)}
                            className={`flex w-full items-center gap-2 border-b border-line px-2 py-1.5 text-left text-[13px] ${visible[layer.id] ? "text-fg" : "text-dim"}`}
                        >
                            <span className={`h-2 w-2 border border-current ${visible[layer.id] ? "bg-current" : ""}`} />
                            {layer.label}
                        </button>
                    ))}
            </div>
        </aside>
    );
}
