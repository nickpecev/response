import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "public", "vendor");

fs.mkdirSync(dest, { recursive: true });
fs.copyFileSync(
    path.join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs"),
    path.join(dest, "maplibre-gl-worker.mjs"),
);
