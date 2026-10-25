import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
    activeIncidentId: string;
    setActiveIncidentId: (activeIncidentId: string) => void;
}

export const useApp = create<AppState>()(
    persist(
        (set) => ({
            activeIncidentId: "ian-2022",
            setActiveIncidentId: (activeIncidentId) => set({ activeIncidentId }),
        }),
        { name: "eventtruth", skipHydration: true },
    ),
);
