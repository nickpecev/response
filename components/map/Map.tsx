"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as maplibre from "maplibre-gl";
import MapCanvas, { Layer, NavigationControl, ScaleControl, Source, useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay, type MapboxOverlayProps } from "@deck.gl/mapbox";
import { GeoJsonLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer as DeckLayer, PickingInfo } from "@deck.gl/core";
import type { FeatureCollection } from "geojson";
import type { ExerciseInputs, InfrastructureAsset, Observation } from "@/lib/model/types";
import type { IncidentBundle, InfrastructureDisruption, RoadGraph, StormTrackPoint } from "@/lib/model/data/loader";
import { positionAt, simulate, type SimulatedUnit, type Simulation } from "@/lib/simulation/engine";
import { EventList } from "@/components/map/EventList";
import { UnitList } from "@/components/map/UnitList";

maplibre.setWorkerUrl("/vendor/maplibre-gl-worker.mjs");

const DARK = "https://tiles.openfreemap.org/styles/dark";

const white: [number, number, number, number] = [242, 242, 242, 230];
const faint: [number, number, number, number] = [242, 242, 242, 28];
const line: [number, number, number, number] = [242, 242, 242, 120];
const down: [number, number, number, number] = [214, 64, 64, 240];
const closedOutline: [number, number, number, number] = [168, 168, 168, 210];
const closedLine: [number, number, number, number] = [196, 72, 72, 230];

const SURGE: [number, number, number, number][] = [
    [246, 214, 96, 120],
    [232, 146, 58, 130],
    [210, 82, 52, 140],
    [168, 42, 58, 150],
    [110, 36, 92, 160],
];

const WIND_FILL: [number, number, number, number][] = [
    [242, 184, 75, 18],
    [249, 115, 22, 22],
    [240, 113, 113, 32],
];

const WIND_LINE: [number, number, number, number][] = [
    [242, 184, 75, 150],
    [249, 115, 22, 170],
    [240, 113, 113, 210],
];

const UNIT_COLORS: [number, number, number][] = [
    [86, 180, 233],
    [230, 159, 0],
    [0, 196, 140],
    [213, 94, 0],
    [166, 140, 232],
    [240, 112, 160],
    [140, 196, 72],
    [86, 140, 232],
    [232, 196, 86],
    [72, 196, 196],
    [232, 120, 96],
    [160, 160, 232],
];

