import { z } from "zod";

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

const lon = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);

export const coordinateSchema = z.object({
    lon,
    lat
});