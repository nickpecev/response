"use client";

import { useMemo, useState } from "react";
import * as maplibre from "maplibre-gl";
import MapCanvas, { Layer, NavigationControl, ScaleControl, Source, useControl } from "react-map-gl/maplibre";
import { MapboxOverlay, type MapboxOverlayProps } from "@deck.gl/mapbox";
import { GeoJsonLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer as DeckLayer, PickingInfo } from "@deck.gl/core";
import type { FeatureCollection } from "geojson";
import type { ExerciseInputs, InfrastructureAsset, Observation } from "@/lib/model/types";
import type { GeoJSONFC, IncidentBundle, InfrastructureDisruption, StormTrackPoint } from "@/lib/model/data/loader";

maplibre.setWorkerUrl("/vendor/maplibre-gl-worker.mjs");

const DARK = "https://tiles.openfreemap.org/styles/dark";

const white: [number, number, number, number] = [242, 242, 242, 230];
const faint: [number, number, number, number] = [242, 242, 242, 28];
const line: [number, number, number, number] = [242, 242, 242, 120];

const SURGE: [number, number, number, number][] = [
    [246, 214, 96, 120],
    [232, 146, 58, 130],
    [210, 82, 52, 140],
    [168, 42, 58, 150],
    [110, 36, 92, 160],
];

function surgeColor(category: number): [number, number, number, number] {
    return SURGE[category - 1] ?? faint;
}

function collection(data: GeoJSONFC): FeatureCollection {
    return data as FeatureCollection;
}

function located(observations: Observation[], kind: Observation["kind"]) {
    return observations.filter((observation) => observation.kind === kind && observation.location);
}

function formatWhen(iso: string, timeZone: string) {
    return new Intl.DateTimeFormat("en-US", {
        timeZone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
    }).format(new Date(iso));
}

function readable(value: string) {
    return value.replaceAll("_", " ");
}



type LayerId =
    | "imagery"
    | "storm"
    | "observations"
    | "assets"
    | "disruptions"
    | "surge"
    | "evacuation"
    | "county"
    | "flood"
    | "staging"
    | "calls";

const LAYER_LABELS: { id: LayerId; label: string }[] = [
    { id: "imagery", label: "`Imagery`" },
    { id: "storm", label: "Storm" },
    { id: "observations", label: "Observations" },
    { id: "assets", label: "Assets" },
    { id: "disruptions", label: "Roads" },
    { id: "surge", label: "Surge" },
    { id: "evacuation", label: "Evacuation" },
    { id: "county", label: "County" },
    { id: "flood", label: "Flood limit" },
    { id: "staging", label: "Staging" },
    { id: "calls", label: "Calls" },
];

function layersIn(bundle: IncidentBundle) {
    const present = new Set<LayerId>();
    if (bundle.imagery.length) present.add("imagery");
    if (bundle.storm?.points.length) present.add("storm");
    if (bundle.observations.some((observation) => observation.location)) present.add("observations");
    if (bundle.assets.length) present.add("assets");
    if (bundle.disruptions.some((disruption) => disruption.path.length > 1)) present.add("disruptions");
    if (bundle.surgeZones) present.add("surge");
    if (bundle.evacZones || bundle.evacRoutes) present.add("evacuation");
    if (bundle.hazardArea) present.add("county");
    if (bundle.exercise) present.add("flood");
    if (bundle.exercise?.staging.length) present.add("staging");
    if (bundle.exercise?.calls.length) present.add("calls");
    
    return LAYER_LABELS.filter((layer) => present.has(layer.id));
}

