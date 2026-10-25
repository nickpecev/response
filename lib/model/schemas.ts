import { TimePrecision, z } from "zod";

//Primitives

export const classificationSchema = z.enum(["verified", "modeled", "simulated"]);

export const timeSchema = z.enum([
    "exact",
    "minute",
    "hour",
    "day",
    "approximation",
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

export const sourceSchema = z.object({
    sourceId: z.string(),
    originalRecordId: z.string().min(1).optional(),
    locator: z.string().optional(),
    originalText: z.string().optional(),
    extractionMethod: z.string(),
    sourceTimestamp: isoUtc.optional(),
    TimePrecision: timeSchema.optional(),
    locationPrecision: locationSchema.optional(),
    classification: classificationSchema.optional(),
    confidence: z.enum(["high", "medium", "low", "unknown"]),
    validation: z.enum(["valid", "invalid", "unvalidated"]),
    notes: z.string().optional(),
});

export const timelineEventSchema = z.object({
    id: z.string(),
    time: isoUtc,
    timeEnd: isoUtc.optional(),
    recordedAt: isoUtc.optional(),
    category: z.enum([
        "environmental",
        "call",
        "dispatch",
        "arrival",
        "incident",
        "infrastructure",
    ]),
    title: z.string(),
    description: z.string().optional(),
    location: coordinateSchema.extend({
        label: z.string(),
        precision: locationSchema,
    }).optional(),
    entities: z.array(z.string()),
    importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    classification: classificationSchema,
    source: sourceSchema
});

export const observationSchema = z.object({
    id: z.string(),
    type: z.string(),
    time: isoUtc.optional(),
    location: coordinateSchema.optional(),
    value: z.number().optional(),
    unit: z.string().optional(),
    label: z.string(),
    classification: classificationSchema,
    source: sourceSchema
});

export const assetSchema = z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    location: coordinateSchema,
    classification: classificationSchema,
    source: sourceSchema
});

export const dataSourceSchema = z.object({
    id: z.string(),
    name: z.string(),
    url: z.string().url(),
    format: z.string(),
    status: z.enum(["historical", "current", "simulated"]),
    processedAt: isoUtc.optional(),
    recordCount: z.number().int(),
    processStatus: z.enum(["pending", "partially", "indexed", "failed", "processed"]),
    validation: z.array(z.string()),
    classification: classificationSchema
});

export const unitSchema = z.object({
    id: z.string(),
    callSign: z.string(),
    aliases: z.array(z.string()).optional(),
    type: z.enum([
        "fire",
        "medical",
        "search_n_rescue",
        "air_rescue",
        "police",
        "utility"
    ]),
    classification: classificationSchema
});

