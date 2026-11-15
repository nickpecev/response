"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/lib/store/app";
import { IncidentSwitcher } from "@/components/base/IncidentSwitcher";

interface NavItem {
    href: string;
    label: string;
    scoped?: boolean;
}

const NAV: NavItem[] = [
    { href: "/", label: "Overview" },
    // { href: "/incidents", label: "Incident Workspaces" },
    // { href: "/investigations", label: "Investigations" },
    { href: "/analytics", label: "Analytics" },
    // { href: "/reports", label: "After-Action Reports" },
    // { href: "/settings", label: "Settings" },
    // These were all planned, but will possibly implement later
];

function navHref(item: NavItem, activeIncidentId: string) {
    if (item.scoped) return `/workspace/${activeIncidentId}`;
    return item.href;
}

/** The logo is a dark-on-transparent PNG, used as a mask so it takes the surrounding text colour. */
export function Mark({ className = "" }: { className?: string }) {
    const mask = "url(/logo.png) center / contain no-repeat";
    return <span aria-hidden className={`inline-block aspect-[319/283] bg-current ${className}`} style={{ mask, WebkitMask: mask }} />;
}

function Clock() {
    const [now, setNow] = useState<Date | null>(null);
    useEffect(() => {
        const tick = () => setNow(new Date());
        const first = window.setTimeout(tick, 0);
        const id = window.setInterval(tick, 1000);
        return () => {
            window.clearTimeout(first);
            window.clearInterval(id);
        };
    }, []);
    return (
        <span className="font-mono text-[11px] tabular-nums text-muted" title="Coordinated Universal Time">
            {now ? `${now.toISOString().slice(11, 19)}Z` : "--:--:--Z"}
        </span>
    );
}

interface BaseProps {
    children: ReactNode;
}

export function Base({ children }: BaseProps) {
    const pathname = usePathname();
    const activeIncidentId = useApp((state) => state.activeIncidentId);

    useEffect(() => {
        void useApp.persist.rehydrate();
    }, []);

    return (
        <div className="flex h-dvh w-full flex-col overflow-hidden bg-bg text-fg">
            <header className="no-print flex h-11 shrink-0 items-stretch gap-6 border-b border-line bg-panel px-4">
                <Link href="/" className="flex items-center gap-2 text-fg">
                    <Mark className="h-6" />
                    <span className="text-[14px] font-semibold tracking-[0.04em]">Aftermath</span>
                </Link>
                <nav className="flex items-stretch gap-1" aria-label="Main">
                    {NAV.map((item) => {
                        const href = navHref(item, activeIncidentId);
                        const current = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={href}
                                aria-current={current ? "page" : undefined}
                                className={`relative flex items-center px-2.5 text-[13px] transition-colors ${current ? "text-fg" : "text-muted hover:text-fg"}`}
                            >
                                {item.label}
                                {current && <span className="absolute inset-x-2.5 -bottom-px h-0.5 bg-accent" />}
                            </Link>
                        );
                    })}
                </nav>
                <span className="my-3 w-px bg-line" />
                <IncidentSwitcher />
                <div className="ml-auto flex items-center">
                    <Clock />
                </div>
            </header>
            <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
        </div>
    );
}
