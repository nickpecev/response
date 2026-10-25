import { z } from "zod";

// Primitives

export const classificationSchema = z.enum(["verified", "modeled", "simulated"]);

export const timeSchema = z.enum([
    "exact",
    "minute",
    "hour",
    "day",
    "approximate",
    "unknown"
]);

export const locationSchema = z.enum([
    "exact",
    "address",
    "site",
    "community",
    "county",
    "region",
    "unknown"
]);

const isoUtc = z.iso.datetime({
    error: "must be a valid ISO 8601 datetime string"
});

const lon = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);

export const coordinateSchema = z.object({
    lon,
    lat
});

// Data Schema

const confidenceSchema = z.enum(["high", "medium", "low"]);

const validationSchema = z.enum(["valid", "invalid", "unvalidated", "validated"]);

export const sourceSchema = z.object({
    sourceId: z.string(),
    originalRecordId: z.string().min(1).optional(),
    locator: z.string().optional(),
    originalText: z.string().optional(),
    original: z.unknown().optional(),
    extractionMethod: z.string(),
    sourceTimestamp: isoUtc.optional(),
    timePrecision: timeSchema,
    locationPrecision: locationSchema,
    classification: classificationSchema,
    confidence: confidenceSchema,
    validation: validationSchema,
    notes: z.string().optional(),
});

export const dataSourceSchema = z.object({
    id: z.string(),
    name: z.string(),
    organization: z.string(),
    url: z.string().min(1),
    format: z.string(),
    geographicCoverage: z.string(),
    temporalCoverage: z.string(),
    status: z.enum(["historical", "current", "simulated"]),
    lastIngested: isoUtc.optional(),
    license: z.string(),
    recordCount: z.number().int(),
    ingestionStatus: z.enum(["ingested", "failed", "generated"]),
    validationNotes: z.array(z.string()),
    classification: classificationSchema,
});

const importanceSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const timelineEventSchema = z.object({
    id: z.string(),
    t: isoUtc,
    timeEnd: isoUtc.optional(),
    recordedAt: isoUtc.optional(),
    category: z.enum([
        "environmental",
        "milestone",
        "communication",
        "call",
        "dispatch",
        "arrival",
        "incident",
        "infrastructure",
    ]),
    title: z.string(),
    description: z.string().optional(),
    location: coordinateSchema.extend({
        label: z.string().optional(),
        precision: locationSchema,
    }).optional(),
    entityRefs: z.array(z.string()),
    importance: importanceSchema,
    classification: classificationSchema,
    source: sourceSchema,
});

export const observationSchema = z.object({
    id: z.string(),
    kind: z.enum([
        "high_water_mark",
        "peak_storm_tide",
        "water_level_sensor",
        "utility_restoration",
        "shelter_census",
        "task_force_position",
    ]),
    t: isoUtc.optional(),
    timePrecision: timeSchema,
    location: coordinateSchema.optional(),
    value: z.number().optional(),
    unit: z.string().optional(),
    label: z.string(),
    props: z.record(z.string(), z.unknown()),
    classification: classificationSchema,
    source: sourceSchema,
});

const historicalActivationSchema = z.object({
    status: z.string(),
    t: isoUtc,
    note: z.string().optional(),
    source: sourceSchema,
});

export const assetSchema = z.object({
    id: z.string(),
    kind: z.enum([
        "staging_area",
        "point_of_distribution",
        "landing_zone",
        "shelter",
        "eoc",
        "law_enforcement",
        "ems_station",
        "fire_station",
        "hospital",
    ]),
    name: z.string(),
    location: coordinateSchema,
    props: z.record(z.string(), z.unknown()),
    classification: classificationSchema,
    geographyStatus: z.string(),
    source: sourceSchema,
    historicalActivation: z.array(historicalActivationSchema).optional(),
});

const zoneSchema = z.object({
    id: z.string(),
    name: z.string(),
    ring: z.array(z.tuple([lon, lat])).min(3),
});

const stagingSchema = z.object({
    id: z.string(),
    name: z.string(),
    location: coordinateSchema,
    assetRef: z.string().optional(),
    kind: z.enum(["ground", "air_base", "boat_launch"]),
    unsuitableFrom: isoUtc.optional(),
    unsuitableReason: z.string().optional(),
    relocateTo: z.string().optional(),
    classification: classificationSchema,
});

