import type { ExerciseInputs, UnitType } from "@/lib/model/types";
import type { AssignmentRecord, Simulation, SimulatedUnit } from "@/lib/simulation/engine";

const MIN = 60_000;
const HOUR = 60 * MIN;

export interface Stats {
    n: number;
    median: number | null;
    p90: number | null;
}

export interface CallMeasure {
    id: string;
    category: string;
    priority: 1 | 2 | 3;
    zoneId: string;
    createdAt: number;
    assignedAt: number | null;
    ackAt: number | null;
    arrivedAt: number | null;
    clearedAt: number | null;
    dispatchMin: number | null;
    ackMin: number | null;
    travelMin: number | null;
    responseMin: number | null;
    duringSuspension: boolean;
}

export interface HourPoint {
    t: number;
    received: number;
    waiting: number;
    active: number;
    available: number;
    believed: number;
}

export interface UnitRow {
    id: string;
    callSign: string;
    type: UnitType;
    assignments: number;
    onCallPct: number | null;
    cycleMin: number | null;
    distanceMi: number;
    obstructions: number;
}

export interface NamedSlice {
    key: string;
    label: string;
    count: number;
    open: number;
    median: number | null;
    p90: number | null;
}

export interface HistogramBin {
    label: string;
    count: number;
}

export interface AnalyticsFilter {
    from?: number;
    to?: number;
    zoneId?: string;
    category?: string;
    priority?: number;
}

export interface AnalyticsMetrics {
    received: number;
    completed: number;
    open: number;
    response: Stats;
    responseOutsideSuspension: Stats;
    dispatch: Stats;
    ack: Stats;
    travel: Stats;
    intervals: { label: string; stats: Stats }[];
    hours: HourPoint[];
    histogram: HistogramBin[];
    priorities: NamedSlice[];
    zones: NamedSlice[];
    categories: NamedSlice[];
    units: UnitRow[];
}

const BINS = [0, 30, 60, 120, 240, 480, 1440, 2880, Number.POSITIVE_INFINITY];

export function stats(values: number[]): Stats {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    return { n: sorted.length, median: percentile(sorted, 0.5), p90: percentile(sorted, 0.9) };
}

