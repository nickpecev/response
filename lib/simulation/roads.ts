import type { RoadGraph } from "@/lib/model/data/loader";

interface Place {
    lon: number;
    lat: number;
}

interface Leg {
    edge: number;
    points: Place[];
    seconds: number;
}

export interface RoadRoute {
    head: Place[];
    headMeters: number;
    legs: Leg[];
    tail: Place[];
    tailMeters: number;
}

interface CachedRoute {
    legs: Leg[];
}

export interface RoadNetwork {
    count: number;
    edgeCount: number;
    lon: Float64Array;
    lat: Float64Array;
    from: Int32Array;
    to: Int32Array;
    seconds: Float64Array;
    geomStart: Int32Array;
    geomEnd: Int32Array;
    geom: Float64Array;
    adjStart: Int32Array;
    adjEdge: Int32Array;
    grid: Map<string, number[]>;
    cache: Map<string, CachedRoute | null>;
}

const CLASS_KMH: Record<string, number> = {
    motorway: 105,
    trunk: 80,
    primary: 65,
    secondary: 55,
    tertiary: 45,
    unclassified: 40,
    motorway_link: 55,
    trunk_link: 50,
    primary_link: 45,
};

const CELL = 0.01;

function meters(from: Place, to: Place) {
    const radius = 6371000;
    const lat1 = (from.lat * Math.PI) / 180;
    const lat2 = (to.lat * Math.PI) / 180;
    const dLat = lat2 - lat1;
    const dLon = ((to.lon - from.lon) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(h));
}

function samePlace(a: Place, b: Place) {
    return Math.abs(a.lon - b.lon) < 1e-6 && Math.abs(a.lat - b.lat) < 1e-6;
}

export function buildNetwork(graph: RoadGraph): RoadNetwork {
    const count = graph.nodes.length / 2;
    const edgeCount = graph.edges.length;
    const lon = new Float64Array(count);
    const lat = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        lon[i] = graph.nodes[i * 2];
        lat[i] = graph.nodes[i * 2 + 1];
    }

    const from = new Int32Array(edgeCount);
    const to = new Int32Array(edgeCount);
    const seconds = new Float64Array(edgeCount);
    const geomStart = new Int32Array(edgeCount);
    const geomEnd = new Int32Array(edgeCount);
    const degree = new Int32Array(count + 1);
    for (let i = 0; i < edgeCount; i++) {
        const edge = graph.edges[i];
        from[i] = edge[0];
        to[i] = edge[1];
        const kmh = CLASS_KMH[graph.classes[edge[3]]] ?? 40;
        seconds[i] = edge[2] / ((kmh * 1000) / 3600);
        geomStart[i] = edge[5];
        geomEnd[i] = edge[6];
        degree[edge[0] + 1] += 1;
        degree[edge[1] + 1] += 1;
    }
    for (let i = 1; i <= count; i++) degree[i] += degree[i - 1];
    const adjStart = Int32Array.from(degree);
    const adjEdge = new Int32Array(edgeCount * 2);
    const fill = new Int32Array(count);
    for (let i = 0; i < edgeCount; i++) {
        adjEdge[adjStart[from[i]] + fill[from[i]]++] = i;
        adjEdge[adjStart[to[i]] + fill[to[i]]++] = i;
    }

    const grid = new Map<string, number[]>();
    for (let i = 0; i < count; i++) {
        const key = `${Math.floor(lon[i] / CELL)}:${Math.floor(lat[i] / CELL)}`;
        const cell = grid.get(key);
        if (cell) cell.push(i);
        else grid.set(key, [i]);
    }

    return {
        count,
        edgeCount,
        lon,
        lat,
        from,
        to,
        seconds,
        geomStart,
        geomEnd,
        geom: Float64Array.from(graph.geom),
        adjStart,
        adjEdge,
        grid,
        cache: new Map(),
    };
}

function inside(lon: number, lat: number, ring: [number, number][]) {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
}

export function edgesInside(network: RoadNetwork, rings: [number, number][][]) {
    const blocked = new Uint8Array(network.edgeCount);
    for (let edge = 0; edge < network.edgeCount; edge++) {
        const mid = Math.floor((network.geomStart[edge] + network.geomEnd[edge]) / 4) * 2;
        const lon = network.geom[mid];
        const lat = network.geom[mid + 1];
        if (rings.some((ring) => inside(lon, lat, ring))) blocked[edge] = 1;
    }
    return blocked;
}

function nearest(network: RoadNetwork, place: Place) {
    const cx = Math.floor(place.lon / CELL);
    const cy = Math.floor(place.lat / CELL);
    const cos = Math.cos((place.lat * Math.PI) / 180);
    let best = -1;
    let bestScore = Infinity;
    for (let ring = 0; ring < 25; ring++) {
        for (let dx = -ring; dx <= ring; dx++) {
            for (let dy = -ring; dy <= ring; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
                const cell = network.grid.get(`${cx + dx}:${cy + dy}`);
                if (!cell) continue;
                for (const node of cell) {
                    const dLon = (network.lon[node] - place.lon) * cos;
                    const dLat = network.lat[node] - place.lat;
                    const score = dLon * dLon + dLat * dLat;
                    if (score < bestScore) {
                        bestScore = score;
                        best = node;
                    }
                }
            }
        }
        if (best >= 0 && Math.sqrt(bestScore) * 111000 < ring * CELL * 111000 * 0.85) break;
    }
    if (best >= 0) return best;
    for (let i = 0; i < network.count; i++) {
        const dLon = (network.lon[i] - place.lon) * cos;
        const dLat = network.lat[i] - place.lat;
        const score = dLon * dLon + dLat * dLat;
        if (score < bestScore) {
            bestScore = score;
            best = i;
        }
    }
    return best;
}