function buildLayers(bundle: IncidentBundle, visible: Record<LayerId, boolean>): DeckLayer[] {
    const layers: DeckLayer[] = [];
    const stormPoints = bundle.storm?.points ?? [];
    const exercise = bundle.exercise;
    const observations = bundle.observations.filter((observation) => observation.location);
    const taskForces = located(bundle.observations, "task_force_position");

    if (visible.county && bundle.hazardArea) {
        layers.push(
            new GeoJsonLayer({
                id: "hazard",
                data: collection(bundle.hazardArea),
                stroked: true,
                filled: false,
                getLineColor: line,
                lineWidthMinPixels: 1,
            }),
        );
    }

    if (visible.surge && bundle.surgeZones) {
        layers.push(
            new GeoJsonLayer({
                id: "surge",
                data: collection(bundle.surgeZones),
                filled: true,
                stroked: true,
                getFillColor: (feature: { properties?: { category?: number } }) => surgeColor(feature.properties?.category ?? 0),
                getLineColor: (feature: { properties?: { category?: number } }) => {
                    const [red, green, blue] = surgeColor(feature.properties?.category ?? 0);
                    return [red, green, blue, 220];
                },
                lineWidthMinPixels: 1,
                pickable: true,
            }),
        );
    }

    if (visible.evacuation && bundle.evacZones) {
        layers.push(
            new GeoJsonLayer({
                id: "evac-zones",
                data: collection(bundle.evacZones),
                filled: true,
                stroked: true,
                getFillColor: [242, 242, 242, 12],
                getLineColor: line,
                lineWidthMinPixels: 1,
                pickable: true,
            }),
        );
    }

    if (visible.evacuation && bundle.evacRoutes) {
        layers.push(
            new GeoJsonLayer({
                id: "evac-routes",
                data: collection(bundle.evacRoutes),
                getLineColor: [242, 242, 242, 80],
                lineWidthMinPixels: 1,
                pickable: true,
            }),
        );
    }

    if (visible.flood && exercise) {
        layers.push(
            new PolygonLayer({
                id: "flood-restriction",
                data: exercise.floodRestriction.rings.map((ring) => ({ ring, label: exercise.floodRestriction.label })),
                getPolygon: (item: { ring: [number, number][] }) => item.ring,
                getFillColor: [242, 242, 242, 18],
                getLineColor: line,
                lineWidthMinPixels: 1,
                stroked: true,
                pickable: true,
            }),
        );
    }

    const disruptions = bundle.disruptions.filter((disruption) => disruption.path.length > 1);
    if (visible.disruptions && disruptions.length) {
        layers.push(
            new PathLayer({
                id: "disruptions",
                data: disruptions,
                getPath: (disruption: InfrastructureDisruption) => disruption.path,
                getColor: white,
                widthMinPixels: 3,
                capRounded: true,
                pickable: true,
            }),
        );
    }

    if (visible.storm && stormPoints.length) {
        const path = stormPoints.map((point) => [point.lon, point.lat] as [number, number]);
        layers.push(
            new PathLayer({
                id: "storm-path",
                data: [{ path }],
                getPath: (item: { path: [number, number][] }) => item.path,
                getColor: [242, 242, 242, 160],
                widthMinPixels: 1.5,
                pickable: true,
            }),
        );
        layers.push(
            new ScatterplotLayer({
                id: "storm-fixes",
                data: stormPoints,
                getPosition: (point: StormTrackPoint) => [point.lon, point.lat],
                getFillColor: white,
                getRadius: (point: StormTrackPoint) => 2 + point.windKt / 40,
                radiusUnits: "pixels",
                pickable: true,
            }),
        );
    }

    if (visible.observations && observations.length) {
        layers.push(
            new ScatterplotLayer({
                id: "observations",
                data: observations,
                getPosition: (observation: Observation) => [observation.location!.lon, observation.location!.lat],
                getFillColor: white,
                getRadius: 3,
                radiusUnits: "pixels",
                pickable: true,
            }),
        );
    }

    if (visible.observations && taskForces.length) {
        layers.push(
            new TextLayer({
                id: "task-force-labels",
                data: taskForces,
                getPosition: (observation: Observation) => [observation.location!.lon, observation.location!.lat],
                getText: (observation: Observation) => String(observation.props.taskForce ?? ""),
                getSize: 11,
                getColor: white,
                getPixelOffset: [0, 12],
                fontFamily: "Inter, sans-serif",
            }),
        );
    }

    if (visible.assets && bundle.assets.length) {
        layers.push(
            new ScatterplotLayer({
                id: "assets",
                data: bundle.assets,
                getPosition: (asset: InfrastructureAsset) => [asset.location.lon, asset.location.lat],
                getFillColor: [242, 242, 242, 160],
                getRadius: 2.5,
                radiusUnits: "pixels",
                pickable: true,
            }),
        );
    }

    if (visible.staging && exercise?.staging.length) {
        layers.push(
            new ScatterplotLayer({
                id: "staging",
                data: exercise.staging,
                getPosition: (site: ExerciseInputs["staging"][number]) => [site.location.lon, site.location.lat],
                getFillColor: [0, 0, 0, 0],
                getLineColor: white,
                stroked: true,
                filled: false,
                lineWidthMinPixels: 1.5,
                getRadius: 7,
                radiusUnits: "pixels",
                pickable: true,
            }),
        );
    }

    if (visible.calls && exercise?.calls.length) {
        layers.push(
            new ScatterplotLayer({
                id: "calls",
                data: exercise.calls,
                getPosition: (call: ExerciseInputs["calls"][number]) => [call.location.lon, call.location.lat],
                getFillColor: [242, 242, 242, 90],
                getRadius: (call: ExerciseInputs["calls"][number]) => (call.priority === 1 ? 4 : 2.5),
                radiusUnits: "pixels",
                pickable: true,
            }),
        );
    }

    return layers;
}

