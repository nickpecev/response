"use client";

import { useEffect, useRef } from "react";

const RAMP = " .,:-=+*x%#@";

function hash(x: number, y: number, z: number) {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t: number) {
    return t * t * (3 - 2 * t);
}

function noise3(x: number, y: number, z: number) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const u = smooth(x - xi);
    const v = smooth(y - yi);
    const w = smooth(z - zi);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz);
    return lerp(
        lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
        lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
        w,
    );
}

function fbm(x: number, y: number, z: number) {
    let total = 0;
    let amp = 0.5;
    let freq = 1;
    for (let octave = 0; octave < 4; octave++) {
        total += amp * noise3(x * freq, y * freq, z * freq);
        freq *= 2;
        amp *= 0.5;
    }
    return total / 0.9375;
}

type Sample = (col: number, row: number, cols: number, rows: number, t: number) => number;

/** A slowly turning globe: land masses from noise, a graticule, and side lighting. */
const globe: Sample = (col, row, cols, rows, t) => {
    const aspect = 0.55;
    const radius = Math.min(cols * aspect, rows) * 0.46;
    const nx = (col - cols / 2) * aspect / radius;
    const ny = (row - rows / 2) / radius;
    const d = nx * nx + ny * ny;
    if (d > 1) {
        const halo = Math.max(0, 1 - (Math.sqrt(d) - 1) * 6);
        return hash(col, row, Math.floor(t * 2)) < 0.025 ? 0.12 : halo * 0.08;
    }
    const nz = Math.sqrt(1 - d);
    const spin = t * 0.06;
    const px = nx * Math.cos(spin) + nz * Math.sin(spin);
    const pz = -nx * Math.sin(spin) + nz * Math.cos(spin);
    const light = Math.max(0, nx * -0.55 + ny * -0.35 + nz * 0.76);
    const land = fbm(px * 1.7 + 4, ny * 1.7 + 9, pz * 1.7);
    const lat = Math.asin(ny);
    const lon = Math.atan2(px, pz);
    const grid = Math.abs(Math.sin(lat * 6)) < 0.06 || Math.abs(Math.sin(lon * 6)) < 0.05;
    if (land > 0.53) return 0.35 + light * 0.65;
    return grid ? 0.18 + light * 0.12 : 0.04 + light * 0.1;
};

/** A dithered horizon: ridge line, sparse sky, density rising toward the bottom. */
const terrain: Sample = (col, row, cols, rows, t) => {
    const x = col / cols;
    const ridge = 0.42 + 0.14 * (fbm(x * 3 + t * 0.03, 1.3, 0.5) - 0.5) * 2 + 0.06 * Math.sin(x * 5.2 + 1);
    const y = row / rows;
    if (y < ridge) {
        return hash(col, row, 7) < 0.012 ? 0.15 : 0;
    }
    const depth = (y - ridge) / (1 - ridge);
    const texture = fbm(col * 0.09 + t * 0.05, row * 0.16, t * 0.02);
    return Math.min(1, 0.12 + depth * 0.55 + (texture - 0.5) * 0.7);
};

const SAMPLES = { globe, terrain };

interface AsciiFieldProps {
    variant: keyof typeof SAMPLES;
    className?: string;
    /** Character cell in CSS pixels. */
    cell?: number;
    animate?: boolean;
}

export function AsciiField({ variant, className = "", cell = 9, animate = true }: AsciiFieldProps) {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = ref.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        const sample = SAMPLES[variant];
        const still = !animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const style = getComputedStyle(canvas);
        const font = style.fontFamily;
        const ink = style.color;
        const cw = cell * 0.62;
        const ch = cell * 1.15;
        let frame = 0;
        let last = 0;
        let width = 0;
        let height = 0;

        function resize() {
            if (!canvas || !context) return;
            const rect = canvas.getBoundingClientRect();
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            width = rect.width;
            height = rect.height;
            canvas.width = Math.max(1, Math.round(width * dpr));
            canvas.height = Math.max(1, Math.round(height * dpr));
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function draw(now: number) {
            if (!context) return;
            const t = now / 1000;
            const cols = Math.floor(width / cw);
            const rows = Math.floor(height / ch);
            context.clearRect(0, 0, width, height);
            context.font = `${cell}px ${font}`;
            context.textBaseline = "top";
            context.fillStyle = ink;
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const value = sample(col, row, cols, rows, t);
                    if (value <= 0.02) continue;
                    const index = Math.min(RAMP.length - 1, Math.floor(value * RAMP.length));
                    const glyph = RAMP[index];
                    if (glyph === " ") continue;
                    context.globalAlpha = 0.45 + value * 0.55;
                    context.fillText(glyph, col * cw, row * ch);
                }
            }
            context.globalAlpha = 1;
        }

        function loop(now: number) {
            if (now - last > 80) {
                last = now;
                draw(now);
            }
            frame = requestAnimationFrame(loop);
        }

        resize();
        const watch = new ResizeObserver(() => {
            resize();
            if (still) draw(0);
        });
        watch.observe(canvas);
        if (still) draw(0);
        else frame = requestAnimationFrame(loop);

        return () => {
            cancelAnimationFrame(frame);
            watch.disconnect();
        };
    }, [variant, cell, animate]);

    return <canvas ref={ref} aria-hidden className={`block font-mono text-muted ${className}`} />;
}
