"use client";

import { useEffect, useState } from "react";
import { Map } from "@/components/map/Map";
import { loadBundledIncident, loadGraph, type IncidentBundle, type RoadGraph } from "@/lib/model/data/loader";
import { useApp } from "@/lib/store/app";

export default function Home() {
    const activeIncidentId = useApp((state) => state.activeIncidentId);
    const [bundle, setBundle] = useState<IncidentBundle | null>(null);
    const [roads, setRoads] = useState<RoadGraph | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let current = true;
        setBundle(null);
        setRoads(null);
        setFailed(false);
        loadBundledIncident(activeIncidentId)
            .then(async (loaded) => {
                const graph = loaded.graphUrl ? await loadGraph(loaded.graphUrl) : null;
                if (!current) return;
                setRoads(graph);
                setBundle(loaded);
            })
            .catch(() => {
                if (current) setFailed(true);
            });
        return () => {
            current = false;
        };
    }, [activeIncidentId]);

    if (failed) {
        return <p className="p-6 text-sm text-muted">Could not load {activeIncidentId}.</p>;
    }
    if (!bundle) return null;
    return <Map bundle={bundle} roads={roads} />;
}