function tripLines(unit: SimulatedUnit, time: number) {
    const trip = unit.trips.find((item) => time >= item.start && time < item.end);
    if (!trip) return null;
    const at = positionAt(unit.track, time);
    if (!at) return null;

    const done: [number, number][] = [];
    const ahead: [number, number][] = [[at.lon, at.lat]];

    function add(path: [number, number][], lon: number, lat: number) {
        const last = path[path.length - 1];
        if (last && last[0] === lon && last[1] === lat) return;
        path.push([lon, lat]);
    }

    const start = positionAt(unit.track, trip.start);
    if (start) add(done, start.lon, start.lat);
    for (const point of unit.track) {
        if (point.t <= trip.start || point.t >= trip.end) continue;
        if (point.t <= time) add(done, point.lon, point.lat);
        else add(ahead, point.lon, point.lat);
    }
    add(done, at.lon, at.lat);
    const finish = positionAt(unit.track, trip.end);
    if (finish) add(ahead, finish.lon, finish.lat);

    return {
        done: done.length > 1 ? done : null,
        ahead: ahead.length > 1 ? ahead : null,
    };
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
    | "calls"
    | "units";

const LAYER_LABELS: { id: LayerId; label: string }[] = [
    { id: "imagery", label: "Imagery" },
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
    { id: "units", label: "Units" },
];

function layersIn(bundle: IncidentBundle) {
    const present = new Set<LayerId>();
    if (bundle.imagery.length) present.add("imagery");
    if (bundle.storm?.points.length) present.add("storm");
    if (bundle.observations.some((observation) => observation.location)) present.add("observations");
    if (bundle.assets.length) present.add("assets");
    if (roadClosures(bundle).some((disruption) => disruption.path.length > 1)) present.add("disruptions");
    if (bundle.surgeZones) present.add("surge");
    if (bundle.evacZones || bundle.evacRoutes) present.add("evacuation");
    if (bundle.hazardArea) present.add("county");
    if (bundle.exercise) present.add("flood");
    if (bundle.exercise?.staging.length) present.add("staging");
    if (bundle.exercise?.calls.length) present.add("calls");
    if (bundle.exercise?.units.length) present.add("units");
    return LAYER_LABELS.filter((layer) => present.has(layer.id));
}

function roadClosures(bundle: IncidentBundle): InfrastructureDisruption[] {
    const modeled = bundle.exercise?.disruptions ?? [];
    if (modeled.some((disruption) => disruption.path.length > 1)) return modeled;
    return bundle.disruptions;
}

interface ClosedSegment {
    disruption: InfrastructureDisruption;
    path: [number, number][];
}

function closureSegments(disruption: InfrastructureDisruption, roads: RoadGraph | null): ClosedSegment[] {
    const segments: ClosedSegment[] = [];
    if (roads) {
        for (const id of disruption.edgeIds) {
            const edge = roads.edges[id];
            if (!edge) continue;
            const path: [number, number][] = [];
            for (let i = edge[5]; i < edge[6]; i += 2) {
                path.push([roads.geom[i], roads.geom[i + 1]]);
            }
            if (path.length > 1) segments.push({ disruption, path });
        }
    }
    if (segments.length) return segments;
    if (disruption.path.length > 1) return [{ disruption, path: disruption.path }];
    return [];
}

function initialTime(bundle: IncidentBundle) {
    const start = Date.parse(bundle.manifest.timeRange.start);
    const marked = (bundle.manifest as { defaultTime?: string }).defaultTime;
    if (!marked) return start;
    const time = Date.parse(marked);
    return Number.isFinite(time) ? time : start;
}

function assetDown(asset: InfrastructureAsset, time: number) {
    const notes = asset.historicalActivation ?? [];
    return notes.some((item) => Date.parse(item.t) <= time && /flood|impassable|closed|destroy|outage|unusable|collapse|down/i.test(item.status));
}

function siteDown(site: ExerciseInputs["staging"][number], time: number) {
    return Boolean(site.unsuitableFrom && time >= Date.parse(site.unsuitableFrom));
}

function observationReady(observation: Observation, time: number) {
    if (observation.t) return Date.parse(observation.t) <= time;
    const flagged = observation.props.flaggedAt;
    if (typeof flagged === "string") return Date.parse(flagged) <= time;
    return true;
}

function mixRadius(before: number[] | undefined, after: number[] | undefined, fraction: number) {
    if (!before) return after ?? [];
    if (!after) return before;
    return before.map((value, index) => value + ((after[index] ?? value) - value) * fraction);
}

function windRing(lon: number, lat: number, radiiNm: number[]) {
    if (!radiiNm.some((radius) => radius > 0)) return [];
    const ring: [number, number][] = [];
    const kx = 1 / (60 * Math.cos((lat * Math.PI) / 180));
    const start = [0, 90, 180, 270];
    for (let quadrant = 0; quadrant < 4; quadrant++) {
        const radius = radiiNm[quadrant] ?? 0;
        for (let bearing = start[quadrant]; bearing <= start[quadrant] + 90; bearing += 6) {
            const rad = (bearing * Math.PI) / 180;
            ring.push([lon + Math.sin(rad) * radius * kx, lat + (Math.cos(rad) * radius) / 60]);
        }
    }
    ring.push(ring[0]);
    return ring;
}

function stormPosition(points: StormTrackPoint[], time: number): StormTrackPoint | null {
    if (!points.length || time < Date.parse(points[0].t)) return null;
    const last = points[points.length - 1];
    if (time >= Date.parse(last.t)) return last;

    let index = 1;
    while (index < points.length && Date.parse(points[index].t) < time) index += 1;
    const before = points[index - 1];
    const after = points[index];
    const span = Date.parse(after.t) - Date.parse(before.t);
    const fraction = span === 0 ? 0 : (time - Date.parse(before.t)) / span;
    const radii = before.radii && after.radii
        ? {
            kt34: mixRadius(before.radii.kt34, after.radii.kt34, fraction),
            kt50: mixRadius(before.radii.kt50, after.radii.kt50, fraction),
            kt64: mixRadius(before.radii.kt64, after.radii.kt64, fraction),
        }
        : before.radii;
    return {
        ...before,
        t: new Date(time).toISOString(),
        lon: before.lon + (after.lon - before.lon) * fraction,
        lat: before.lat + (after.lat - before.lat) * fraction,
        windKt: Math.round(before.windKt + (after.windKt - before.windKt) * fraction),
        pressureMb: Math.round(before.pressureMb + (after.pressureMb - before.pressureMb) * fraction),
        radii,
        interpolated: true,
    };
}

function buildLayers(bundle: IncidentBundle, roads: RoadGraph | null, visible: Record<LayerId, boolean>, time: number, simulation: Simulation | null, zoom: number): DeckLayer[] {
    const layers: DeckLayer[] = [];
    const stormPoints = (bundle.storm?.points ?? []).filter((point) => Date.parse(point.t) <= time);
    const exercise = bundle.exercise;
    const observations = bundle.observations.filter((observation) => observation.location && observationReady(observation, time));
    const taskForces = observations.filter((observation) => observation.kind === "task_force_position" && observation.location);

    if (visible.county && bundle.hazardArea) {
        layers.push(
            new GeoJsonLayer({
                id: "hazard",
                data: bundle.hazardArea as FeatureCollection,
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
                data: bundle.surgeZones as FeatureCollection,
                filled: true,
                stroked: true,
                getFillColor: (feature: { properties?: { category?: number } }) => SURGE[(feature.properties?.category ?? 0) - 1] ?? faint,
                getLineColor: (feature: { properties?: { category?: number } }) => {
                    const [red, green, blue] = SURGE[(feature.properties?.category ?? 0) - 1] ?? faint;
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
                data: bundle.evacZones as FeatureCollection,
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
                data: bundle.evacRoutes as FeatureCollection,
                getLineColor: [242, 242, 242, 80],
                lineWidthMinPixels: 1,
                pickable: true,
            }),
        );
    }

    const flood = exercise?.floodRestriction;
    const floodActive = flood && time >= Date.parse(flood.start) && time < Date.parse(flood.end);
    if (visible.flood && exercise && floodActive) {
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

    const disruptions = roadClosures(bundle).flatMap((disruption) => {
        const opened = Date.parse(disruption.start);
        const closed = disruption.end ? Date.parse(disruption.end) : Infinity;
        if (time < opened || time >= closed) return [];
        return closureSegments(disruption, roads);
    });
    if (visible.disruptions && disruptions.length) {
        const pathParameters = { depthCompare: "always" as const, depthWriteEnabled: false };
        layers.push(
            new PathLayer({
                id: "disruptions",
                data: disruptions,
                getPath: (segment: ClosedSegment) => segment.path,
                getColor: closedOutline,
                widthMinPixels: 6,
                capRounded: true,
                jointRounded: true,
                parameters: pathParameters,
                pickable: true,
            }),
        );
        layers.push(
            new PathLayer({
                id: "disruptions-line",
                data: disruptions,
                getPath: (segment: ClosedSegment) => segment.path,
                getColor: closedLine,
                widthMinPixels: 3.5,
                capRounded: true,
                jointRounded: true,
                parameters: pathParameters,
                pickable: true,
            }),
        );
    }

    const position = stormPosition(bundle.storm?.points ?? [], time);
    if (visible.storm && position?.radii) {
        const rings = (["kt34", "kt50", "kt64"] as const)
            .map((key, index) => ({ key, index, ring: windRing(position.lon, position.lat, position.radii?.[key] ?? []) }))
            .filter((item) => item.ring.length);
        if (rings.length) {
            layers.push(
                new PolygonLayer({
                    id: "wind-field",
                    data: rings,
                    getPolygon: (item: (typeof rings)[number]) => item.ring,
                    getFillColor: (item: (typeof rings)[number]) => WIND_FILL[item.index],
                    getLineColor: (item: (typeof rings)[number]) => WIND_LINE[item.index],
                    filled: true,
                    stroked: true,
                    lineWidthMinPixels: 1,
                    pickable: true,
                }),
            );
        }
    }
    if (visible.storm && stormPoints.length) {
        const path = stormPoints.map((point) => [point.lon, point.lat] as [number, number]);
        if (position) path.push([position.lon, position.lat]);
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
        if (position) {
            layers.push(
                new ScatterplotLayer({
                    id: "storm-center",
                    data: [position],
                    getPosition: (point: StormTrackPoint) => [point.lon, point.lat],
                    getFillColor: white,
                    getLineColor: [0, 0, 0, 255],
                    stroked: true,
                    lineWidthMinPixels: 2,
                    getRadius: 7,
                    radiusUnits: "pixels",
                    pickable: true,
                }),
            );
        }
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
                getFillColor: (asset: InfrastructureAsset) => (assetDown(asset, time) ? down : [242, 242, 242, 160]),
                getLineColor: [0, 0, 0, 255],
                stroked: true,
                lineWidthMinPixels: 1,
                getRadius: (asset: InfrastructureAsset) => (assetDown(asset, time) ? 5 : 2.5),
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
                getFillColor: (site: ExerciseInputs["staging"][number]) => (siteDown(site, time) ? [214, 64, 64, 80] : [0, 0, 0, 0]),
                getLineColor: (site: ExerciseInputs["staging"][number]) => (siteDown(site, time) ? down : white),
                stroked: true,
                filled: false,
                lineWidthMinPixels: 1.5,
                getRadius: 7,
                radiusUnits: "pixels",
                pickable: true,
            }),
        );
    }

    const finished: Record<string, number> = {};
    if (simulation) {
        for (const item of simulation.handled) finished[item.id] = item.at;
    }
    const calls = (exercise?.calls ?? [])
        .filter((call) => Date.parse(call.createdAt) <= time)
        .map((call) => {
            const at = finished[call.id];
            return { call, handled: at !== undefined && time >= at };
        });
    if (visible.calls && calls.length) {
        layers.push(
            new ScatterplotLayer({
                id: "calls",
                data: calls,
                getPosition: (item: (typeof calls)[number]) => [item.call.location.lon, item.call.location.lat],
                getFillColor: (item: (typeof calls)[number]) => (item.handled ? [138, 138, 138, 255] : [255, 255, 255, 255]),
                getLineColor: [0, 0, 0, 255],
                stroked: true,
                lineWidthMinPixels: 1,
                getRadius: (item: (typeof calls)[number]) => (item.call.priority === 1 ? 5 : 3.5),
                radiusUnits: "pixels",
                pickable: true,
            }),
        );
    }

    if (visible.units && simulation) {
        const markers: { unit: SimulatedUnit; color: [number, number, number]; lon: number; lat: number }[] = [];
        const traveled: { unit: SimulatedUnit; color: [number, number, number]; path: [number, number][] }[] = [];
        const upcoming: { unit: SimulatedUnit; color: [number, number, number]; path: [number, number][] }[] = [];
        for (let index = 0; index < simulation.units.length; index++) {
            const unit = simulation.units[index];
            const at = positionAt(unit.track, time);
            if (!at || time > unit.shiftEnd) continue;
            const color = UNIT_COLORS[index % UNIT_COLORS.length];
            markers.push({ unit, color, lon: at.lon, lat: at.lat });
            const lines = tripLines(unit, time);
            if (!lines) continue;
            if (lines.done) traveled.push({ unit, color, path: lines.done });
            if (lines.ahead) upcoming.push({ unit, color, path: lines.ahead });
        }
        const labels: { lon: number; lat: number; text: string }[] = [];
        if (zoom >= 11) {
            for (const marker of markers) labels.push({ lon: marker.lon, lat: marker.lat, text: marker.unit.callSign });
        } else {
            const counts: Record<string, { lon: number; lat: number; n: number }> = {};
            for (const marker of markers) {
                const key = `${marker.lon.toFixed(4)}:${marker.lat.toFixed(4)}`;
                const group = counts[key];
                if (group) group.n += 1;
                else counts[key] = { lon: marker.lon, lat: marker.lat, n: 1 };
            }
            for (const group of Object.values(counts)) {
                if (group.n > 1) labels.push({ lon: group.lon, lat: group.lat, text: String(group.n) });
            }
        }
        const pathParameters = { depthCompare: "always" as const, depthWriteEnabled: false };
        if (upcoming.length) {
            layers.push(
                new PathLayer({
                    id: "unit-paths-ahead",
                    data: upcoming,
                    getPath: (item: (typeof upcoming)[number]) => item.path,
                    getColor: (item: (typeof upcoming)[number]) => [item.color[0], item.color[1], item.color[2], 64],
                    getWidth: 2,
                    widthUnits: "pixels",
                    capRounded: true,
                    jointRounded: true,
                    parameters: pathParameters,
                    pickable: true,
                }),
            );
        }
        if (traveled.length) {
            layers.push(
                new PathLayer({
                    id: "unit-paths",
                    data: traveled,
                    getPath: (item: (typeof traveled)[number]) => item.path,
                    getColor: (item: (typeof traveled)[number]) => [item.color[0], item.color[1], item.color[2], 230],
                    getWidth: 2,
                    widthUnits: "pixels",
                    capRounded: true,
                    jointRounded: true,
                    parameters: pathParameters,
                    pickable: true,
                }),
            );
        }
        if (markers.length) {
            layers.push(
                new ScatterplotLayer({
                    id: "units",
                    data: markers,
                    getPosition: (item: (typeof markers)[number]) => [item.lon, item.lat],
                    getFillColor: (item: (typeof markers)[number]) => [item.color[0], item.color[1], item.color[2], 255],
                    getLineColor: [0, 0, 0, 255],
                    stroked: true,
                    lineWidthMinPixels: 2,
                    getRadius: 7,
                    radiusUnits: "pixels",
                    pickable: true,
                }),
            );
        }
        if (labels.length) {
            layers.push(
                new TextLayer({
                    id: "unit-labels",
                    data: labels,
                    getPosition: (item: (typeof labels)[number]) => [item.lon, item.lat],
                    getText: (item: (typeof labels)[number]) => item.text,
                    getSize: 11,
                    getColor: [242, 242, 242, 230],
                    getPixelOffset: [0, -16],
                    fontFamily: "JetBrains Mono, ui-monospace, monospace",
                    fontWeight: 600,
                    outlineWidth: 3,
                    outlineColor: [0, 0, 0, 230],
                    fontSettings: { sdf: true },
                    pickable: false,
                }),
            );
        }
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
        const lines = [observation.kind.replaceAll("_", " ")];
        if (observation.value !== undefined) {
            lines.push(`${observation.value} ${observation.unit ?? ""}`.trim());
        }
        if (observation.t) lines.push(formatWhen(observation.t, timeZone));
        return { title: observation.label, lines };
    }

    if (layerId === "assets") {
        const asset = object as InfrastructureAsset;
        const lines = [asset.kind.replaceAll("_", " "), asset.classification];
        const failure = asset.historicalActivation?.find((item) => /flood|impassable|closed|destroy|outage|unusable|collapse|down/i.test(item.status));
        if (failure) lines.push(failure.status);
        return { title: asset.name, lines };
    }

    if (layerId === "disruptions" || layerId === "disruptions-line") {
        const disruption = (object as ClosedSegment).disruption;
        const lines = [disruption.name, `From ${formatWhen(disruption.start, timeZone)}`];
        if (disruption.end) lines.push(`Until ${formatWhen(disruption.end, timeZone)}`);
        return { title: "Road closed", lines };
    }

    if (layerId === "staging") {
        const site = object as ExerciseInputs["staging"][number];
        const lines = [site.kind.replaceAll("_", " "), site.classification];
        if (site.unsuitableFrom) lines.push(`Unsuitable from ${formatWhen(site.unsuitableFrom, timeZone)}`);
        if (site.unsuitableReason) lines.push(site.unsuitableReason);
        return { title: site.name, lines };
    }

    if (layerId === "units" || layerId === "unit-paths" || layerId === "unit-paths-ahead") {
        const unit = (object as { unit: SimulatedUnit }).unit;
        return { title: unit.callSign, lines: [unit.type.replaceAll("_", " "), unit.classification] };
    }

    if (layerId === "calls") {
        const item = object as { call: ExerciseInputs["calls"][number]; handled: boolean };
        const call = item.call;
        const lines = [`${call.category.replaceAll("_", " ")}, priority ${call.priority}`, formatWhen(call.createdAt, timeZone), call.classification];
        if (item.handled) lines.push("Handled");
        return { title: call.id, lines };
    }

    if (layerId === "storm-center" || layerId === "storm-fixes") {
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
        const knots = ring.key.replace("kt", "");
        return { title: `${knots} kt wind radius`, lines: ["Quadrant radii from the best track"] };
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
    useEffect(() => overlay.setProps(props), [overlay, props]);
    return null;
}

interface HoverTip extends Tip {
    x: number;
    y: number;
}

interface MapProps {
    bundle: IncidentBundle;
    roads: RoadGraph | null;
}

const INITIAL_LAYERS: Record<LayerId, boolean> = {
    imagery: false,
    storm: true,
    observations: false,
    assets: false,
    disruptions: true,
    surge: false,
    evacuation: false,
    county: true,
    flood: false,
    staging: false,
    calls: true,
    units: true,
};

const SPEEDS = [1, 5, 15, 60, 240] as const;
const HEADER = 18;
const LANE_LABEL = 76;

function stormCategory(windKt: number) {
    if (windKt >= 137) return 5;
    if (windKt >= 113) return 4;
    if (windKt >= 96) return 3;
    if (windKt >= 83) return 2;
    if (windKt >= 64) return 1;
    return 0;
}

function formatDay(ms: number, timeZone: string) {
    return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(ms);
}

function localHour(ms: number, timeZone: string) {
    const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date(ms));
    return Number(hour) % 24;
}

