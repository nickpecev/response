import type { RoadGraph } from "@/lib/model/data/loader";
import type { ExerciseInputs, Unit, UnitType } from "@/lib/model/types";
import { buildNetwork, roadPath, type RoadNetwork } from "@/lib/simulation/roads";

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

export interface Simulation {
    units: SimulatedUnit[];
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

function baseSpeed(type: UnitType) {
    if (type === "air_rescue") return 55;
    if (type === "rescue_boat") return 10;
    return 16;
}

function factorAt(phases: Phase[], time: number) {
    let factor = 1;
    for (const phase of phases) {
        if (phase.t > time) break;
        factor = phase.factor;
    }
    return factor;
}

function nextPhase(phases: Phase[], time: number) {
    for (const phase of phases) {
        if (phase.t > time) return phase.t;
    }
    return undefined;
}

function drives(type: UnitType) {
    return type !== "air_rescue" && type !== "rescue_boat";
}

function eta(distance: number, depart: number, phases: Phase[], type: UnitType) {
    let remaining = distance;
    let time = depart;
    const speed = baseSpeed(type);
    while (remaining > 1) {
        const rate = speed * factorAt(phases, time);
        const boundary = nextPhase(phases, time);
        if (rate < 0.2) {
            time = boundary ?? time + (remaining / 0.2) * 1000;
            if (!boundary) break;
            continue;
        }
        if (boundary === undefined) {
            time += (remaining / rate) * 1000;
            break;
        }
        const slice = ((boundary - time) / 1000) * rate;
        if (slice >= remaining) {
            time += (remaining / rate) * 1000;
            break;
        }
        remaining -= slice;
        time = boundary;
    }
    return time;
}

function arriveAt(from: Place, to: Place, depart: number, phases: Phase[], type: UnitType) {
    return eta(meters(from, to), depart, phases, type);
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

function distanceBy(from: Place, to: Place, depart: number, until: number, phases: Phase[], type: UnitType) {
    let covered = 0;
    let time = depart;
    const speed = baseSpeed(type);
    const total = meters(from, to);
    while (time < until && covered < total) {
        const rate = Math.max(speed * factorAt(phases, time), 0.2);
        const boundary = nextPhase(phases, time);
        const mark = boundary !== undefined && boundary < until ? boundary : until;
        covered += ((mark - time) / 1000) * rate;
        time = mark;
    }
    return Math.min(covered, total);
}

function follow(runner: Runner, points: Place[], depart: number, arrive: number, phases: Phase[]) {
    hold(runner, depart);
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + meters(points[i - 1], points[i]));
    const total = cumulative[cumulative.length - 1];
    const end = points[points.length - 1];
    if (total < 1 || arrive <= depart) {
        runner.track.push({ t: Math.max(arrive, depart), lon: end.lon, lat: end.lat });
        runner.place = end;
        return;
    }

    const speed = baseSpeed(runner.unit.type);
    let time = depart;
    let covered = 0;
    let vertex = 1;
    while (vertex < points.length && time < arrive) {
        const rate = Math.max(speed * factorAt(phases, time), 0.2);
        const boundary = nextPhase(phases, time);
        const mark = Math.min(boundary ?? arrive, arrive);
        const can = ((mark - time) / 1000) * rate;
        const need = cumulative[vertex] - covered;
        if (need <= can + 0.01) {
            const at = Math.min(time + (need / rate) * 1000, arrive);
            covered = cumulative[vertex];
            const point = points[vertex];
            runner.track.push({ t: at, lon: point.lon, lat: point.lat });
            time = at;
            vertex += 1;
            if (at >= arrive) break;
        } else {
            covered += can;
            time = mark;
        }
    }
    const last = runner.track[runner.track.length - 1];
    if (!last || last.t < arrive) runner.track.push({ t: arrive, lon: end.lon, lat: end.lat });
    runner.place = end;
}

function go(runner: Runner, to: Place, depart: number, arrive: number, phases: Phase[]) {
    hold(runner, depart);
    const total = meters(runner.place, to);
    if (total < 1 || arrive <= depart) {
        runner.track.push({ t: Math.max(arrive, depart), lon: to.lon, lat: to.lat });
        runner.place = to;
        return;
    }
    const started = runner.place;
    const marks = [arrive];
    for (const phase of phases) {
        if (phase.t > depart && phase.t < arrive) marks.push(phase.t);
    }
    marks.sort((a, b) => a - b);
    for (const mark of marks) {
        const fraction = distanceBy(started, to, depart, mark, phases, runner.unit.type) / total;
        runner.track.push({
            t: mark,
            lon: started.lon + (to.lon - started.lon) * fraction,
            lat: started.lat + (to.lat - started.lat) * fraction,
        });
    }
    runner.place = to;
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
    const suspensionStart = Date.parse(inputs.suspension.start);
    const suspensionEnd = Date.parse(inputs.suspension.end);
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
        };
    });

    const calls = [...inputs.calls].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.priority - b.priority);
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

    function arrival(from: Place, to: Place, depart: number, type: UnitType) {
        if (network && drives(type)) {
            const route = roadPath(network, from, to);
            if (route) return eta(route.meters, depart, phases, type);
        }
        return arriveAt(from, to, depart, phases, type);
    }

    function drive(runner: Runner, to: Place, depart: number) {
        if (network && drives(runner.unit.type)) {
            const route = roadPath(network, runner.place, to);
            if (route) {
                const arrive = eta(route.meters, depart, phases, runner.unit.type);
                follow(runner, route.points, depart, arrive, phases);
                return arrive;
            }
        }
        const arrive = arriveAt(runner.place, to, depart, phases, runner.unit.type);
        go(runner, to, depart, arrive, phases);
        return arrive;
    }

    function choose(call: ExerciseInputs["calls"][number], time: number) {
        let chosen: Runner | undefined;
        let soonest = Infinity;
        for (const runner of runners) {
            if (!canServe(runner.unit, call)) continue;
            if (runner.freeAt > time || runner.readyAt > time) continue;
            const depart = time + ackMs;
            if (depart >= runner.shiftEnd) continue;
            const home = homeAt(inputs, runner.homeId, depart);
            let leave = depart;
            let origin = runner.place;
            if (meters(origin, home) > 50) {
                leave = arrival(origin, home, depart, runner.unit.type);
                origin = home;
            }
            const arrive = arrival(origin, call.location, leave, runner.unit.type);
            if (arrive < soonest) {
                chosen = runner;
                soonest = arrive;
            }
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
        waiting.sort((a, b) => a.priority - b.priority || Date.parse(a.createdAt) - Date.parse(b.createdAt));

        const suspended = time >= suspensionStart && time < suspensionEnd;
        while (!suspended && waiting.length) {
            const call = waiting[0];
            if (!runners.some((runner) => canServe(runner.unit, call))) {
                waiting.shift();
                continue;
            }
            const runner = choose(call, time);
            if (!runner) break;

            runner.freeAt = Number.POSITIVE_INFINITY;
            const depart = time + ackMs;
            const home = homeAt(inputs, runner.homeId, depart);
            if (meters(runner.place, home) > 50) drive(runner, home, depart);
            else hold(runner, depart);
            const leave = runner.track[runner.track.length - 1].t;
            const arrived = drive(runner, call.location, leave);
            const clear = arrived + call.serviceMin * 60_000;
            hold(runner, clear);
            const backHome = homeAt(inputs, runner.homeId, clear);
            const back = drive(runner, backHome, clear);
            runner.freeAt = back;
            if (back > depart) runner.trips.push({ start: depart, end: back });
            waiting.shift();
            push(back);
        }

        if (!waiting.length) continue;
        if (suspended) push(suspensionEnd);
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
    };
}
