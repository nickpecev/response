import type { RoadGraph } from "@/lib/model/data/loader";

interface Place {
    lon: number;
    lat: number;
}

interface Link {
    to: number;
    meters: number;
    points: Place[];
}

export interface RoadRoute {
    points: Place[];
    meters: number;
}

export interface RoadNetwork {
    nodes: Place[];
    links: Link[][];
    component: Int32Array;
    cache: Map<string, Place[] | null>;
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

function lineLength(points: Place[]) {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += meters(points[i - 1], points[i]);
    return total;
}

export function buildNetwork(graph: RoadGraph): RoadNetwork {
    const count = graph.nodes.length / 2;
    const nodes: Place[] = [];
    for (let i = 0; i < count; i++) {
        nodes.push({ lon: graph.nodes[i * 2], lat: graph.nodes[i * 2 + 1] });
    }

    const links: Link[][] = Array.from({ length: count }, () => []);
    const undirected: number[][] = Array.from({ length: count }, () => []);
    for (const edge of graph.edges) {
        const from = edge[0];
        const to = edge[1];
        const oneway = edge[4] === 1;
        const line: Place[] = [];
        for (let i = edge[5]; i < edge[6]; i += 2) {
            line.push({ lon: graph.geom[i], lat: graph.geom[i + 1] });
        }
        if (line.length < 2) continue;
        const length = lineLength(line);
        links[from].push({ to, meters: length, points: line.slice(1) });
        undirected[from].push(to);
        undirected[to].push(from);
        if (!oneway) {
            const backward: Place[] = [];
            for (let i = line.length - 2; i >= 0; i--) backward.push(line[i]);
            links[to].push({ to: from, meters: length, points: backward });
        }
    }

    const component = new Int32Array(count);
    component.fill(-1);
    let componentId = 0;
    for (let i = 0; i < count; i++) {
        if (component[i] >= 0) continue;
        const stack = [i];
        component[i] = componentId;
        while (stack.length) {
            const node = stack.pop();
            if (node === undefined) break;
            for (const next of undirected[node]) {
                if (component[next] >= 0) continue;
                component[next] = componentId;
                stack.push(next);
            }
        }
        componentId += 1;
    }

    return { nodes, links, component, cache: new Map() };
}

function nearest(network: RoadNetwork, place: Place) {
    let best = 0;
    let bestScore = Infinity;
    const cos = Math.cos((place.lat * Math.PI) / 180);
    for (let i = 0; i < network.nodes.length; i++) {
        const node = network.nodes[i];
        const dx = (node.lon - place.lon) * cos;
        const dy = node.lat - place.lat;
        const score = dx * dx + dy * dy;
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

function search(network: RoadNetwork, start: number, goal: number): Place[] | null {
    if (start === goal) return [network.nodes[start]];

    const count = network.nodes.length;
    const cost = new Float64Array(count);
    cost.fill(Infinity);
    const cameFrom = new Int32Array(count);
    const via = new Int32Array(count);
    cameFrom.fill(-1);
    via.fill(-1);
    const settled = new Uint8Array(count);
    const heapDist: number[] = [];
    const heapNode: number[] = [];
    let heapSize = 0;
    const goalPlace = network.nodes[goal];

    cost[start] = 0;
    heapPush(heapDist, heapNode, heapSize, meters(network.nodes[start], goalPlace), start);
    heapSize += 1;

    while (heapSize > 0) {
        const node = heapPop(heapDist, heapNode, heapSize);
        heapSize -= 1;
        if (settled[node]) continue;
        settled[node] = 1;
        if (node === goal) {
            const steps: { node: number; link: number }[] = [];
            let cursor = goal;
            while (cursor !== start) {
                const previous = cameFrom[cursor];
                if (previous < 0) return null;
                steps.push({ node: previous, link: via[cursor] });
                cursor = previous;
            }
            steps.reverse();
            const points = [network.nodes[start]];
            for (const step of steps) {
                const link = network.links[step.node][step.link];
                for (const point of link.points) points.push(point);
            }
            return points;
        }

        const links = network.links[node];
        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            if (settled[link.to]) continue;
            const next = cost[node] + link.meters;
            if (next >= cost[link.to]) continue;
            cost[link.to] = next;
            cameFrom[link.to] = node;
            via[link.to] = i;
            heapPush(heapDist, heapNode, heapSize, next + meters(network.nodes[link.to], goalPlace), link.to);
            heapSize += 1;
        }
    }

    return null;
}

function closest(network: RoadNetwork, componentId: number, place: Place) {
    let best = -1;
    let bestScore = Infinity;
    const cos = Math.cos((place.lat * Math.PI) / 180);
    for (let i = 0; i < network.nodes.length; i++) {
        if (network.component[i] !== componentId) continue;
        const node = network.nodes[i];
        const dx = (node.lon - place.lon) * cos;
        const dy = node.lat - place.lat;
        const score = dx * dx + dy * dy;
        if (score < bestScore) {
            bestScore = score;
            best = i;
        }
    }
    return best;
}

function cached(network: RoadNetwork, start: number, goal: number) {
    const key = `${start}:${goal}`;
    let middle = network.cache.get(key);
    if (middle === undefined) {
        middle = search(network, start, goal);
        network.cache.set(key, middle);
    }
    return middle;
}

function samePlace(a: Place, b: Place) {
    return Math.abs(a.lon - b.lon) < 1e-6 && Math.abs(a.lat - b.lat) < 1e-6;
}

export function roadPath(network: RoadNetwork, from: Place, to: Place): RoadRoute | null {
    const start = nearest(network, from);
    const goal = nearest(network, to);
    const points = [from];
    const append = (route: Place[] | null) => {
        if (!route) return;
        for (const point of route) {
            if (!samePlace(points[points.length - 1], point)) points.push(point);
        }
    };

    if (network.component[start] === network.component[goal]) {
        append(cached(network, start, goal));
    } else {
        const exit = closest(network, network.component[start], network.nodes[goal]);
        const entry = closest(network, network.component[goal], network.nodes[start]);
        if (exit >= 0) append(cached(network, start, exit));
        if (entry >= 0) append(cached(network, entry, goal));
    }

    if (!samePlace(points[points.length - 1], to)) points.push(to);
    if (points.length < 2) return null;
    return { points, meters: lineLength(points) };
}