export const unitSchema = z.object({
    id: z.string(),
    callSign: z.string(),
    aliases: z.array(z.string()).optional(),
    type: z.enum([
        "fire_engine",
        "medical",
        "search_rescue",
        "high_water",
        "rescue_boat",
        "air_rescue",
        "logistics",
        "utility_crew",
    ]),
    stagingId: z.string(),
    shiftStart: isoUtc,
    shiftEnd: isoUtc,
    capabilities: z.array(z.string()),
    restrictions: z.array(z.string()),
    statusReportLagMin: z.number(),
    classification: classificationSchema,
});

const callSchema = z.object({
    id: z.string(),
    createdAt: isoUtc,
    location: coordinateSchema,
    category: z.enum([
        "medical",
        "welfare_check",
        "supply_assistance",
        "rescue",
        "infrastructure_obstruction",
        "flood_access",
        "general",
    ]),
    priority: importanceSchema,
    zoneId: z.string(),
    serviceMin: z.number(),
    inModeledFloodArea: z.boolean(),
    offNetworkM: z.number(),
    classification: classificationSchema,
});

// Config & Manifest
export const exerciseInputsSchema = z.object({
    scenarioId: z.string(),
    incidentId: z.string(),
    name: z.string(),
    seed: z.number().int(),
    window: z.object({ start: isoUtc, end: isoUtc }),
    zones: z.array(zoneSchema),
    staging: z.array(stagingSchema),
    units: z.array(unitSchema),
    calls: z.array(callSchema),
    disruptions: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            kind: z.string(),
            path: z.array(z.tuple([lon, lat])),
            edgeIds: z.array(z.number()),
            start: isoUtc,
            end: isoUtc.optional(),
            startPrecision: timeSchema,
            affects: z.array(z.string()),
            classification: classificationSchema,
            source: sourceSchema,
            knownToDispatchAt: isoUtc.optional(),
            discoveredInField: z.boolean(),
        })
    ),
    commDelays: z.array(
        z.object({
            id: z.string(),
            zoneId: z.string(),
            start: isoUtc,
            end: isoUtc,
            extraAckMin: z.tuple([z.number(), z.number()]),
            description: z.string(),
            classification: classificationSchema,
        })
    ),
    statusLags: z.array(
        z.object({
            id: z.string(),
            start: isoUtc,
            end: isoUtc,
            extraLagMin: z.tuple([z.number(), z.number()]),
            description: z.string(),
            classification: classificationSchema,
        })
    ),
    suspension: z.object({
        start: isoUtc,
        end: isoUtc,
        description: z.string(),
        classification: classificationSchema,
        source: sourceSchema,
    }),
    speedPhases: z.array(
        z.object({
            start: isoUtc,
            factor: z.number(),
            label: z.string(),
        })
    ),
    floodRestriction: z.object({
        rings: z.array(z.array(z.tuple([lon, lat]))),
        start: isoUtc,
        end: isoUtc,
        label: z.string(),
    }),
    policy: z.enum(["priority_nearest", "nearest_first", "priority_oldest"]),
    baseAckMin: z.tuple([z.number(), z.number()]),
    generator: z.object({
        version: z.string(),
        generatedAt: isoUtc,
        notes: z.array(z.string()),
    }),
}).superRefine((data, ctx) => {
    const stagingIds = new Set(data.staging.map((s) => s.id));
    data.units.forEach((unit, idx) => {
        if (!stagingIds.has(unit.stagingId)) {
            ctx.addIssue({
                code: "custom",
                path: ["units", idx, "stagingId"],
                message: `Staging ID not found: ${unit.stagingId}`,
            });
        }
    });

    const callIds = new Set<string>();
    data.calls.forEach((call, idx) => {
        if (callIds.has(call.id)) {
            ctx.addIssue({
                code: "custom",
                path: ["calls", idx, "id"],
                message: `Duplicate call ID "${call.id}".`,
            });
        }
        callIds.add(call.id);
    });
});

export const manifestSchema = z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string(),
    shortName: z.string(),
    type: z.array(z.string()),
    region: z.string(),
    timezone: z.string(),
    bbox: z.tuple([lon, lat, lon, lat]),
    center: z.tuple([lon, lat]),
    zoom: z.number(),
    timeRange: z.object({ start: isoUtc, end: isoUtc }),
    description: z.string(),
    classificationMix: z.array(classificationSchema),
    datasets: z.record(z.string(), z.string()),
    createdBy: z.enum(["bundled", "user"])
});