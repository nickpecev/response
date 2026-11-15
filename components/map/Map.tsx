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
import { SituationPanel } from "@/components/map/SituationPanel";
import { formatClock, formatDay, formatWhen, localHour, roadClosures, stormCategory, stormPosition } from "@/components/map/incident";

maplibre.setWorkerUrl("/vendor/maplibre-gl-worker.mjs");

const BASEMAP = "https://tiles.openfreemap.org/styles/dark";
const MONO = "IBM Plex Mono, ui-monospace, Menlo, monospace";

const ink: [number, number, number, number] = [232, 232, 230, 230];
const paper: [number, number, number, number] = [11, 12, 13, 255];
const bright: [number, number, number, number] = [255, 255, 255, 255];
const faint: [number, number, number, number] = [232, 232, 230, 20];
const line: [number, number, number, number] = [232, 232, 230, 90];
const down: [number, number, number, number] = [229, 83, 61, 240];
const closedOutline: [number, number, number, number] = [11, 12, 13, 230];
const closedLine: [number, number, number, number] = [229, 83, 61, 235];

const SURGE: [number, number, number, number][] = [
    [246, 214, 96, 70],
    [232, 146, 58, 80],
    [210, 82, 52, 90],
    [168, 42, 58, 100],
    [110, 36, 92, 110],
];

const WIND_FILL: [number, number, number, number][] = [
    [226, 160, 40, 5],
    [232, 104, 22, 8],
    [229, 83, 61, 14],
];

const WIND_LINE: [number, number, number, number][] = [
    [226, 160, 40, 110],
    [232, 104, 22, 140],
    [229, 83, 61, 180],
];

/** Distinct on a dark basemap, and kept away from the red signal hue. */
const UNIT_COLORS: [number, number, number][] = [
    [96, 170, 255],
    [80, 210, 170],
    [190, 150, 255],
    [255, 140, 200],
    [150, 210, 90],
    [100, 210, 230],
    [210, 190, 150],
    [140, 150, 255],
    [230, 120, 255],
    [120, 190, 140],
    [180, 180, 190],
    [255, 190, 230],
];

