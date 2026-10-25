import type { RoadGraph } from "@/lib/model/data/loader";
import type { ExerciseInputs, Unit, UnitType } from "@/lib/model/types";
import { buildNetwork, edgesInside, roadPath, type RoadNetwork } from "@/lib/simulation/roads";

export interface TrackPoint {
    t: number;
    lon: number;
    lat: number;
}

export interface Trip {
    start: number;
    end: number;
}

export interface SimulatedUnit {
    id: string;
    callSign: string;
    type: UnitType;
    classification: Unit["classification"];
    shiftEnd: number;
    track: TrackPoint[];
    trips: Trip[];
}

export interface HandledCall {
    id: string;
    at: number;
}

export interface Simulation {
    units: SimulatedUnit[];
    handled: HandledCall[];
}

interface Place {
    lon: number;
    lat: number;
}

interface Phase {
    t: number;
    factor: number;
}

interface Runner {
    unit: Unit;
    place: Place;
    homeId: string;
    readyAt: number;
    shiftEnd: number;
    freeAt: number;
    track: TrackPoint[];
    trips: Trip[];
    discovered: Set<number>;
    skipped: Set<string>;
}

function meters(from: Place, to: Place) {
    const radius = 6371000;
    const lat1 = (from.lat * Math.PI) / 180;
    const lat2 = (to.lat * Math.PI) / 180;
    const dLat = lat2 - lat1;
    const dLon = ((to.lon - from.lon) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(h));
}

function factorAt(phases: Phase[], time: number) {
    let factor = 1;
    for (const phase of phases) {
        if (phase.t > time) break;
        factor = phase.factor;
    }
    return factor;
}

function drives(type: UnitType) {
    return type !== "air_rescue" && type !== "rescue_boat";
}

function canServe(unit: Unit, call: ExerciseInputs["calls"][number]) {
    if (!unit.capabilities.includes(call.category)) return false;
    if (unit.type === "air_rescue" && call.priority !== 1) return false;
    return true;
}

function homeAt(inputs: ExerciseInputs, homeId: string, time: number): Place {
    const sites = new Map(inputs.staging.map((site) => [site.id, site]));
    let site = sites.get(homeId);
    if (!site) return { lon: 0, lat: 0 };
    if (site.unsuitableFrom && time >= Date.parse(site.unsuitableFrom) && site.relocateTo) {
        site = sites.get(site.relocateTo) ?? site;
    }
    return site.location;
}

function hold(runner: Runner, time: number) {
    const last = runner.track[runner.track.length - 1];
    if (last && last.t >= time) return;
    runner.track.push({ t: time, lon: runner.place.lon, lat: runner.place.lat });
}

function trace(runner: Runner, points: Place[], depart: number, arrive: number) {
    if (!points.length) return;
    const end = points[points.length - 1];
    hold(runner, depart);
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + meters(points[i - 1], points[i]));
    const total = cumulative[cumulative.length - 1];
    if (total < 1 || arrive <= depart) {
        const last = runner.track[runner.track.length - 1];
        if (!last || last.t < arrive) runner.track.push({ t: Math.max(arrive, depart), lon: end.lon, lat: end.lat });
        runner.place = end;
        return;
    }
    for (let i = 1; i < points.length; i++) {
        const at = depart + ((arrive - depart) * cumulative[i]) / total;
        const point = points[i];
        const last = runner.track[runner.track.length - 1];
        if (last && at + 1 < last.t) continue;
        runner.track.push({ t: at, lon: point.lon, lat: point.lat });
    }
    runner.place = end;
}

export function positionAt(track: TrackPoint[], time: number): TrackPoint | null {
    if (!track.length || time < track[0].t) return null;
    const last = track[track.length - 1];
    if (time >= last.t) return last;

    let low = 0;
    let high = track.length - 1;
    while (low + 1 < high) {
        const mid = (low + high) >> 1;
        if (track[mid].t <= time) low = mid;
        else high = mid;
    }

    const from = track[low];
    const to = track[high];
    const span = to.t - from.t;
    const fraction = span === 0 ? 0 : (time - from.t) / span;
    return {
        t: time,
        lon: from.lon + (to.lon - from.lon) * fraction,
        lat: from.lat + (to.lat - from.lat) * fraction,
    };
}

