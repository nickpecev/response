import type { z } from "zod";
import {
    assetSchema,
    classificationSchema,
    coordinateSchema,
    dataSourceSchema,
    exerciseInputsSchema,
    locationSchema,
    manifestSchema,
    observationSchema,
    sourceSchema,
    timeSchema,
    timelineEventSchema,
    unitSchema,
} from "./schemas";

export type Classification = z.infer<typeof classificationSchema>;
export type TimePrecision = z.infer<typeof timeSchema>;
export type LocationPrecision = z.infer<typeof locationSchema>;

export type Coordinate = z.infer<typeof coordinateSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type DataSource = z.infer<typeof dataSourceSchema>;

export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type TimelineCategory = TimelineEvent["category"];

export type Observation = z.infer<typeof observationSchema>;
export type ObservationKind = Observation["kind"];

export type InfrastructureAsset = z.infer<typeof assetSchema>;
export type AssetKind = InfrastructureAsset["kind"];

export type IncidentManifest = z.infer<typeof manifestSchema>;
export type ExerciseInputs = z.infer<typeof exerciseInputsSchema>;
export type Zone = ExerciseInputs["zones"][number];
export type Unit = z.infer<typeof unitSchema>;
export type UnitType = Unit["type"];

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
    radii?: { kt34: number[]; kt50: number[]; kt64: number[] };
    rmw: number;
}