interface Tip {
    title: string;
    lines: string[];
}

function describePick(layerId: string, object: unknown, bundle: IncidentBundle): Tip | null {
    const timeZone = bundle.manifest.timezone;

    if (layerId === "observations" || layerId === "task-force-labels") {
        const observation = object as Observation;
        const lines = [readable(observation.kind)];
        if (observation.value !== undefined) {
            lines.push(`${observation.value} ${observation.unit ?? ""}`.trim());
        }
        if (observation.t) lines.push(formatWhen(observation.t, timeZone));
        return { title: observation.label, lines };
    }

    if (layerId === "assets") {
        const asset = object as InfrastructureAsset;
        return { title: asset.name, lines: [readable(asset.kind), asset.classification] };
    }

    if (layerId === "disruptions") {
        const disruption = object as InfrastructureDisruption;
        const lines = [readable(disruption.kind), `From ${formatWhen(disruption.start, timeZone)}`];
        if (disruption.end) lines.push(`Until ${formatWhen(disruption.end, timeZone)}`);
        return { title: disruption.name, lines };
    }

    if (layerId === "staging") {
        const site = object as ExerciseInputs["staging"][number];
        return { title: site.name, lines: [readable(site.kind), site.classification] };
    }

    if (layerId === "calls") {
        const call = object as ExerciseInputs["calls"][number];
        return {
            title: call.id,
            lines: [`${readable(call.category)}, priority ${call.priority}`, formatWhen(call.createdAt, timeZone), call.classification],
        };
    }

    if (layerId === "storm-fixes") {
        const point = object as StormTrackPoint;
        const lines = [`${point.windKt} kt, ${point.pressureMb} mb`, formatWhen(point.t, timeZone)];
        if (point.interpolated) lines.push("Interpolated between best-track fixes");
        return { title: point.status, lines };
    }

    if (layerId === "storm-path") {
        if (!bundle.storm) return null;
        return { title: bundle.storm.name, lines: [bundle.storm.interpolationNote] };
    }

    if (layerId === "wind-field") {
        const ring = object as { key: string };
        return { title: `${ring.key.replace("kt", "")} kt wind radius`, lines: ["Quadrant radii from the best track"] };
    }

    if (layerId === "surge") {
        const feature = object as { properties?: { category?: number; maxHeightFt?: number; note?: string } };
        const category = feature.properties?.category;
        const height = feature.properties?.maxHeightFt;
        return {
            title: category ? `Surge zone, category ${category}` : "Surge zone",
            lines: [height ? `Up to ${height} ft` : "", feature.properties?.note ?? "Planning zone"].filter(Boolean),
        };
    }

    if (layerId === "evac-zones") {
        const feature = object as { properties?: { zone?: string } };
        return { title: `Evacuation zone ${feature.properties?.zone ?? ""}`.trim(), lines: [] };
    }

    if (layerId === "evac-routes") {
        const feature = object as { properties?: { road?: string } };
        return { title: feature.properties?.road ?? "Evacuation route", lines: [] };
    }

    if (layerId === "flood-restriction") {
        const item = object as { label: string };
        return { title: item.label, lines: ["Exercise assumption"] };
    }

    return null;
}

