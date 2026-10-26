import type { Metadata } from "next";
import { Analytics } from "@/components/analytics/Analytics";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage() {
    return <Analytics />;
}