function EventStrip({
    bundle,
    start,
    end,
    time,
    timeZone,
    playing,
    onTime,
    onToggle,
}: {
    bundle: IncidentBundle;
    start: number;
    end: number;
    time: number;
    timeZone: string;
    playing: boolean;
    onTime: (time: number) => void;
    onToggle: () => void;
}) {
    const frame = useRef<HTMLDivElement>(null);
    const drag = useRef(false);
    const [width, setWidth] = useState(0);
    const [hover, setHover] = useState<number | null>(null);
    const span = Math.max(1, end - start);
    const track = Math.max(1, width - LANE_LABEL);
    const x = (ms: number) => ((ms - start) / span) * track;

    const storm = useMemo(() => {
        const points = bundle.storm?.points ?? [];
        return points.map((point, index) => ({
            t0: Date.parse(point.t),
            t1: points[index + 1] ? Date.parse(points[index + 1].t) : Date.parse(point.t) + 6 * 3600_000,
            category: stormCategory(point.windKt),
        }));
    }, [bundle.storm]);
    const events = useMemo(
        () => bundle.timeline.filter((event) => event.source?.sourceId !== "noaa-hurdat2"),
        [bundle.timeline],
    );
    const closures = roadClosures(bundle).filter((disruption) => disruption.path.length > 1);
    const closureLayout = closures.map((disruption) => {
        const opened = Date.parse(disruption.start);
        const closed = disruption.end ? Date.parse(disruption.end) : end;
        return { disruption, opened, closed, row: 0 };
    });
    const lanes: { opened: number; closed: number }[][] = [];
    for (const item of closureLayout) {
        let row = lanes.findIndex((lane) => lane.every((other) => other.closed <= item.opened || item.closed <= other.opened));
        if (row < 0) {
            row = lanes.length;
            lanes.push([]);
        }
        lanes[row].push(item);
        item.row = row;
    }
    const stormH = storm.length ? 18 : 0;
    const eventsH = events.length ? 18 : 0;
    const closuresH = closureLayout.length ? lanes.length * 8 + 8 : 0;
    const height = HEADER + stormH + eventsH + closuresH + 4;
    let cursor = HEADER;
    const stormY = cursor;
    cursor += stormH;
    const eventsY = cursor;
    cursor += eventsH;
    const closuresY = cursor;

    useEffect(() => {
        const node = frame.current;
        if (!node) return;
        const watch = new ResizeObserver(() => setWidth(node.clientWidth));
        watch.observe(node);
        setWidth(node.clientWidth);
        return () => watch.disconnect();
    }, []);

    const ticks = useMemo(() => {
        const marks: { t: number; major: boolean; label: string }[] = [];
        let cursor = Math.ceil(start / 3600_000) * 3600_000;
        for (; cursor <= end; cursor += 3600_000) {
            const hour = localHour(cursor, timeZone);
            if (hour !== 0 && hour !== 12) continue;
            marks.push({ t: cursor, major: hour === 0, label: hour === 0 ? formatDay(cursor, timeZone) : "" });
        }
        return marks;
    }, [start, end, timeZone]);

    if (!storm.length && !events.length && !closureLayout.length) return null;

    function seek(next: number, pause: boolean) {
        if (pause && playing) onToggle();
        onTime(Math.min(end, Math.max(start, next)));
    }

    function timeAt(clientX: number, node: SVGSVGElement) {
        const rect = node.getBoundingClientRect();
        const px = clientX - rect.left - LANE_LABEL;
        return start + (Math.min(track, Math.max(0, px)) / track) * span;
    }

    const dateLabels: { t: number; label: string }[] = [];
    let lastLabel = -56;
    for (const tick of ticks) {
        if (!tick.label) continue;
        const left = x(tick.t);
        if (left < lastLabel + 56) continue;
        lastLabel = left;
        dateLabels.push({ t: tick.t, label: tick.label });
    }

    return (
        <div ref={frame} className="relative border-t border-line">
            <svg
                width={width || "100%"}
                height={height}
                className="block"
                role="slider"
                aria-label="Incident events"
                aria-valuemin={start}
                aria-valuemax={end}
                aria-valuenow={time}
                aria-valuetext={formatWhen(new Date(time).toISOString(), timeZone)}
                tabIndex={0}
                onPointerDown={(event) => {
                    drag.current = true;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    seek(timeAt(event.clientX, event.currentTarget), true);
                }}
                onPointerMove={(event) => {
                    const next = timeAt(event.clientX, event.currentTarget);
                    const rect = event.currentTarget.getBoundingClientRect();
                    setHover(event.clientX - rect.left >= LANE_LABEL ? next : null);
                    if (drag.current) onTime(Math.min(end, Math.max(start, next)));
                }}
                onPointerUp={() => {
                    drag.current = false;
                }}
                onPointerLeave={() => setHover(null)}
                onKeyDown={(event) => {
                    const step = event.shiftKey ? 60 * 60_000 : 15 * 60_000;
                    if (event.key === "ArrowRight") seek(time + step, true);
                    if (event.key === "ArrowLeft") seek(time - step, true);
                }}
            >
                {storm.length > 0 && (
                    <text x={10} y={stormY + stormH / 2 + 3} fontSize={10} fill="#8a8a8a" fontFamily="Inter, sans-serif">
                        Storm
                    </text>
                )}
                {events.length > 0 && (
                    <text x={10} y={eventsY + eventsH / 2 + 3} fontSize={10} fill="#8a8a8a" fontFamily="Inter, sans-serif">
                        Events
                    </text>
                )}
                {closureLayout.length > 0 && (
                    <text x={10} y={closuresY + closuresH / 2 + 3} fontSize={10} fill="#8a8a8a" fontFamily="Inter, sans-serif">
                        Closures
                    </text>
                )}
                <g transform={`translate(${LANE_LABEL},0)`}>
                    <clipPath id="event-strip-clip">
                        <rect x={0} y={0} width={track} height={height} />
                    </clipPath>
                    <g clipPath="url(#event-strip-clip)">
                    {ticks.map((tick) => (
                        <line key={tick.t} x1={x(tick.t)} x2={x(tick.t)} y1={HEADER} y2={height} stroke={tick.major ? "#222" : "#141414"} />
                    ))}
                    {dateLabels.map((tick) => (
                        <text key={tick.t} x={x(tick.t) + 4} y={12} fontSize={10} fill="#8a8a8a" fontFamily="Inter, sans-serif">
                            {tick.label}
                        </text>
                    ))}
                    {stormH > 0 && <line x1={0} x2={track} y1={stormY} y2={stormY} stroke="#222" />}
                    {eventsH > 0 && <line x1={0} x2={track} y1={eventsY} y2={eventsY} stroke="#222" />}
                    {closuresH > 0 && <line x1={0} x2={track} y1={closuresY} y2={closuresY} stroke="#222" />}
                    {bundle.exercise?.suspension && (
                        <rect
                            x={x(Date.parse(bundle.exercise.suspension.start))}
                            width={Math.max(1, x(Date.parse(bundle.exercise.suspension.end)) - x(Date.parse(bundle.exercise.suspension.start)))}
                            y={HEADER}
                            height={height - HEADER}
                            fill="#f2f2f2"
                            opacity={0.05}
                        >
                            <title>{bundle.exercise.suspension.description}</title>
                        </rect>
                    )}
                    {storm.map((segment) => {
                        const [red, green, blue] = segment.category === 0 ? [92, 92, 92] : SURGE[segment.category - 1];
                        return (
                            <rect
                                key={segment.t0}
                                x={x(segment.t0)}
                                width={Math.max(1, x(segment.t1) - x(segment.t0))}
                                y={stormY + 5}
                                height={8}
                                fill={`rgb(${red} ${green} ${blue})`}
                            >
                                <title>{segment.category === 0 ? "Below hurricane strength" : `Category ${segment.category}`}</title>
                            </rect>
                        );
                    })}
                    {events.map((event) => (
                        <rect
                            key={event.id}
                            x={x(Date.parse(event.t)) - 1}
                            width={event.importance === 1 ? 3 : 2}
                            y={eventsY + (event.importance === 1 ? 3 : 5)}
                            height={event.importance === 1 ? 12 : 8}
                            fill={event.importance === 1 ? "#f2f2f2" : "#8a8a8a"}
                            onPointerDown={(eventPointer) => {
                                eventPointer.stopPropagation();
                                seek(Date.parse(event.t), true);
                            }}
                        >
                            <title>{`${formatWhen(event.t, timeZone)} — ${event.title}`}</title>
                        </rect>
                    ))}
                    {closureLayout.map((item) => (
                        <rect
                            key={item.disruption.id}
                            x={x(item.opened)}
                            width={Math.max(2, x(item.closed) - x(item.opened))}
                            y={closuresY + 6 + item.row * 8}
                            height={5}
                            fill="#c44848"
                            opacity={0.9}
                            onPointerDown={(eventPointer) => {
                                eventPointer.stopPropagation();
                                seek(item.opened, true);
                            }}
                        >
                            <title>{`${item.disruption.name} — from ${formatWhen(item.disruption.start, timeZone)}`}</title>
                        </rect>
                    ))}
                    {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke="#5c5c5c" />}
                    <line x1={x(time)} x2={x(time)} y1={0} y2={height} stroke="#f2f2f2" />
                    </g>
                </g>
            </svg>
            {hover !== null && (
                <div
                    className="pointer-events-none absolute top-0 border border-line bg-bg px-1.5 py-0.5 text-xs text-fg"
                    style={{ left: Math.min(width - 140, LANE_LABEL + x(hover) + 8) }}
                >
                    {formatWhen(new Date(hover).toISOString(), timeZone)}
                </div>
            )}
        </div>
    );
}

