

import { PLAYER } from "./constants";
import { PositionedPlatform } from "./types";

/** AABB overlap tra due rettangoli. */
export function overlaps(
  aX: number,
  aY: number,
  aW: number,
  aH: number,
  bX: number,
  bY: number,
  bW: number,
  bH: number
): boolean {
  return aX < bX + bW && aX + aW > bX && aY < bY + bH && aY + aH > bY;
}

/** Verifica sovrapposizione orizzontale tra il player e una piattaforma. */
export function horizontalOverlap(playerX: number, platform: PositionedPlatform): boolean {
  return playerX + PLAYER.width > platform.x && playerX < platform.x + platform.w;
}

/**
 * Calcola la Y della superficie di uno slope in un dato X mondo.
 * upLeft: la superficie scende da sinistra a destra.
 * upRight: la superficie sale da sinistra a destra (più alta a destra).
 */
export function slopeSurfaceY(platform: PositionedPlatform, sampleX: number): number {
  const t = Math.max(0, Math.min(1, (sampleX - platform.x) / platform.w));
  if (platform.slope === "upLeft") {
    return platform.y + t * platform.h;
  }
  return platform.y + platform.h - t * platform.h;
}

/** Y della superficie di una piattaforma (slope o piatta). */
export function platformSurfaceY(platform: PositionedPlatform, sampleX: number): number {
  if (platform.kind === "slope") return slopeSurfaceY(platform, sampleX);
  return platform.y; // piccolo offset per evitare problemi di collisione con il terreno
}

/** Cerca una piattaforma per ID. */
export function findPlatform(platforms: PositionedPlatform[], id: string | null): PositionedPlatform | null {
  if (!id) return null;
  return platforms.find((p) => p.id === id) ?? null;
}
