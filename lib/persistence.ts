export interface Health {
    database: boolean;
    ai: {
        configured: boolean;
        provider?: string;
        model?: string;
    };
}

export async function getHealth(): Promise<Health> {
    const response = await fetch("/api/health");
    if (!response.ok) {
        throw new Error(`${response.status} loading health`);
    }
    return response.json() as Promise<Health>;
}