function Playback({
    bundle,
    start,
    end,
    time,
    playing,
    speed,
    timeZone,
    onTime,
    onToggle,
    onSpeed,
}: {
    bundle: IncidentBundle;
    start: number;
    end: number;
    time: number;
    playing: boolean;
    speed: number;
    timeZone: string;
    onTime: (time: number) => void;
    onToggle: () => void;
    onSpeed: (speed: number) => void;
}) {
    function jump(next: number) {
        onTime(Math.min(end, Math.max(start, next)));
    }

    return (
        <div className="absolute inset-x-0 bottom-0 z-10 border-t border-line bg-bg">
            <div className="flex items-center gap-2 px-3 py-1.5">
                <button type="button" onClick={() => jump(start)} className="flex h-8 w-8 shrink-0 items-center justify-center border border-line" aria-label="Jump to start">
                    <span className="flex items-center">
                        <span className="h-3 w-px bg-fg" />
                        <span className="border-y-[5px] border-r-[6px] border-y-transparent border-r-fg" />
                    </span>
                </button>
                <button type="button" onClick={() => jump(time - 15 * 60_000)} className="flex h-8 w-8 shrink-0 items-center justify-center border border-line" aria-label="Back 15 minutes">
                    <span className="border-y-[5px] border-r-[7px] border-y-transparent border-r-fg" />
                </button>
                <button type="button" onClick={onToggle} className="flex h-8 w-8 shrink-0 items-center justify-center border border-line" aria-label={playing ? "Pause" : "Play"}>
                    {playing ? (
                        <span className="flex gap-1">
                            <span className="h-3 w-0.5 bg-fg" />
                            <span className="h-3 w-0.5 bg-fg" />
                        </span>
                    ) : (
                        <span className="ml-0.5 border-y-[5px] border-l-[7px] border-y-transparent border-l-fg" />
                    )}
                </button>
                <button type="button" onClick={() => jump(time + 15 * 60_000)} className="flex h-8 w-8 shrink-0 items-center justify-center border border-line" aria-label="Forward 15 minutes">
                    <span className="border-y-[5px] border-l-[7px] border-y-transparent border-l-fg" />
                </button>
                <button type="button" onClick={() => jump(end)} className="flex h-8 w-8 shrink-0 items-center justify-center border border-line" aria-label="Jump to end">
                    <span className="flex items-center">
                        <span className="border-y-[5px] border-l-[6px] border-y-transparent border-l-fg" />
                        <span className="h-3 w-px bg-fg" />
                    </span>
                </button>
                <div className="flex shrink-0 border border-line" role="group" aria-label="Playback speed">
                    {SPEEDS.map((value) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => onSpeed(value)}
                            className={`px-2 py-1 text-xs ${speed === value ? "bg-fg text-bg" : "text-dim"}`}
                            title={value === 240 ? "4 incident-hours per second" : `${value} incident-minute${value === 1 ? "" : "s"} per second`}
                        >
                            {value === 240 ? "Overview" : `${value}×`}
                        </button>
                    ))}
                </div>
                <span className="ml-auto shrink-0 text-xs text-fg">{formatWhen(new Date(time).toISOString(), timeZone)}</span>
            </div>
            <div className="px-3 pb-1">
                <input
                    type="range"
                    min={start}
                    max={end}
                    step={1_000}
                    value={Math.min(time, end)}
                    onPointerDown={() => {
                        if (playing) onToggle();
                    }}
                    onChange={(event) => onTime(Number(event.target.value))}
                    className="block h-6 w-full accent-fg"
                    aria-label="Time"
                />
            </div>
            <EventStrip
                bundle={bundle}
                start={start}
                end={end}
                time={time}
                timeZone={timeZone}
                playing={playing}
                onTime={onTime}
                onToggle={onToggle}
            />
        </div>
    );
}

