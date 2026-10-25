"use client";

import { useEffect, useMemo, useRef } from "react";
import type { TimelineEvent } from "@/lib/model/types";

interface EventListProps {
    events: TimelineEvent[];
    time: number;
    timeZone: string;
    onSelect: (time: number) => void;
}

function formatWhen(iso: string, timeZone: string) {
    return new Intl.DateTimeFormat("en-US", {
        timeZone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(new Date(iso));
}

export function EventList({ events, time, timeZone, onSelect }: EventListProps) {
    const currentRef = useRef<HTMLButtonElement>(null);
    const listed = useMemo(() => {
        return events
            .filter((event) => event.source?.sourceId !== "noaa-hurdat2" && event.source?.sourceId !== "usgs-stn-ian")
            .slice()
            .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    }, [events]);

    let currentId = "";
    for (const event of listed) {
        if (Date.parse(event.t) <= time) currentId = event.id;
    }

    useEffect(() => {
        currentRef.current?.scrollIntoView({ block: "nearest" });
    }, [currentId]);

    return (
        <aside className="flex h-full w-72 shrink-0 flex-col border-l border-line bg-bg">
            <div className="border-b border-line px-3 py-2 text-xs text-muted">Events</div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {listed.map((event) => {
                    const at = Date.parse(event.t);
                    const current = event.id === currentId;
                    const future = at > time;
                    const tone = current ? "border-l-fg text-fg" : future ? "border-l-transparent text-dim" : "border-l-transparent text-muted";
                    return (
                        <button
                            key={event.id}
                            ref={current ? currentRef : undefined}
                            type="button"
                            onClick={() => onSelect(at)}
                            className={`block w-full border-b border-l-2 border-line px-3 py-2 text-left ${tone}`}
                        >
                            <div className="text-[11px] text-dim">{formatWhen(event.t, timeZone)}</div>
                            <div className="text-[13px] leading-snug">{event.title}</div>
                        </button>
                    );
                })}
            </div>
        </aside>
    );
}