const LANE_SEGMENT: [number, number, number][] = [
    [72, 74, 78],
    [246, 214, 96],
    [232, 146, 58],
    [210, 82, 52],
    [168, 42, 58],
    [110, 36, 92],
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
                getFillColor: [232, 232, 230, 10],
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
                getLineColor: [232, 232, 230, 90],
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
                getFillColor: [232, 232, 230, 16],
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
                getColor: [232, 232, 230, 170],
                widthMinPixels: 1.5,
                pickable: true,
            }),
        );
        layers.push(
            new ScatterplotLayer({
                id: "storm-fixes",
                data: stormPoints,
                getPosition: (point: StormTrackPoint) => [point.lon, point.lat],
                getFillColor: ink,
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
                    getFillColor: bright,
                    getLineColor: paper,
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
                getFillColor: ink,
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
                getColor: ink,
                getPixelOffset: [0, 12],
                fontFamily: MONO,
                outlineWidth: 2,
                outlineColor: paper,
                fontSettings: { sdf: true },
            }),
        );
    }

    if (visible.assets && bundle.assets.length) {
        layers.push(
            new ScatterplotLayer({
                id: "assets",
                data: bundle.assets,
                getPosition: (asset: InfrastructureAsset) => [asset.location.lon, asset.location.lat],
                getFillColor: (asset: InfrastructureAsset) => (assetDown(asset, time) ? down : [232, 232, 230, 150]),
                getLineColor: paper,
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
                getLineColor: (site: ExerciseInputs["staging"][number]) => (siteDown(site, time) ? down : ink),
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
                getFillColor: (item: (typeof calls)[number]) => (item.handled ? [85, 88, 93, 255] : item.call.priority === 1 ? down : [232, 232, 230, 255]),
                getLineColor: paper,
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
                    getLineColor: paper,
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
                    getColor: ink,
                    getPixelOffset: [0, -16],
                    fontFamily: MONO,
                    fontWeight: 500,
                    outlineWidth: 3,
                    outlineColor: paper,
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
const HEADER = 20;
const LANE_LABEL = 68;
const MAX_CLOSURE_ROWS = 3;

function Icon({ d, className = "" }: { d: string; className?: string }) {
    return (
        <svg viewBox="0 0 12 12" className={`h-3 w-3 ${className}`} aria-hidden>
            <path d={d} fill="currentColor" />
        </svg>
    );
}

const ICONS = {
    first: "M2 2h1.5v8H2zM10 2v8L4 6z",
    back: "M9.5 2v8L3.5 6z",
    play: "M3 1.5v9L10.5 6z",
    pause: "M2.5 2h2.5v8H2.5zM7 2h2.5v8H7z",
    forward: "M2.5 2v8l6-4z",
    last: "M8.5 2H10v8H8.5zM2 2v8l6-4z",
};

function Timeline({
    bundle,
    start,
    end,
    time,
    timeZone,
    playing,
    speed,
    onTime,
    onToggle,
    onSpeed,
}: {
    bundle: IncidentBundle;
    start: number;
    end: number;
    time: number;
    timeZone: string;
    playing: boolean;
    speed: number;
    onTime: (time: number) => void;
    onToggle: () => void;
    onSpeed: (speed: number) => void;
}) {
    const frame = useRef<HTMLDivElement>(null);
    const drag = useRef(false);
    const [width, setWidth] = useState(0);
    const [hover, setHover] = useState<number | null>(null);
    const span = Math.max(1, end - start);
    const track = Math.max(1, width - LANE_LABEL - 12);
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
    const closureLayout = roadClosures(bundle)
        .filter((disruption) => disruption.path.length > 1)
        .map((disruption) => ({
            disruption,
            opened: Date.parse(disruption.start),
            closed: disruption.end ? Date.parse(disruption.end) : end,
            row: 0,
        }));
    const lanes: { opened: number; closed: number }[][] = [];
    for (const item of closureLayout) {
        let row = lanes.findIndex((lane) => lane.every((other) => other.closed <= item.opened || item.closed <= other.opened));
        if (row < 0) {
            row = lanes.length;
            lanes.push([]);
        }
        lanes[row].push(item);
        item.row = Math.min(row, MAX_CLOSURE_ROWS - 1);
    }
    const closureRows = Math.min(lanes.length, MAX_CLOSURE_ROWS);

    const stormH = storm.length ? 16 : 0;
    const eventsH = events.length ? 20 : 0;
    const closuresH = closureLayout.length ? closureRows * 6 + 10 : 0;
    const height = Math.max(84, HEADER + stormH + eventsH + closuresH + 4);
    const stormY = HEADER;
    const eventsY = stormY + stormH;
    const closuresY = eventsY + eventsH;

    useEffect(() => {
        const node = frame.current;
        if (!node) return;
        const watch = new ResizeObserver(() => setWidth(node.clientWidth));
        watch.observe(node);
        setWidth(node.clientWidth);
        return () => watch.disconnect();
    }, []);

    const ticks = useMemo(() => {
        const marks: { t: number; major: boolean }[] = [];
        for (let cursor = Math.ceil(start / 3600_000) * 3600_000; cursor <= end; cursor += 3600_000) {
            const hour = localHour(cursor, timeZone);
            if (hour === 0 || hour === 12) marks.push({ t: cursor, major: hour === 0 });
        }
        return marks;
    }, [start, end, timeZone]);

    function clamp(next: number) {
        return Math.min(end, Math.max(start, next));
    }

    function seek(next: number, pause: boolean) {
        if (pause && playing) onToggle();
        onTime(clamp(next));
    }

    function timeAt(clientX: number, node: SVGSVGElement) {
        const rect = node.getBoundingClientRect();
        const px = clientX - rect.left - LANE_LABEL;
        return start + (Math.min(track, Math.max(0, px)) / track) * span;
    }

    const dateLabels: number[] = [];
    let lastLabel = -60;
    for (const tick of ticks) {
        if (!tick.major) continue;
        const left = x(tick.t);
        if (left < lastLabel + 60) continue;
        lastLabel = left;
        dateLabels.push(tick.t);
    }

    const ghost = "flex h-7 w-7 items-center justify-center rounded-sm text-muted transition-colors hover:bg-raised hover:text-fg";
    const head = x(Math.min(time, end));
    const flagW = 42;
    const flagX = Math.min(track - flagW, Math.max(0, head - flagW / 2));

    return (
        <div className="col-span-3 flex border-t border-line bg-panel">
            <div className="flex w-[280px] shrink-0 flex-col justify-center gap-2.5 border-r border-line px-4 py-3">
                <div className="flex items-center gap-1">
                    <button type="button" onClick={() => seek(start, false)} className={ghost} aria-label="Jump to start" title="Jump to start">
                        <Icon d={ICONS.first} />
                    </button>
                    <button type="button" onClick={() => seek(time - 15 * 60_000, false)} className={ghost} aria-label="Back 15 minutes" title="Back 15 minutes">
                        <Icon d={ICONS.back} />
                    </button>
                    <button
                        type="button"
                        onClick={onToggle}
                        className="mx-1 flex h-7 w-10 items-center justify-center rounded-sm bg-accent text-bg transition-colors hover:bg-accent/85"
                        aria-label={playing ? "Pause" : "Play"}
                        title={playing ? "Pause (Space)" : "Play (Space)"}
                    >
                        <Icon d={playing ? ICONS.pause : ICONS.play} />
                    </button>
                    <button type="button" onClick={() => seek(time + 15 * 60_000, false)} className={ghost} aria-label="Forward 15 minutes" title="Forward 15 minutes">
                        <Icon d={ICONS.forward} />
                    </button>
                    <button type="button" onClick={() => seek(end, false)} className={ghost} aria-label="Jump to end" title="Jump to end">
                        <Icon d={ICONS.last} />
                    </button>
                    <span className="ml-auto text-[11px] text-dim">
                        <kbd className="font-sans">Space</kbd>
                    </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-dim">Speed</span>
                    <div className="flex rounded-sm bg-raised p-0.5" role="group" aria-label="Playback speed">
                        {SPEEDS.map((value) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => onSpeed(value)}
                                aria-pressed={speed === value}
                                className={`rounded-[2px] px-2 py-0.5 text-[11px] tabular-nums transition-colors ${speed === value ? "bg-line text-fg" : "text-muted hover:text-fg"}`}
                                title={value === 240 ? "4 incident-hours per second" : `${value} incident-minute${value === 1 ? "" : "s"} per second`}
                            >
                                {value}×
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <div ref={frame} className="relative min-w-0 flex-1 cursor-crosshair select-none">
                <svg
                    width={width || "100%"}
                    height={height}
                    className="block outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
                    role="slider"
                    aria-label="Incident timeline"
                    aria-valuemin={start}
                    aria-valuemax={end}
                    aria-valuenow={time}
                    aria-valuetext={formatWhen(time, timeZone)}
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
                        if (drag.current) onTime(clamp(next));
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
                    {stormH > 0 && (
                        <text x={14} y={stormY + stormH / 2 + 3} className="fill-dim font-mono text-[9px] tracking-[0.08em]">
                            STORM
                        </text>
                    )}
                    {eventsH > 0 && (
                        <text x={14} y={eventsY + eventsH / 2 + 3} className="fill-dim font-mono text-[9px] tracking-[0.08em]">
                            EVENTS
                        </text>
                    )}
                    {closuresH > 0 && (
                        <text x={14} y={closuresY + closuresH / 2 + 3} className="fill-dim font-mono text-[9px] tracking-[0.08em]">
                            CLOSURES
                        </text>
                    )}
                    <g transform={`translate(${LANE_LABEL},0)`}>
                        <clipPath id="timeline-clip">
                            <rect x={0} y={0} width={track} height={height} />
                        </clipPath>
                        <g clipPath="url(#timeline-clip)">
                            <rect x={0} y={HEADER} width={Math.max(0, head)} height={height - HEADER} className="fill-fg" opacity={0.025} />
                            {ticks.map((tick) => (
                                <line key={tick.t} x1={x(tick.t)} x2={x(tick.t)} y1={tick.major ? 4 : HEADER} y2={height} className={tick.major ? "stroke-line" : "stroke-rule"} />
                            ))}
                            {dateLabels.map((t) => (
                                <text key={t} x={x(t) + 5} y={13} className="fill-dim font-mono text-[9px] tracking-[0.08em]">
                                    {formatDay(t, timeZone).toUpperCase()}
                                </text>
                            ))}
                            {bundle.exercise?.suspension && (
                                <rect
                                    x={x(Date.parse(bundle.exercise.suspension.start))}
                                    width={Math.max(1, x(Date.parse(bundle.exercise.suspension.end)) - x(Date.parse(bundle.exercise.suspension.start)))}
                                    y={HEADER}
                                    height={height - HEADER}
                                    className="fill-fg"
                                    opacity={0.05}
                                >
                                    <title>{bundle.exercise.suspension.description}</title>
                                </rect>
                            )}
                            {storm.map((segment) => {
                                const [red, green, blue] = LANE_SEGMENT[segment.category];
                                return (
                                    <rect
                                        key={segment.t0}
                                        x={x(segment.t0)}
                                        width={Math.max(1, x(segment.t1) - x(segment.t0))}
                                        y={stormY + stormH / 2 - 2}
                                        height={4}
                                        fill={`rgb(${red} ${green} ${blue})`}
                                    >
                                        <title>{segment.category === 0 ? "Below hurricane strength" : `Category ${segment.category}`}</title>
                                    </rect>
                                );
                            })}
                            {events.map((event) => {
                                const major = event.importance === 1;
                                return (
                                    <rect
                                        key={event.id}
                                        x={x(Date.parse(event.t)) - 0.5}
                                        width={major ? 2 : 1}
                                        y={eventsY + (major ? 4 : 7)}
                                        height={major ? 12 : 6}
                                        className={`cursor-pointer ${major ? "fill-fg" : "fill-muted"}`}
                                        onPointerDown={(pointer) => {
                                            pointer.stopPropagation();
                                            seek(Date.parse(event.t), true);
                                        }}
                                    >
                                        <title>{`${formatWhen(event.t, timeZone)} — ${event.title}`}</title>
                                    </rect>
                                );
                            })}
                            {closureLayout.map((item) => (
                                <rect
                                    key={item.disruption.id}
                                    x={x(item.opened)}
                                    width={Math.max(2, x(item.closed) - x(item.opened))}
                                    y={closuresY + 5 + item.row * 6}
                                    height={3}
                                    className="cursor-pointer fill-signal"
                                    opacity={0.75}
                                    onPointerDown={(pointer) => {
                                        pointer.stopPropagation();
                                        seek(item.opened, true);
                                    }}
                                >
                                    <title>{`${item.disruption.name} — from ${formatWhen(item.disruption.start, timeZone)}`}</title>
                                </rect>
                            ))}
                            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={HEADER} y2={height} className="stroke-muted" strokeDasharray="2 3" />}
                            <line x1={head} x2={head} y1={HEADER - 2} y2={height} className="stroke-accent" />
                            <rect x={flagX} y={3} width={flagW} height={14} rx={2} className="fill-accent" />
                            <text x={flagX + flagW / 2} y={13} textAnchor="middle" className="fill-bg font-mono text-[10px] font-medium">
                                {formatClock(time, timeZone)}
                            </text>
                        </g>
                    </g>
                </svg>
                {hover !== null && (
                    <div
                        className="pointer-events-none absolute bottom-2 rounded-sm bg-raised px-2 py-1 text-[11px] whitespace-nowrap text-fg shadow-[0_6px_20px_rgba(0,0,0,0.5)] ring-1 ring-line"
                        style={{ left: Math.min(width - 150, LANE_LABEL + x(hover) + 8) }}
                    >
                        {formatWhen(hover, timeZone)}
                    </div>
                )}
            </div>
        </div>
    );
}

export function Map({ bundle, roads }: MapProps) {
    const [tip, setTip] = useState<HoverTip | null>(null);
    const mapRef = useRef<MapRef>(null);
    const [visible, setVisible] = useState(INITIAL_LAYERS);
    const [layersOpen, setLayersOpen] = useState(false);
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
    const [center, setCenter] = useState({ lon: longitude, lat: latitude });
    const start = Date.parse(bundle.manifest.timeRange.start);
    const end = Date.parse(bundle.manifest.timeRange.end);
    const timeZone = bundle.manifest.timezone;

    useEffect(() => {
        setTime(initialTime(bundle));
        setPlaying(false);
        setZoom(bundle.manifest.zoom);
        setCenter({ lon: bundle.manifest.center[0], lat: bundle.manifest.center[1] });
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
            if (event.key === "Escape") setLayersOpen(false);
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
        timeZone,
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
        map.flyTo({
            center: [lon, lat],
            zoom: Math.max(map.getZoom(), 12),
            padding: { top: 40, right: 40, bottom: 40, left: 40 },
            duration: 700,
        });
    }

    const activeLayers = options.filter((layer) => visible[layer.id as LayerId]).length;

    return (
        <div className="grid h-full w-full grid-cols-[280px_minmax(0,1fr)_300px] grid-rows-[minmax(0,1fr)_auto]">
            <SituationPanel bundle={bundle} simulation={simulation} time={time} colors={UNIT_COLORS} onFocus={focusUnit} />
            <div className="map-frame relative min-h-0 min-w-0" onMouseLeave={() => setTip(null)}>
                <MapCanvas
                    ref={mapRef}
                    mapLib={maplibre}
                    initialViewState={{ longitude, latitude, zoom: bundle.manifest.zoom }}
                    onMove={(event) => {
                        const next = event.viewState.zoom;
                        setZoom((current) => (Math.abs(current - next) < 0.05 ? current : next));
                        const { longitude: lon, latitude: lat } = event.viewState;
                        setCenter((current) => (Math.abs(current.lon - lon) < 0.0005 && Math.abs(current.lat - lat) < 0.0005 ? current : { lon, lat }));
                    }}
                    mapStyle={BASEMAP}
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

                <div className="absolute top-[78px] right-[10px] z-10">
                    <button
                        type="button"
                        onClick={() => setLayersOpen((open) => !open)}
                        aria-expanded={layersOpen}
                        aria-label="Map layers"
                        title="Map layers"
                        className={`flex h-[29px] w-[29px] items-center justify-center rounded-[2px] bg-raised shadow-[0_1px_0_rgba(0,0,0,0.4)] transition-colors ${layersOpen ? "text-accent" : "text-fg hover:text-accent"}`}
                    >
                        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
                            <path d="M8 2 15 5.5 8 9 1 5.5Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                            <path d="M1 8.5 8 12l7-3.5M1 11.5 8 15l7-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                        </svg>
                    </button>
                    {layersOpen && (
                        <div className="absolute top-0 right-9 w-56 rounded-sm bg-raised py-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.55)] ring-1 ring-line">
                            <div className="flex items-baseline justify-between px-3 pt-1 pb-2">
                                <span className="caps text-dim">Layers</span>
                                <span className="text-[11px] tabular-nums text-dim">
                                    {activeLayers}/{options.length}
                                </span>
                            </div>
                            {options.map((layer) => {
                                const on = visible[layer.id as LayerId];
                                return (
                                    <button
                                        key={layer.id}
                                        type="button"
                                        role="switch"
                                        aria-checked={on}
                                        onClick={() => toggle(layer.id as LayerId)}
                                        className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-line/60 ${on ? "text-fg" : "text-muted"}`}
                                    >
                                        {layer.label}
                                        <span className={`relative h-3 w-5 rounded-full transition-colors ${on ? "bg-accent" : "bg-line"}`}>
                                            <span className={`absolute top-0.5 h-2 w-2 rounded-full bg-bg transition-all ${on ? "left-2.5" : "left-0.5"}`} />
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="pointer-events-none absolute bottom-2 left-3 z-10 font-mono text-[10px] tabular-nums text-muted [text-shadow:0_1px_2px_#000]">
                    {Math.abs(center.lat).toFixed(3)}°{center.lat >= 0 ? "N" : "S"}
                    {"  "}
                    {Math.abs(center.lon).toFixed(3)}°{center.lon >= 0 ? "E" : "W"}
                    <span className="ml-3 text-dim">z{zoom.toFixed(1)}</span>
                </div>

                {tip && (
                    <div
                        className="pointer-events-none absolute z-20 max-w-xs rounded-sm bg-raised px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.55)] ring-1 ring-line"
                        style={{ left: tip.x + 14, top: tip.y + 14 }}
                    >
                        <div className="text-[13px] font-medium text-fg">{tip.title}</div>
                        {tip.lines.map((item) => (
                            <div key={item} className="mt-0.5 text-[11px] leading-snug text-muted first-letter:uppercase">
                                {item}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <EventList events={bundle.timeline} time={time} timeZone={timeZone} onSelect={showEvent} />
            <Timeline
                bundle={bundle}
                start={start}
                end={end}
                time={time}
                timeZone={timeZone}
                playing={playing}
                speed={speed}
                onTime={setTime}
                onToggle={togglePlay}
                onSpeed={setSpeed}
            />
        </div>
    );
}
