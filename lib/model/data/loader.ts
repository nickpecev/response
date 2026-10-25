import type {
    Classification,
    DataSource,
    ExerciseInputs,
    IncidentManifest,
    InfrastructureAsset,
    Observation,
    Source,
    TimePrecision,
    TimelineEvent,
} from "../types";

export interface GeoJSONFC {
    type: "FeatureCollection";
    features: {
        type: "Feature";
        properties: Record<string, unknown>;
        geometry: { type: string; coordinates: unknown };
    }[];
}

export interface StormTrackPoint {
    t: string;
    lon: number;
    lat: number;
    status: string;
    windKt: number;
    pressureMb: number;
    recordId: string;
    interpolated: boolean;
    radii?: { kt34: number[]; kt50: number[]; kt64: number[] };
    rmwNm: number;
}

export interface StormTrack {
    stormId: string;
    name: string;
    source: string;
    interpolationNote: string;
    points: StormTrackPoint[];
}

export interface ImageryLayer {
    id: string;
    title: string;
    tiles: string;
    bounds: [number, number, number, number];
    acquiredDate: string;
    attribution: string;
    classification: Classification;
}

export interface ConflictClaim {
    value: string;
    locator?: string;
    sourceId?: string;
    originalText?: string;
}

export interface RecordConflict {
    id: string;
    topic: string;
    claims: ConflictClaim[];
    reference: ConflictClaim;
    note?: string;
}

export interface InfrastructureDisruption {
    id: string;
    name: string;
    kind: string;
    path: [number, number][];
    edgeIds: number[];
    start: string;
    end?: string;
    startPrecision: TimePrecision;
    affects: string[];
    classification: Classification;
    source: Source;
    knownToDispatchAt?: string;
    discoveredInField?: boolean;
}

export interface RoadGraph {
    version: number;
    source: string;
    attribution: string;
    osmTimestamp: string;
    label: string;
    builtAt: string;
    bbox: [number, number, number, number];
    classes: string[];
    nodes: number[];
    edges: number[][];
    geom: number[];
    names: string[];
    edgeNames: number[];
    stats: Record<string, unknown>;
}

export interface IncidentBundle {
    manifest: IncidentManifest;
    sources: DataSource[];
    timeline: TimelineEvent[];
    observations: Observation[];
    assets: InfrastructureAsset[];
    disruptions: InfrastructureDisruption[];
    storm?: StormTrack;
    surgeZones?: GeoJSONFC;
    evacZones?: GeoJSONFC;
    evacRoutes?: GeoJSONFC;
    hazardArea?: GeoJSONFC;
    imagery: ImageryLayer[];
    conflicts: RecordConflict[];
    exercise?: ExerciseInputs;
    graphUrl?: string;
}

const memo = new Map<string, Promise<unknown>>();

function incidentBase(id: string) {
    return `/data/incidents/${id}/`;
}

function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;
    const record: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) record[key] = normalize(child);
    if (!record.source && record.provenance) record.source = record.provenance;
    return record;
}

async function getJSON<T>(url: string): Promise<T> {
    let pending = memo.get(url) as Promise<T> | undefined;
    if (!pending) {
        pending = fetch(url).then((response) => {
            if (!response.ok) {
                throw new Error(`${response.status} loading ${url}`);
            }
            return response.json() as Promise<T>;
        });
        memo.set(url, pending);
        pending.catch(() => memo.delete(url));
    }
    return pending;
}

export async function listBundledIncidents(): Promise<IncidentManifest[]> {
    const index = await getJSON<{ incidents: string[] }>("/data/incidents/index.json");
    return Promise.all(index.incidents.map((id) => getJSON<IncidentManifest>(incidentBase(id) + "manifest.json")));
}

export async function loadBundledIncident(id: string): Promise<IncidentBundle> {
    const manifest = await getJSON<IncidentManifest>(incidentBase(id) + "manifest.json");
    const datasets = manifest.datasets;

    const opt = <T,>(filename?: string) => {
        if (!filename) return Promise.resolve(undefined);
        return getJSON<T>(incidentBase(id) + filename);
    };

    const [
        sources,
        timeline,
        observations,
        assets,
        disruptions,
        storm,
        surgeZones,
        evacZones,
        evacRoutes,
        hazardArea,
        imagery,
        conflicts,
        exercise,
    ] = await Promise.all([
        opt<DataSource[]>(datasets.sources),
        opt<TimelineEvent[]>(datasets.timeline),
        opt<Observation[]>(datasets.observations),
        opt<InfrastructureAsset[]>(datasets.assets),
        opt<InfrastructureDisruption[]>(datasets.disruptions),
        opt<StormTrack>(datasets.stormTrack),
        opt<GeoJSONFC>(datasets.surgeZones),
        opt<GeoJSONFC>(datasets.evacZones),
        opt<GeoJSONFC>(datasets.evacRoutes),
        opt<GeoJSONFC>(datasets.hazardArea),
        opt<ImageryLayer[]>(datasets.imagery),
        opt<RecordConflict[]>(datasets.conflicts),
        opt<ExerciseInputs>(datasets.exercise),
    ]);

    return {
        manifest,
        sources: sources ?? [],
        timeline: (normalize(timeline ?? []) as TimelineEvent[]),
        observations: (normalize(observations ?? []) as Observation[]),
        assets: (normalize(assets ?? []) as InfrastructureAsset[]),
        disruptions: (normalize(disruptions ?? exercise?.disruptions ?? []) as InfrastructureDisruption[]),
        storm,
        surgeZones,
        evacZones,
        evacRoutes,
        hazardArea,
        imagery: imagery ?? [],
        conflicts: conflicts ?? [],
        exercise: exercise ? (normalize(exercise) as ExerciseInputs) : undefined,
        graphUrl: datasets.roadGraph ? incidentBase(id) + datasets.roadGraph : undefined,
    };
}

export async function loadGraph(url: string): Promise<RoadGraph> {
    return getJSON<RoadGraph>(url);
}
