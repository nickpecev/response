import { AsciiField } from "@/components/base/AsciiField";

interface StandbyProps {
    incidentId: string;
    failed?: boolean;
}

/** Full-panel placeholder shown while an incident loads, or when it cannot be loaded. */
export function Standby({ incidentId, failed = false }: StandbyProps) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 overflow-hidden">
            <AsciiField variant="globe" animate={!failed} className="h-[min(48vh,380px)] w-[min(80vw,520px)]" />
            <p className={`text-[13px] ${failed ? "text-signal" : "text-muted"}`}>
                {failed ? `Could not load ${incidentId}.` : `Loading ${incidentId}…`}
            </p>
        </div>
    );
}
