import { ROOM, PLAYER } from "./constants";
import { getPositionedPlatforms as getMapPositionedPlatforms, MAP_SECTIONS } from "./map";
import { MapSection, PositionedPlatform } from "./types";

const LEGACY_LOCAL_SPAWNS = [
  { x: 1.1, y: ROOM.height - 0.55 - PLAYER.height },
  { x: 12.6, y: 7.85 - PLAYER.height },
  { x: 5.9, y: 8.65 - PLAYER.height },
  { x: 7.6, y: 8.45 - PLAYER.height },
  { x: 8.3, y: 8.25 - PLAYER.height },
];

export const ROOMS: MapSection[] = MAP_SECTIONS.slice().reverse().map((section, index) => {
  const localSpawn = LEGACY_LOCAL_SPAWNS[index];

  return {
    ...section,
    spawn: {
      x: localSpawn.x,
      y: section.worldYBottom - section.height + localSpawn.y,
    },
  };
});

export function getRoom(index: number): MapSection {
  return ROOMS[Math.max(0, Math.min(ROOMS.length - 1, index))];
}

export function getPositionedPlatforms(room: MapSection, timeSeconds: number): PositionedPlatform[] {
  return getMapPositionedPlatforms(room.platforms, timeSeconds);
}
