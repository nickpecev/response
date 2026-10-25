export function GET() {
    const configured = Boolean(process.env.ANTHROPIC_API_KEY);

    return Response.json({
        database: Boolean(process.env.DATABASE_URL),
        ai: {
            configured,
            provider: configured ? "anthropic" : undefined,
            model: configured ? process.env.ANTHROPIC_MODEL ?? "claude" : undefined,
        },
    });
}
