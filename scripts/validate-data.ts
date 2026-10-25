import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  assetSchema,
  exerciseInputsSchema,
  manifestSchema,
  observationSchema,
  sourceSchema,
  timelineEventSchema,
} from "../lib/model/schemas";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, "..");
const dir = path.join(root, "public/data/incidents");

let errors = 0;

function logError(context: string, message: string) {
    errors++;
    console.error(`[${context}] ${message}`);
}

function main() {
    const indexPath = path.join(dir, "index.json");
    if (!fs.existsSync(indexPath)) {
        console.error("Index file not found");
        process.exit(1);
    }

    const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as { incidents: string[] };
    
    for (const incidentId of index.incidents) {
        console.log(`\nChecking Incident: ${incidentId}`);

        const incidentDir = path.join(dir, incidentId);
        if (!fs.existsSync(incidentDir)) {
            logError(incidentId, "Incident directory not found");
            continue;
        }

        const manifestPath = path.join(incidentDir, "manifest.json");
        if (!fs.existsSync(manifestPath)) {
            logError(incidentId, "Manifest file not found");
            continue;
        }

        const rawManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const manifestResult = manifestSchema.safeParse(rawManifest);

        if (!manifestResult.success) {
            logError(incidentId, "Manifest validation failed");
            console.error(manifestResult.error.format());
            continue;
        }

        const manifest = manifestResult.data;
        let missing = false;
        
        for (const [key, filename] of Object.entries(manifest.datasets)) {
            const filepath = path.join(incidentDir, filename);
            if (!fs.existsSync(filepath)) {
                logError(incidentId, `Dataset file not found: ${filename}`);
                missing = true;
            }
        }

        if (missing) continue;

        const sourcesPath = path.join(incidentDir, manifest.datasets.sources);
        const rawSources = JSON.parse(fs.readFileSync(sourcesPath, "utf8")) as unknown[];
        const validSourceIds = new Set<string>();

        rawSources.forEach((source, index) => {
            const parsed = sourceSchema.safeParse(source);
            if (!parsed.success) {
                logError(incidentId, `Source ${index} validation failed`);
            } else {
                validSourceIds.add(parsed.data.sourceId);
            }
        });

        const helperValidate = (
            key: string,
            filename: string | undefined,
            schema: z.ZodType,
        ) => {
            if (!filename) return;

            const filepath = path.join(incidentDir, filename);
            const records = JSON.parse(fs.readFileSync(filepath, "utf8")) as Array<{
                id: string;
                provenance?: { sourceId: string };
            }>;

            let invalid = 0;
            records.forEach((record, idx) => {
                const parsed = schema.safeParse(record);
                if (!parsed.success) {
                    if (invalid++ < 3) {
                        const issue = parsed.error.issues[0];
                        const target = record.id ? `[${record.id}]` : `[${idx}]`;
                        logError(incidentId, `${key} ${target} validation failed: ${issue.message}`);
                    }
                }

                if (record.provenance && !validSourceIds.has(record.provenance.sourceId)) {
                    if (invalid++ < 3) {
                        logError(incidentId, `${key} ${record.id} source validation failed: Unknown source ID "${record.provenance.sourceId}".`);
                    }
                }
            });

            if (invalid === 0) {
                console.log(`  ${key} validation passed`);
            } else {
                logError(incidentId, `${key} validation failed with ${invalid} errors`);
            }
        };

        helperValidate("timeline", manifest.datasets.timeline, timelineEventSchema);
        helperValidate("observations", manifest.datasets.observations, observationSchema);
        helperValidate("assets", manifest.datasets.assets, assetSchema);

        if (manifest.datasets.exercise) {
            const exercisePath = path.join(incidentDir, manifest.datasets.exercise);
            const rawExercise = JSON.parse(fs.readFileSync(exercisePath, "utf8"));
            const parsedExercise = exerciseInputsSchema.safeParse(rawExercise);

            if (!parsedExercise.success) {
                const issue = parsedExercise.error.issues[0];
                logError(incidentId, `Exercise inputs validation failed: ${issue.message}`);
            } else {
                console.log(`  Exercise inputs validation passed`);
            }
        }
    }

    if (errors > 0) {
        console.error(`\nValidation failed with ${errors} errors`);
        process.exit(1);
    }

    console.log("\nAll data validated successfully");
}

main();