export function simulate(inputs: ExerciseInputs, roads: RoadGraph | null): Simulation {
    const network: RoadNetwork | null = roads ? buildNetwork(roads) : null;
    const phases: Phase[] = inputs.speedPhases
        .map((phase) => ({ t: Date.parse(phase.start), factor: phase.factor }))
        .sort((a, b) => a.t - b.t);
    const suspensionStart = inputs.suspension ? Date.parse(inputs.suspension.start) : Number.POSITIVE_INFINITY;
    const suspensionEnd = inputs.suspension ? Date.parse(inputs.suspension.end) : Number.NEGATIVE_INFINITY;
    const windowEnd = Date.parse(inputs.window.end);
    const ackMs = ((inputs.baseAckMin[0] + inputs.baseAckMin[1]) / 2) * 60_000;

    const runners: Runner[] = inputs.units.map((unit) => {
        const home = homeAt(inputs, unit.stagingId, Date.parse(unit.shiftStart));
        let readyAt = Date.parse(unit.shiftStart);
        const delayed = unit.restrictions.some((note) => note.includes("post-landfall") || note.includes("after storm"));
        if (delayed) readyAt = Math.max(readyAt, suspensionEnd);
        return {
            unit,
            place: home,
            homeId: unit.stagingId,
            readyAt,
            shiftEnd: Date.parse(unit.shiftEnd),
            freeAt: readyAt,
            track: [{ t: readyAt, lon: home.lon, lat: home.lat }],
            trips: [],
            discovered: new Set<number>(),
            skipped: new Set<string>(),
        };
    });

    const calls = [...inputs.calls].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.priority - b.priority);
    const handled: HandledCall[] = [];
    const waiting: ExerciseInputs["calls"] = [];
    let nextCall = 0;
    const queue = [Date.parse(inputs.window.start), ...calls.map((call) => Date.parse(call.createdAt))];
    queue.sort((a, b) => a - b);
    const seen = new Set<number>();

    function push(time: number) {
        if (!Number.isFinite(time) || time > windowEnd || seen.has(time)) return;
        seen.add(time);
        queue.push(time);
        queue.sort((a, b) => a - b);
    }

    const floodStart = Date.parse(inputs.floodRestriction.start);
    const floodEnd = Date.parse(inputs.floodRestriction.end);
    const floodEdges = network ? edgesInside(network, inputs.floodRestriction.rings) : null;
    const closureEdges = new Map<number, ExerciseInputs["disruptions"]>();
    for (const disruption of inputs.disruptions) {
        for (const edge of disruption.edgeIds) {
            const list = closureEdges.get(edge) ?? [];
            list.push(disruption);
            closureEdges.set(edge, list);
        }
    }
    const maskCache = new Map<string, Uint8Array>();

    function closureActive(disruption: ExerciseInputs["disruptions"][number], time: number) {
        const end = disruption.end ? Date.parse(disruption.end) : Infinity;
        return time >= Date.parse(disruption.start) && time < end;
    }

    function affects(disruption: ExerciseInputs["disruptions"][number], mode: "ground" | "high_water") {
        return disruption.affects.includes("all") || disruption.affects.includes(mode);
    }

    function maskFor(mode: "ground" | "high_water", time: number, discovered: Set<number>) {
        if (!network) return { mask: null as Uint8Array | null, key: "none" };
        const known: string[] = [];
        const mask = new Uint8Array(network.edgeCount);
        for (const disruption of inputs.disruptions) {
            if (!affects(disruption, mode) || !closureActive(disruption, time)) continue;
            known.push(disruption.id);
            for (const edge of disruption.edgeIds) if (edge >= 0 && edge < mask.length) mask[edge] = 1;
        }
        if (mode === "ground" && floodEdges && time >= floodStart && time < floodEnd) {
            known.push("flood");
            for (let edge = 0; edge < floodEdges.length; edge++) if (floodEdges[edge]) mask[edge] = 1;
        }
        const extra = [...discovered].sort((a, b) => a - b);
        for (const edge of extra) if (edge >= 0 && edge < mask.length) mask[edge] = 1;
        const key = `${mode}|${known.join(".")}|${extra.join(".")}`;
        const cached = maskCache.get(key);
        if (cached) return { mask: cached, key };
        maskCache.set(key, mask);
        return { mask, key };
    }

    function blockedNow(edge: number, mode: "ground" | "high_water", time: number) {
        const list = closureEdges.get(edge);
        if (list) {
            for (const disruption of list) {
                if (affects(disruption, mode) && closureActive(disruption, time)) return disruption;
            }
        }
        if (mode === "ground" && floodEdges?.[edge] && time >= floodStart && time < floodEnd) return "flood" as const;
        return null;
    }

    function closesDuring(edge: number, mode: "ground" | "high_water", from: number, to: number) {
        const list = closureEdges.get(edge);
        if (list) {
            for (const disruption of list) {
                if (!affects(disruption, mode)) continue;
                const start = Date.parse(disruption.start);
                if (start > from && start < to) return disruption;
            }
        }
        if (mode === "ground" && floodEdges?.[edge] && floodStart > from && floodStart < to) return "flood" as const;
        return null;
    }

    function noteBlock(runner: Runner, edge: number, block: ExerciseInputs["disruptions"][number] | "flood") {
        if (block === "flood") {
            runner.discovered.add(edge);
            return;
        }
        for (const other of block.edgeIds) runner.discovered.add(other);
    }

    function straightMs(type: UnitType, from: Place, to: Place, respond: boolean) {
        const prep = respond && type === "rescue_boat" ? 10 * 60_000 : respond && type === "air_rescue" ? 15 * 60_000 : 0;
        const kmh = type === "rescue_boat" ? 30 : type === "air_rescue" ? 150 : 40;
        return prep + (meters(from, to) / (kmh / 3.6)) * 1000;
    }

    function roadMs(from: Place, to: Place, depart: number, mode: "ground" | "high_water", offNetworkM: number, discovered: Set<number>) {
        if (!network) return Infinity;
        const { mask, key } = maskFor(mode, depart, discovered);
        const route = roadPath(network, from, to, mask, key);
        if (!route) return Infinity;
        const factor = Math.max(factorAt(phases, depart), 0.05);
        let seconds = 0;
        for (const leg of route.legs) seconds += leg.seconds;
        const stubs = route.headMeters + route.tailMeters + offNetworkM;
        return (seconds / factor) * 1000 + (stubs / (12 / 3.6)) * 1000;
    }

    function arrival(from: Place, to: Place, depart: number, type: UnitType, offNetworkM: number, respond: boolean, discovered: Set<number>) {
        if (network && drives(type)) {
            const mode = type === "high_water" ? "high_water" : "ground";
            return roadMs(from, to, depart, mode, offNetworkM, discovered);
        }
        return straightMs(type, from, to, respond);
    }

    function drive(runner: Runner, to: Place, depart: number, offNetworkM: number, respond: boolean) {
        if (!network || !drives(runner.unit.type)) {
            const duration = straightMs(runner.unit.type, runner.place, to, respond);
            const prep = duration - (meters(runner.place, to) / ((runner.unit.type === "rescue_boat" ? 30 : 150) / 3.6)) * 1000;
            const start = depart + (respond ? Math.max(0, prep) : 0);
            if (start > depart) hold(runner, start);
            trace(runner, [runner.place, to], start, depart + duration);
            return depart + duration;
        }

        const mode = runner.unit.type === "high_water" ? "high_water" : "ground";
        let time = depart;
        for (let attempt = 0; attempt < 8; attempt++) {
            const { mask, key } = maskFor(mode, time, runner.discovered);
            const route = roadPath(network, runner.place, to, mask, key);
            if (!route) return Number.NaN;
            const factor = Math.max(factorAt(phases, time), 0.05);
            if (route.headMeters > 1) {
                const headEnd = time + (route.headMeters / (12 / 3.6)) * 1000;
                trace(runner, route.head, time, headEnd);
                time = headEnd;
            }
            let stopped = false;
            for (const leg of route.legs) {
                const legEnd = time + (leg.seconds / factor) * 1000;
                const block = blockedNow(leg.edge, mode, time) ?? closesDuring(leg.edge, mode, time, legEnd);
                if (block && mask && !mask[leg.edge]) {
                    noteBlock(runner, leg.edge, block);
                    stopped = true;
                    break;
                }
                trace(runner, leg.points, time, legEnd);
                time = legEnd;
            }
            if (stopped) continue;
            const tailMeters = route.tailMeters + offNetworkM;
            if (tailMeters > 1) {
                const tailEnd = time + (tailMeters / (12 / 3.6)) * 1000;
                trace(runner, route.tail.length ? route.tail : [runner.place, to], time, tailEnd);
                time = tailEnd;
            }
            runner.place = to;
            return time;
        }
        return Number.NaN;
    }

    function reachable(runner: Runner, call: ExerciseInputs["calls"][number], time: number) {
        if (call.inModeledFloodArea && time >= floodStart && time < floodEnd && drives(runner.unit.type) && runner.unit.type !== "high_water") return false;
        return true;
    }

    function choose(call: ExerciseInputs["calls"][number], time: number) {
        let chosen: Runner | undefined;
        let soonest = Infinity;
        for (const runner of runners) {
            if (!canServe(runner.unit, call) || runner.skipped.has(call.id) || !reachable(runner, call, time)) continue;
            if (runner.freeAt > time || runner.readyAt > time) continue;
            const depart = time + ackMs;
            if (depart >= runner.shiftEnd) continue;
            const home = homeAt(inputs, runner.homeId, depart);
            let leave = depart;
            let origin = runner.place;
            if (meters(origin, home) > 50) {
                leave = arrival(origin, home, depart, runner.unit.type, 0, false, runner.discovered);
                if (!Number.isFinite(leave)) continue;
                origin = home;
            }
            const arrive = arrival(origin, call.location, leave, runner.unit.type, call.offNetworkM, true, runner.discovered);
            if (!Number.isFinite(arrive) || arrive >= soonest) continue;
            chosen = runner;
            soonest = arrive;
        }
        return chosen;
    }

    let steps = 0;
    while (queue.length && steps < 20000) {
        steps += 1;
        const time = queue.shift();
        if (time === undefined || time > windowEnd) break;
        seen.add(time);

        while (nextCall < calls.length && Date.parse(calls[nextCall].createdAt) <= time) {
            waiting.push(calls[nextCall]);
            nextCall += 1;
        }
        waiting.sort((a, b) => {
            if (inputs.policy === "nearest_first") return Date.parse(a.createdAt) - Date.parse(b.createdAt);
            return a.priority - b.priority || Date.parse(a.createdAt) - Date.parse(b.createdAt);
        });

        const suspended = time >= suspensionStart && time < suspensionEnd;
        let parked = 0;
        while (!suspended && waiting.length && parked < waiting.length) {
            const call = waiting[0];
            if (!runners.some((runner) => canServe(runner.unit, call))) {
                waiting.shift();
                continue;
            }
            const runner = choose(call, time);
            if (!runner) {
                const busy = runners.some((runner) => canServe(runner.unit, call) && !runner.skipped.has(call.id) && runner.freeAt > time);
                if (busy) break;
                const deferred = waiting.shift();
                if (!deferred) break;
                waiting.push(deferred);
                parked += 1;
                continue;
            }
            parked = 0;

            runner.freeAt = Number.POSITIVE_INFINITY;
            const depart = time + ackMs;
            const home = homeAt(inputs, runner.homeId, depart);
            if (meters(runner.place, home) > 50) {
                const relocated = drive(runner, home, depart, 0, false);
                if (!Number.isFinite(relocated)) {
                    runner.skipped.add(call.id);
                    runner.freeAt = time;
                    continue;
                }
            } else hold(runner, depart);
            const leave = runner.track[runner.track.length - 1].t;
            const arrived = drive(runner, call.location, leave, call.offNetworkM, true);
            if (!Number.isFinite(arrived)) {
                runner.skipped.add(call.id);
                runner.freeAt = leave;
                push(leave);
                continue;
            }
            const clear = arrived + call.serviceMin * 60_000;
            handled.push({ id: call.id, at: clear });
            hold(runner, clear);
            const backHome = homeAt(inputs, runner.homeId, clear);
            const back = drive(runner, backHome, clear, 0, false);
            const done = Number.isFinite(back) ? back : clear;
            runner.freeAt = done + runner.unit.statusReportLagMin * 60_000;
            if (done > depart) runner.trips.push({ start: depart, end: done });
            waiting.shift();
            push(runner.freeAt);
        }

        if (!waiting.length) continue;
        if (suspended) push(suspensionEnd);
        if (time < floodEnd && waiting.some((call) => call.inModeledFloodArea)) push(floodEnd);
        let nextFree = Infinity;
        for (const runner of runners) {
            if (runner.freeAt > time && runner.freeAt < nextFree) nextFree = runner.freeAt;
        }
        if (nextFree < Infinity) push(nextFree);
    }

    return {
        units: runners.map((runner) => ({
            id: runner.unit.id,
            callSign: runner.unit.callSign,
            type: runner.unit.type,
            classification: runner.unit.classification,
            shiftEnd: runner.shiftEnd,
            track: runner.track,
            trips: runner.trips,
        })),
        handled,
    };
}