function heapPush(dist: number[], node: number[], size: number, nextDist: number, nextNode: number) {
    let i = size;
    dist[i] = nextDist;
    node[i] = nextNode;
    while (i > 0) {
        const parent = (i - 1) >> 1;
        if (dist[parent] <= dist[i]) break;
        const swapDist = dist[parent];
        dist[parent] = dist[i];
        dist[i] = swapDist;
        const swapNode = node[parent];
        node[parent] = node[i];
        node[i] = swapNode;
        i = parent;
    }
}

function heapPop(dist: number[], node: number[], size: number) {
    const result = node[0];
    const last = size - 1;
    dist[0] = dist[last];
    node[0] = node[last];
    let i = 0;
    while (true) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < last && dist[left] < dist[smallest]) smallest = left;
        if (right < last && dist[right] < dist[smallest]) smallest = right;
        if (smallest === i) break;
        const swapDist = dist[smallest];
        dist[smallest] = dist[i];
        dist[i] = swapDist;
        const swapNode = node[smallest];
        node[smallest] = node[i];
        node[i] = swapNode;
        i = smallest;
    }
    return result;
}

function geometry(network: RoadNetwork, edge: number, fromNode: number) {
    const points: Place[] = [];
    for (let i = network.geomStart[edge]; i < network.geomEnd[edge]; i += 2) {
        points.push({ lon: network.geom[i], lat: network.geom[i + 1] });
    }
    if (fromNode === network.to[edge]) points.reverse();
    return points;
}

function search(network: RoadNetwork, start: number, goal: number, blocked: Uint8Array | null): CachedRoute | null {
    if (start === goal) return { legs: [] };
    const cost = new Float64Array(network.count);
    cost.fill(Infinity);
    const cameFrom = new Int32Array(network.count);
    const via = new Int32Array(network.count);
    cameFrom.fill(-1);
    via.fill(-1);
    const settled = new Uint8Array(network.count);
    const heapDist: number[] = [];
    const heapNode: number[] = [];
    let heapSize = 0;
    const goalLon = network.lon[goal];
    const goalLat = network.lat[goal];

    const heuristic = (node: number) => {
        const midLat = ((network.lat[node] + goalLat) / 2) * (Math.PI / 180);
        const dLon = (network.lon[node] - goalLon) * Math.cos(midLat);
        const dLat = network.lat[node] - goalLat;
        return Math.hypot(dLon, dLat) * 111000 / ((105 * 1000) / 3600);
    };

    cost[start] = 0;
    heapPush(heapDist, heapNode, heapSize, heuristic(start), start);
    heapSize += 1;

    while (heapSize > 0) {
        const node = heapPop(heapDist, heapNode, heapSize);
        heapSize -= 1;
        if (settled[node]) continue;
        settled[node] = 1;
        if (node === goal) {
            const steps: { node: number; edge: number }[] = [];
            let cursor = goal;
            while (cursor !== start) {
                const previous = cameFrom[cursor];
                if (previous < 0) return null;
                steps.push({ node: previous, edge: via[cursor] });
                cursor = previous;
            }
            steps.reverse();
            const legs: Leg[] = [];
            for (const step of steps) {
                const points = geometry(network, step.edge, step.node);
                legs.push({ edge: step.edge, points, seconds: network.seconds[step.edge] });
            }
            return { legs };
        }

        for (let i = network.adjStart[node]; i < network.adjStart[node + 1]; i++) {
            const edge = network.adjEdge[i];
            if (blocked && blocked[edge]) continue;
            const next = network.from[edge] === node ? network.to[edge] : network.from[edge];
            if (settled[next]) continue;
            const nextCost = cost[node] + network.seconds[edge];
            if (nextCost >= cost[next]) continue;
            cost[next] = nextCost;
            cameFrom[next] = node;
            via[next] = edge;
            heapPush(heapDist, heapNode, heapSize, nextCost + heuristic(next), next);
            heapSize += 1;
        }
    }
    return null;
}

export function roadPath(network: RoadNetwork, from: Place, to: Place, blocked: Uint8Array | null, key: string): RoadRoute | null {
    const start = nearest(network, from);
    const goal = nearest(network, to);
    if (start < 0 || goal < 0) return null;
    const cacheKey = `${start}:${goal}:${key}`;
    let cached = network.cache.get(cacheKey);
    if (cached === undefined) {
        cached = search(network, start, goal, blocked);
        network.cache.set(cacheKey, cached);
    }
    if (!cached) return null;

    const startPlace = { lon: network.lon[start], lat: network.lat[start] };
    const goalPlace = { lon: network.lon[goal], lat: network.lat[goal] };
    const head = samePlace(from, startPlace) ? [] : [from, startPlace];
    const tail = samePlace(to, goalPlace) ? [] : [goalPlace, to];
    return {
        head,
        headMeters: head.length ? meters(from, startPlace) : 0,
        legs: cached.legs,
        tail,
        tailMeters: tail.length ? meters(goalPlace, to) : 0,
    };
}
