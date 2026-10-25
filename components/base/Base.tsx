"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
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
    // { href: "/analytics", label: "Analytics" },
    // { href: "/reports", label: "After-Action Reports" },
    // { href: "/settings", label: "Settings" },
    // These were all planned, but will possibly implement later
];

function navHref(item: NavItem, activeIncidentId: string) {
    if (item.scoped) return `/workspace/${activeIncidentId}`;
    return item.href;
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
        <div className="flex h-dvh w-full overflow-hidden bg-bg text-fg">
            <aside className="no-print flex w-52 shrink-0 flex-col border-r border-line bg-bg">
                <div className="space-y-3 border-b border-line px-2 py-3">
                    <Link href="/" className="block truncate px-2 text-sm text-fg">
                        Response Tool
                    </Link>
                    <IncidentSwitcher />
                </div>
                <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Main">
                    {NAV.map((item) => {
                        const href = navHref(item, activeIncidentId);
                        const current = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={href}
                                className={`flex h-8 items-center px-2 text-[13px] ${current ? "text-fg" : "text-muted hover:text-fg"}`}
                            >
                                <span className="truncate">{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>
            </aside>
            <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
        </div>
    );
}
