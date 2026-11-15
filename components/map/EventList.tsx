"use client";

import { useEffect, useMemo, useRef } from "react";
import type { TimelineEvent } from "@/lib/model/types";
import { formatClock, formatLongDay } from "@/components/map/incident";

interface EventListProps {
    events: TimelineEvent[];
    time: number;
    timeZone: string;
    onSelect: (time: number) => void;
}

export function EventList({ events, time, timeZone, onSelect }: EventListProps) {
    const currentRef = useRef<HTMLButtonElement>(null);
    const listed = useMemo(() => {
        return events
            .filter((event) => event.source?.sourceId !== "noaa-hurdat2" && event.source?.sourceId !== "usgs-stn-ian")
            .slice()
            .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    }, [events]);

    const days = useMemo(() => {
        const groups: { key: string; label: string; events: TimelineEvent[] }[] = [];
        const keyOf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
        for (const event of listed) {
            const at = Date.parse(event.t);
            const key = keyOf.format(at);
            let group = groups[groups.length - 1];
            if (!group || group.key !== key) {
                group = { key, label: formatLongDay(at, timeZone), events: [] };
                groups.push(group);
            }
            group.events.push(event);
        }
        return groups;
    }, [listed, timeZone]);

    let currentId = "";
    for (const event of listed) {
        if (Date.parse(event.t) <= time) currentId = event.id;
    }

    useEffect(() => {
        currentRef.current?.scrollIntoView({ block: "nearest" });
    }, [currentId]);

    return (
        <aside className="flex min-h-0 flex-col border-l border-line bg-panel">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-rule px-4">
                <span className="caps text-dim">Timeline</span>
                <span className="text-[11px] tabular-nums text-dim">{listed.length} events</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-4">
                {days.map((day) => (
                    <section key={day.key}>
                        <h3 className="sticky top-0 z-[1] bg-panel/95 px-4 pt-3 pb-1.5 text-[11px] font-medium text-muted backdrop-blur-sm">{day.label}</h3>
                        {day.events.map((event) => {
                            const at = Date.parse(event.t);
                            const current = event.id === currentId;
                            const future = at > time;
                            return (
                                <button
                                    key={event.id}
                                    ref={current ? currentRef : undefined}
                                    type="button"
                                    onClick={() => onSelect(at)}
                                    className={`relative flex w-full gap-3 py-2 pr-4 pl-4 text-left transition-colors hover:bg-raised ${current ? "bg-raised" : ""}`}
                                >
                                    {current && <span className="absolute inset-y-1.5 left-0 w-0.5 bg-accent" />}
                                    <span className={`w-10 shrink-0 pt-px text-[11px] tabular-nums ${current ? "text-accent" : future ? "text-dim" : "text-muted"}`}>
                                        {formatClock(at, timeZone)}
                                    </span>
                                    <span className={`text-[13px] leading-snug ${current ? "text-fg" : future ? "text-dim" : "text-muted"}`}>{event.title}</span>
                                </button>
                            );
                        })}
                    </section>
                ))}
            </div>
        </aside>
    );
}
