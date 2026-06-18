export const TICK_FREQUENCY = 60; // ticks per second
export const EPSILON = 0.0001;

export type Player = {
    name: string;
    character: string;
}

export type Rectangle = {
    x: number; // x position of the top left corner
    y: number; // y position of the top left corner
    w: number; // width
    h: number; // height
}

export function mod(n: number, m: number): number {
    return ((n % m) + m) % m;
}

export function smoothChange(from: number, to: number, dt: number, halfLife: number): number {
    return to + (from - to) * Math.pow(2, -dt / halfLife)
}

export type Point2d = { x: number; y: number };

export function rotate2d(x: number, y: number, cx: number, cy: number, angleInRadians: number): Point2d {
    const cos = Math.cos(angleInRadians);
    const sin = Math.sin(angleInRadians);
    const nx = x - cx, ny = y - cy;
    return {
        x: cx + (nx*cos - ny*sin),
        y: cy + (nx*sin + ny*cos),
    }
}

export function rotate2dP(point: Point2d, center: Point2d, angleInRadians: number): Point2d {
    return rotate2d(point.x, point.y, center.x, center.y, angleInRadians);
}

export type CollisionSide = "top" | "bottom" | "left" | "right" | "none";

export function getCollisionSide(rect1: Rectangle, rect2: Rectangle): CollisionSide {
    const overlapLeft = (rect1.x + rect1.w) - rect2.x;
    const overlapRight = (rect2.x + rect2.w) - rect1.x;
    const overlapTop = (rect1.y + rect1.h) - rect2.y;
    const overlapBottom = (rect2.y + rect2.h) - rect1.y;

    if (overlapLeft <= 0 || overlapRight <= 0 || overlapTop <= 0 || overlapBottom <= 0) {
        return "none";
    }

    const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

    if (minOverlap === overlapTop) return "top";
    if (minOverlap === overlapBottom) return "bottom";
    if (minOverlap === overlapLeft) return "left";
    if (minOverlap === overlapRight) return "right";

    return "none";
}