function DeckOverlay(props: MapboxOverlayProps) {
    const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
    overlay.setProps(props);
    return null;
}

interface HoverTip extends Tip {
    x: number;
    y: number;
}

interface MapProps {
    bundle: IncidentBundle;
}

const INITIAL_LAYERS: Record<LayerId, boolean> = {
    imagery: false,
    storm: true,
    observations: true,
    assets: true,
    disruptions: true,
    surge: true,
    evacuation: true,
    county: true,
    flood: true,
    staging: true,
    calls: true,
};

function LayerToggle({
    options,
    visible,
    onToggle,
}: {
    options: { id: LayerId; label: string }[];
    visible: Record<LayerId, boolean>;
    onToggle: (id: LayerId) => void;
}) {
    const [open, setOpen] = useState(false);

    return (
        <div className="absolute bottom-3 left-3 z-10 border border-line bg-bg">
            {open && (
                <div className="border-b border-line py-1">
                    {options.map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            onClick={() => onToggle(option.id)}
                            className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs ${visible[option.id] ? "text-fg" : "text-dim"}`}
                        >
                            <span className={`h-2 w-2 border border-current ${visible[option.id] ? "bg-current" : ""}`} />
                            {option.label}
                        </button>
                    ))}
                </div>
            )}
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="flex h-8 w-8 flex-col items-center justify-center gap-1"
                aria-label="Layers"
                aria-expanded={open}
            >
                <span className="h-px w-3 bg-fg" />
                <span className="h-px w-3 bg-fg" />
                <span className="h-px w-3 bg-fg" />
            </button>
        </div>
    );
}

export function Map({ bundle }: MapProps) {
    const [tip, setTip] = useState<HoverTip | null>(null);
    const [visible, setVisible] = useState(INITIAL_LAYERS);
    const options = useMemo(() => layersIn(bundle), [bundle]);
    const layers = useMemo(() => buildLayers(bundle, visible), [bundle, visible]);
    const [longitude, latitude] = bundle.manifest.center;

    function toggle(id: LayerId) {
        setVisible((current) => ({ ...current, [id]: !current[id] }));
    }

    function onHover(info: PickingInfo) {
        if (!info.object || !info.layer) {
            setTip(null);
            return;
        }
        const described = describePick(info.layer.id, info.object, bundle);
        if (!described) {
            setTip(null);
            return;
        }
        setTip({ ...described, x: info.x, y: info.y });
    }

    return (
        <div className="relative h-full w-full" onMouseLeave={() => setTip(null)}>
            <div className="absolute top-3 left-3 z-10 border border-line bg-bg px-2 py-1 text-xs text-dim">
                <a href="https://openfreemap.org" target="_blank" rel="noreferrer" className="text-fg">
                    OpenFreeMap
                </a>
                {", "}
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="hover:text-fg">
                    OpenStreetMap
                </a>
            </div>
            <MapCanvas
                mapLib={maplibre}
                initialViewState={{ longitude, latitude, zoom: bundle.manifest.zoom }}
                mapStyle={DARK}
                attributionControl={{ compact: true }}
                style={{ width: "100%", height: "100%" }}
            >
                {visible.imagery && bundle.imagery.map((imagery) => (
                    <Source
                        key={imagery.id}
                        id={imagery.id}
                        type="raster"
                        tiles={[imagery.tiles]}
                        tileSize={256}
                        bounds={imagery.bounds}
                        attribution={imagery.attribution}
                    >
                        <Layer id={`${imagery.id}-layer`} type="raster" paint={{ "raster-opacity": 0.85 }} />
                    </Source>
                ))}
                <DeckOverlay layers={layers} onHover={onHover} getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")} />
                <NavigationControl position="top-right" showCompass={false} />
                <ScaleControl position="bottom-right" unit="imperial" />
            </MapCanvas>
            <LayerToggle options={options} visible={visible} onToggle={toggle} />
            {tip && (
                <div
                    className="pointer-events-none absolute z-10 max-w-xs border border-line bg-bg px-2 py-1.5 text-xs"
                    style={{ left: tip.x + 12, top: tip.y + 12 }}
                >
                    <div className="text-fg">{tip.title}</div>
                    {tip.lines.map((line) => (
                        <div key={line} className="text-muted">
                            {line}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