function percentile(sorted: number[], p: number) {
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * p;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    if (low === high) return sorted[low];
    return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function minutes(later: number, earlier: number) {
    return (later - earlier) / MIN;
}

export function formatDuration(minutesValue: number | null) {
    if (minutesValue === null || !Number.isFinite(minutesValue)) return "—";
    const rounded = Math.max(0, Math.round(minutesValue));
    if (rounded < 60) return `${rounded} min`;
    const hours = Math.floor(rounded / 60);
    const rest = rounded % 60;
    if (rest === 0) return `${hours} h`;
    return `${hours} h ${rest} min`;
}

export function analyticsMetrics(exercise: ExerciseInputs, simulation: Simulation, filter: AnalyticsFilter = {}): AnalyticsMetrics {
    const assignmentByCall = new Map<string, AssignmentRecord>();
    for (const assignment of simulation.assignments) assignmentByCall.set(assignment.callId, assignment);

    const suspensionStart = exercise.suspension ? Date.parse(exercise.suspension.start) : Number.POSITIVE_INFINITY;
    const suspensionEnd = exercise.suspension ? Date.parse(exercise.suspension.end) : Number.NEGATIVE_INFINITY;
    const windowStart = Date.parse(exercise.window.start);
    const windowEnd = Date.parse(exercise.window.end);

    const calls: CallMeasure[] = exercise.calls.flatMap((call) => {
        const createdAt = Date.parse(call.createdAt);
        if (filter.from !== undefined && createdAt < filter.from) return [];
        if (filter.to !== undefined && createdAt >= filter.to) return [];
        if (filter.zoneId && call.zoneId !== filter.zoneId) return [];
        if (filter.category && call.category !== filter.category) return [];
        if (filter.priority && call.priority !== filter.priority) return [];
        const assignment = assignmentByCall.get(call.id);
        return [
            {
                id: call.id,
                category: call.category,
                priority: call.priority,
                zoneId: call.zoneId,
                createdAt,
                assignedAt: assignment?.assignedAt ?? null,
                ackAt: assignment?.ackAt ?? null,
                arrivedAt: assignment?.arrivedAt ?? null,
                clearedAt: assignment?.clearedAt ?? null,
                dispatchMin: assignment ? minutes(assignment.assignedAt, createdAt) : null,
                ackMin: assignment ? minutes(assignment.ackAt, assignment.assignedAt) : null,
                travelMin: assignment ? minutes(assignment.arrivedAt, assignment.ackAt) : null,
                responseMin: assignment ? minutes(assignment.arrivedAt, createdAt) : null,
                duringSuspension: createdAt >= suspensionStart && createdAt < suspensionEnd,
            },
        ];
    });

    const finished = calls.filter((call) => call.responseMin !== null);
    const outside = finished.filter((call) => !call.duringSuspension);
    const values = (rows: CallMeasure[], key: "dispatchMin" | "ackMin" | "travelMin" | "responseMin") =>
        rows.flatMap((call) => (call[key] === null ? [] : [call[key]]));

    const response = stats(values(finished, "responseMin"));
    const dispatch = stats(values(finished, "dispatchMin"));
    const ack = stats(values(finished, "ackMin"));
    const travel = stats(values(finished, "travelMin"));

    const slice = (key: string, label: string, rows: CallMeasure[]): NamedSlice => {
        const done = rows.filter((call) => call.responseMin !== null);
        const summary = stats(values(done, "responseMin"));
        return { key, label, count: rows.length, open: rows.length - done.length, median: summary.median, p90: summary.p90 };
    };

    const hours: HourPoint[] = [];
    for (let from = windowStart; from < windowEnd; from += HOUR) {
        const t = Math.min(from + HOUR, windowEnd);
        hours.push({
            t,
            received: calls.filter((call) => call.createdAt > from && call.createdAt <= t).length,
            waiting: calls.filter((call) => call.createdAt <= t && (call.assignedAt === null || call.assignedAt > t)).length,
            active: calls.filter((call) => call.assignedAt !== null && call.clearedAt !== null && call.assignedAt <= t && call.clearedAt > t).length,
            available: simulation.units.filter((unit) => onShift(unit, t) && !actuallyBusy(simulation.assignments, unit.id, t)).length,
            believed: simulation.units.filter((unit) => onShift(unit, t) && !believedBusy(simulation.assignments, unit.id, t)).length,
        });
    }

    const histogram = BINS.slice(0, -1).map((lo, index) => {
        const hi = BINS[index + 1];
        return {
            label: hi === Number.POSITIVE_INFINITY ? `${formatDuration(lo)}+` : lo === 0 ? `Under ${formatDuration(hi)}` : `${formatDuration(lo)}–${formatDuration(hi)}`,
            count: finished.filter((call) => call.responseMin !== null && call.responseMin >= lo && call.responseMin < hi).length,
        };
    });

    const byUnit = new Map<string, AssignmentRecord[]>();
    for (const assignment of simulation.assignments) {
        const list = byUnit.get(assignment.unitId) ?? [];
        list.push(assignment);
        byUnit.set(assignment.unitId, list);
    }

    const units: UnitRow[] = simulation.units
        .map((unit) => {
            const jobs = byUnit.get(unit.id) ?? [];
            const shift = Math.max(0, unit.shiftEnd - unit.readyAt);
            const onCall = jobs.reduce((sum, job) => sum + Math.max(0, job.returnedAt - job.assignedAt), 0);
            const cycles = jobs.map((job) => minutes(job.clearedAt, job.assignedAt));
            return {
                id: unit.id,
                callSign: unit.callSign,
                type: unit.type,
                assignments: jobs.length,
                onCallPct: shift > 0 ? (onCall / shift) * 100 : null,
                cycleMin: cycles.length ? cycles.reduce((sum, value) => sum + value, 0) / cycles.length : null,
                distanceMi: unit.distanceM / 1609.344,
                obstructions: unit.obstructions,
            };
        })
        .sort((a, b) => (b.onCallPct ?? -1) - (a.onCallPct ?? -1) || a.callSign.localeCompare(b.callSign));

    return {
        received: calls.length,
        completed: finished.length,
        open: calls.length - finished.length,
        response,
        responseOutsideSuspension: stats(values(outside, "responseMin")),
        dispatch,
        ack,
        travel,
        intervals: [
            { label: "Assignment", stats: dispatch },
            { label: "Acknowledged", stats: ack },
            { label: "Travel", stats: travel },
            { label: "On scene", stats: response },
        ],
        hours,
        histogram: histogram.filter((bin) => bin.count > 0),
        priorities: ([1, 2, 3] as const).map((priority) => slice(String(priority), `Priority ${priority}`, calls.filter((call) => call.priority === priority))),
        zones: exercise.zones
            .map((zone) => slice(zone.id, zone.name, calls.filter((call) => call.zoneId === zone.id)))
            .filter((zone) => zone.count > 0)
            .sort((a, b) => (b.median ?? -1) - (a.median ?? -1)),
        categories: [...new Set(calls.map((call) => call.category))]
            .map((key) => slice(key, key.replaceAll("_", " "), calls.filter((call) => call.category === key)))
            .sort((a, b) => (b.median ?? -1) - (a.median ?? -1)),
        units,
    };
}

function onShift(unit: SimulatedUnit, time: number) {
    return time >= unit.readyAt && time < unit.shiftEnd;
}

function actuallyBusy(assignments: AssignmentRecord[], unitId: string, time: number) {
    return assignments.some((job) => job.unitId === unitId && time >= job.assignedAt && time < job.returnedAt);
}

function believedBusy(assignments: AssignmentRecord[], unitId: string, time: number) {
    return assignments.some((job) => job.unitId === unitId && time >= job.assignedAt && time < job.knownFreeAt);
}
