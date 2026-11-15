import type { IncidentBundle, InfrastructureDisruption, StormTrackPoint } from "@/lib/model/data/loader";
import type { SimulatedUnit, Simulation } from "@/lib/simulation/engine";

/** Pure helpers that describe the incident at a moment in time. Shared by the map, its panels and the timeline. */

export function formatWhen(iso: string | number, timeZone: string, zone = true) {
    return new Intl.DateTimeFormat("en-US", {
        timeZone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        ...(zone ? { timeZoneName: "short" as const } : {}),
    }).format(new Date(iso));
}

export function formatClock(ms: number, timeZone: string) {
    return new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

export function formatDay(ms: number, timeZone: string) {
    return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(ms);
}

export function formatLongDay(ms: number, timeZone: string) {
    return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(ms);
}

export function zoneName(ms: number, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(ms);
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}

export function localHour(ms: number, timeZone: string) {
    const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date(ms));
    return Number(hour) % 24;
}

export function formatElapsed(ms: number) {
    const total = Math.max(0, Math.floor(ms / 60_000));
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return `T+${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function roadClosures(bundle: IncidentBundle): InfrastructureDisruption[] {
    const modeled = bundle.exercise?.disruptions ?? [];
    if (modeled.some((disruption) => disruption.path.length > 1)) return modeled;
    return bundle.disruptions;
}

export function closureActive(disruption: InfrastructureDisruption, time: number) {
    const opened = Date.parse(disruption.start);
    const closed = disruption.end ? Date.parse(disruption.end) : Infinity;
    return time >= opened && time < closed;
}

export function stormCategory(windKt: number) {
    if (windKt >= 137) return 5;
    if (windKt >= 113) return 4;
    if (windKt >= 96) return 3;
    if (windKt >= 83) return 2;
    if (windKt >= 64) return 1;
    return 0;
}

function mixRadius(before: number[] | undefined, after: number[] | undefined, fraction: number) {
    if (!before) return after ?? [];
    if (!after) return before;
    return before.map((value, index) => value + ((after[index] ?? value) - value) * fraction);
}

export function stormPosition(points: StormTrackPoint[], time: number): StormTrackPoint | null {
    if (!points.length || time < Date.parse(points[0].t)) return null;
    const last = points[points.length - 1];
    if (time >= Date.parse(last.t)) return last;

    let index = 1;
    while (index < points.length && Date.parse(points[index].t) < time) index += 1;
    const before = points[index - 1];
    const after = points[index];
    const span = Date.parse(after.t) - Date.parse(before.t);
    const fraction = span === 0 ? 0 : (time - Date.parse(before.t)) / span;
    const radii = before.radii && after.radii
        ? {
            kt34: mixRadius(before.radii.kt34, after.radii.kt34, fraction),
            kt50: mixRadius(before.radii.kt50, after.radii.kt50, fraction),
            kt64: mixRadius(before.radii.kt64, after.radii.kt64, fraction),
        }
        : before.radii;
    return {
        ...before,
        t: new Date(time).toISOString(),
        lon: before.lon + (after.lon - before.lon) * fraction,
        lat: before.lat + (after.lat - before.lat) * fraction,
        windKt: Math.round(before.windKt + (after.windKt - before.windKt) * fraction),
        pressureMb: Math.round(before.pressureMb + (after.pressureMb - before.pressureMb) * fraction),
        radii,
        interpolated: true,
    };
}

export type UnitState = "En route" | "On scene" | "Preparing" | "Returning" | "Available" | "Off shift";

export const UNIT_STATES: UnitState[] = ["En route", "On scene", "Preparing", "Returning", "Available", "Off shift"];

export function statusAt(unit: SimulatedUnit, time: number): UnitState {
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

export interface CallsAt {
    received: number;
    handled: number;
    open: number;
    openUrgent: number;
}

export function callsAt(bundle: IncidentBundle, simulation: Simulation | null, time: number): CallsAt | null {
    const calls = bundle.exercise?.calls;
    if (!calls?.length) return null;
    const finished: Record<string, number> = {};
    for (const item of simulation?.handled ?? []) finished[item.id] = item.at;
    let received = 0;
    let handled = 0;
    let openUrgent = 0;
    for (const call of calls) {
        if (Date.parse(call.createdAt) > time) continue;
        received += 1;
        const at = finished[call.id];
        if (at !== undefined && time >= at) handled += 1;
        else if (call.priority === 1) openUrgent += 1;
    }
    return { received, handled, open: received - handled, openUrgent };
}
