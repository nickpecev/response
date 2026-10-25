export type Classification = "verified" | "modeled" | "simulated";

export type TimePrecision = "exact" | "minute" | "hour" | "day" | "approximation" | "unknown";

export type LocationPrecision = "exact" | "address" | "site" | "community" | "county" | "region" | "unknown";

export type Confidence = "high" | "medium" | "low";

export type Validation = "valid" | "invalid" | "unvalidated";

export interface Source {
    sourceId: string;
    originalRecordId?: string;
    locator?: string;
    originalText?: string;
    extractionMethod: string;
    sourceTimestamp?: string;
    TimePrecision?: TimePrecision;
    locationPrecision?: LocationPrecision;
    classification?: Classification;
    confidence?: Confidence;
    validation?: Validation;
    notes?: string;
}

export interface Coordinate {
    lon: number;
    lat: number;
}

export type TimelineCategory = "environmental" | "call" | "dispatch" | "arrival" | "incident" | "infrastructure";

export interface TimelineEvent {
    id: string;
    time: string;
    timeEnd?: string;
    recordedAt?: string;
    category: TimelineCategory;
    title: string;
    description?: string;
    location?: Coordinate;
    entities: string[];
    importance: 1 | 2 | 3;
    classification?: Classification;
}

export type ObservationType = "storm_position" | "high_water" | "peak_storm_tide" | "water_level_sensor" | "infrastructure_restoration";

export interface Observation {
    id: string;
    type: ObservationType;
    time?: string;
    timePrecision?: TimePrecision;
    location?: Coordinate;
    value?: number;
    unit?: string;
    label: string;
    classification?: Classification;
    source: Source;
}

export type AssetType = "shelter" | "hospital" | "fire_station" | "police" | "bridge" | "road"

export interface InfrastructureAsset {
    id: string;
    type: AssetType;
    name: string;
    location: Coordinate;
    classification: Classification;
    source: Source;
}

export interface DataSource {
    id: string;
    name: string;
    url: string;
    format: string;
    status: "historical" | "current" | "simulated";
    processedAt?: string;
    recordCount: number;
    processStatus: "pending" | "partially" | "indexed" | "failed" | "processed";
    validation: Validation[];
    classification: Classification;
}

export type Zone {
    id: string;
    name: string;
    ring: [number, number][];
}

export type UnitType = "fire" | "medical" | "search_n_rescue" | "air_rescue" | "police" | "utility";

export type IncidentStatus = "received" | "queued" | "assigned" | "acknowledged" | "dispatched" | "en_route" | "on_scene" | "resolved" | "unresolved";

export type UnitStatus = "off_shift" | "available" | "assigned" | "en_route" | "on_scene" | "returning" | "relocating" | "obstructed";

export type DatasetType = "sources" | "timeline" | "observations" | "storm" | "assets" | "disruptions" | "surge" | "evacuationZones" | "evacuationRoutes" | "imagery" | "road" | "conflicts" | "hazards";

export interface StormPositionPoints { 
    time: string;
    lon: number;
    lat: number;
    status: string;
    windKt: number;
    pressureMb: number;
    recordId: string;
    interpolated: boolean;
    radii?: { kt34: number[]; kt50: number[]; kt64: number[]};
    rmw: number;
}