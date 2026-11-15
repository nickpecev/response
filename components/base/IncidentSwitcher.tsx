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
        <label className="relative flex min-w-0 items-center" title="Incident">
            <span className="sr-only">Incident</span>
            <select
                value={activeIncidentId}
                onChange={(event) => setActiveIncidentId(event.target.value)}
                className="field-sizing-content min-w-0 max-w-64 appearance-none truncate rounded-sm py-1 pr-5 pl-0 text-[13px] text-fg outline-none hover:text-accent"
            >
                {!listed && <option value={activeIncidentId}>{activeIncidentId}</option>}
                {incidents.map((incident) => (
                    <option key={incident.id} value={incident.id}>
                        {incident.shortName}
                    </option>
                ))}
            </select>
            <svg viewBox="0 0 8 5" className="pointer-events-none absolute right-0.5 h-1.5 w-2 text-muted" aria-hidden>
                <path d="M0 0h8L4 5Z" fill="currentColor" />
            </svg>
        </label>
    );
}