export function Map({ bundle, roads }: MapProps) {
    const [tip, setTip] = useState<HoverTip | null>(null);
    const mapRef = useRef<MapRef>(null);
    const [visible, setVisible] = useState(INITIAL_LAYERS);
    const [time, setTime] = useState(() => initialTime(bundle));
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(15);
    const [zoom, setZoom] = useState(bundle.manifest.zoom);
    const [mapReady, setMapReady] = useState(false);
    useLayoutEffect(() => () => setMapReady(false), []);
    const options = useMemo(() => layersIn(bundle), [bundle]);
    const simulation = useMemo(() => (bundle.exercise ? simulate(bundle.exercise, roads) : null), [bundle.exercise, roads]);
    const layers = useMemo(() => buildLayers(bundle, roads, visible, time, simulation, zoom), [bundle, roads, visible, time, simulation, zoom]);
    const [longitude, latitude] = bundle.manifest.center;
    const start = Date.parse(bundle.manifest.timeRange.start);
    const end = Date.parse(bundle.manifest.timeRange.end);

    useEffect(() => {
        setTime(initialTime(bundle));
        setPlaying(false);
        setZoom(bundle.manifest.zoom);
    }, [bundle]);

    useEffect(() => {
        if (!playing) return;
        let frame = 0;
        let last = performance.now();
        const tick = (now: number) => {
            const dt = Math.min(0.25, (now - last) / 1000);
            last = now;
            setTime((current) => {
                const next = current + dt * speed * 60_000;
                return next >= end ? end : next;
            });
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing, speed, end]);

    useEffect(() => {
        if (playing && time >= end) setPlaying(false);
    }, [playing, time, end]);

    function toggle(id: LayerId) {
        setVisible((current) => ({ ...current, [id]: !current[id] }));
    }

    function togglePlay() {
        if (playing) {
            setPlaying(false);
            return;
        }
        if (time >= end - 1000) setTime(start);
        setPlaying(true);
    }

    useEffect(() => {
        function onKey(event: KeyboardEvent) {
            if (event.repeat || event.key !== " ") return;
            const target = event.target;
            if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
            if (target instanceof HTMLInputElement && target.type !== "range") return;
            if (target instanceof HTMLElement && target.isContentEditable) return;
            if (target instanceof HTMLButtonElement) return;
            event.preventDefault();
            togglePlay();
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [playing, time, start, end]);

    const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: bundle.manifest.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(time);

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

    function showEvent(next: number) {
        if (playing) setPlaying(false);
        setTime(Math.min(end, Math.max(start, next)));
    }

    function focusUnit(lon: number, lat: number) {
        const map = mapRef.current;
        if (!map) return;
        const canvas = map.getCanvas();
        map.flyTo({
            center: [lon, lat],
            zoom: Math.max(map.getZoom(), 12),
            padding: {
                top: 40,
                right: 24,
                bottom: Math.min(220, canvas.height * 0.35),
                left: Math.min(250, canvas.width * 0.4),
            },
            duration: 700,
        });
    }

    return (
        <div className="flex h-full w-full">
            <div className="map-frame relative min-h-0 min-w-0 flex-1" onMouseLeave={() => setTip(null)}>
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
                ref={mapRef}
                mapLib={maplibre}
                initialViewState={{ longitude, latitude, zoom: bundle.manifest.zoom }}
                onMove={(event) => {
                    const next = event.viewState.zoom;
                    setZoom((current) => (Math.abs(current - next) < 0.05 ? current : next));
                }}
                mapStyle={DARK}
                onLoad={() => setMapReady(true)}
                attributionControl={{ compact: true }}
                style={{ width: "100%", height: "100%" }}
            >
                {visible.imagery && bundle.imagery.filter((imagery) => imagery.acquiredDate <= day).map((imagery) => (
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
                {mapReady && <DeckOverlay layers={layers} onHover={onHover} getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")} />}
                <NavigationControl position="top-right" showCompass={false} />
                <ScaleControl position="bottom-right" unit="imperial" />
            </MapCanvas>
            <UnitList
                units={simulation?.units ?? []}
                colors={UNIT_COLORS}
                time={time}
                onSelect={focusUnit}
                layers={options}
                visible={visible}
                onToggle={(id) => toggle(id as LayerId)}
            />
            <Playback
                bundle={bundle}
                start={start}
                end={end}
                time={time}
                playing={playing}
                speed={speed}
                timeZone={bundle.manifest.timezone}
                onTime={setTime}
                onToggle={togglePlay}
                onSpeed={setSpeed}
            />
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
            <EventList events={bundle.timeline} time={time} timeZone={bundle.manifest.timezone} onSelect={showEvent} />
        </div>
    );
}
