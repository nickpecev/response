"use client";

import { useEffect, useState } from "react";
import { listBundledIncidents } from "@/lib/model/data/loader";
import type { IncidentManifest } from "@/lib/model/types";
import { useApp } from "@/lib/store/app";

export function IncidentSwitcher() {
    const activeIncidentId = useApp((state) => state.activeIncidentId);
    const setActiveIncidentId = useApp((state) => state.setActiveIncidentId);
    const [incidents, setIncidents] = useState<IncidentManifest[]>([]);

    useEffect(() => {
        listBundledIncidents().then(setIncidents).catch(() => setIncidents([]));
    }, []);

    const listed = incidents.some((incident) => incident.id === activeIncidentId);

    return (
        <label className="min-w-0">
            <span className="sr-only">Incident</span>
            <select
                value={activeIncidentId}
                onChange={(event) => setActiveIncidentId(event.target.value)}
                className="w-full truncate bg-bg px-2 text-[13px] text-muted outline-none"
            >
                {!listed && <option value={activeIncidentId}>{activeIncidentId}</option>}
                {incidents.map((incident) => (
                    <option key={incident.id} value={incident.id}>
                        {incident.shortName}
                    </option>
                ))}
            </select>
        </label>
    );
}
