
import { MAP_HEIGHT, PLAYER, ROOM } from "./constants";
import { MapSection, Platform, PositionedPlatform } from "./types";


const BASE_Y = MAP_HEIGHT - ROOM.height;
const SECTION0_LIFT = 4.25;

const section0: MapSection = {
  id: 0,
  name: "Kitchen Floor",
  worldYBottom: MAP_HEIGHT,
  height: ROOM.height,
  colors: { top: "#344354", bottom: "#727a6a" },
  platforms: [
    { id: "s0-ground", x: 0, y: BASE_Y + 8.45 - SECTION0_LIFT, w: 16, h: 0.55, kind: "solid" },
    { id: "s0-step-a", x: 3.0, y: BASE_Y + 7.25 - SECTION0_LIFT, w: 2.3, h: 0.28, kind: "solid" },
    { id: "s0-step-b", x: 6.5, y: BASE_Y + 6.25 - SECTION0_LIFT, w: 2.1, h: 0.25, kind: "oneWay" },
    { id: "s0-slope", x: 10.0, y: BASE_Y + 6.95 - SECTION0_LIFT, w: 2.1, h: 0.9, kind: "slope", slope: "upRight" },
    { id: "s0-exit", x: 12.75, y: BASE_Y + 5.15 - SECTION0_LIFT, w: 2.0, h: 0.28, kind: "oneWay" },
  ],
};


const S1_Y = BASE_Y - ROOM.height; 

const section1: MapSection = {
  id: 1,
  name: "Shelf Gap",
  worldYBottom: BASE_Y,
  height: ROOM.height,
  colors: { top: "#263041", bottom: "#615b51" },
  platforms: [
    { id: "s1-catch", x: 11.7, y: S1_Y + 7.85, w: 3, h: 0.28, kind: "oneWay" },
    { id: "s1-left", x: 7.8, y: S1_Y + 6.55, w: 2.1, h: 0.28, kind: "solid" },
    { id: "s1-slope", x: 4.8, y: S1_Y + 5.75, w: 1.9, h: 0.75, kind: "slope", slope: "upLeft" },
    { id: "s1-nub", x: 1.2, y: S1_Y + 4.25, w: 1.6, h: 0.3, kind: "solid" },
    { id: "s1-top", x: 5.9, y: S1_Y + 2.55, w: 2.45, h: 0.28, kind: "oneWay" },
  ],
};

const S2_Y = S1_Y - ROOM.height; // 18

const section2: MapSection = {
  id: 2,
  name: "Moving Counter",
  worldYBottom: S1_Y,
  height: ROOM.height,
  colors: { top: "#283847", bottom: "#536958" },
  platforms: [
    { id: "s2-fallback", x: 4.4, y: S2_Y + 8.65, w: 4.0, h: 0.25, kind: "oneWay" },
    { id: "s2-left", x: 1.0, y: S2_Y + 6.65, w: 2.0, h: 0.3, kind: "solid" },
    {
      id: "s2-moving",
      x: 5.65,
      y: S2_Y + 5.15,
      w: 2.0,
      h: 0.28,
      kind: "solid",
      moving: { axis: "x", distance: 4.2, seconds: 3.6, phase: 0.2 },
    },
    { id: "s2-right", x: 12.2, y: S2_Y + 4.0, w: 2.2, h: 0.3, kind: "solid" },
    { id: "s2-top", x: 7.6, y: S2_Y + 2.15, w: 1.85, h: 0.28, kind: "oneWay" },
  ],
};


const S3_Y = S2_Y - ROOM.height; // 9

const section3: MapSection = {
  id: 3,
  name: "Narrow Pantry",
  worldYBottom: S2_Y,
  height: ROOM.height,
  colors: { top: "#222a3a", bottom: "#554b47" },
  platforms: [
    { id: "s3-catch", x: 6.9, y: S3_Y + 8.45, w: 2.4, h: 0.28, kind: "oneWay" },
    { id: "s3-a", x: 11.2, y: S3_Y + 6.15, w: 1.65, h: 0.28, kind: "oneWay" },
    { id: "s3-b", x: 6.65, y: S3_Y + 4.75, w: 1.55, h: 0.28, kind: "solid" },
    { id: "s3-c", x: 2.9, y: S3_Y + 3.35, w: 1.5, h: 0.28, kind: "oneWay" },
    { id: "s3-slope", x: 8.5, y: S3_Y + 2.15, w: 2.1, h: 0.85, kind: "slope", slope: "upRight" },
  ],
};



const S4_Y = S3_Y - ROOM.height; // 0

const section4: MapSection = {
  id: 4,
  name: "Crown Ledge",
  worldYBottom: S4_Y,
  height: ROOM.height,
  colors: { top: "#1f2636", bottom: "#46585d" },
  platforms: [
    { id: "s4-entry", x: 7.4, y: S4_Y + 8.25, w: 2.4, h: 0.28, kind: "oneWay" },
    { id: "s4-left", x: 3.2, y: S4_Y  + 6.9, w: 1.7, h: 0.3, kind: "solid" },
    { id: "s4-right", x: 11.4, y: S4_Y  + 5.65, w: 1.65, h: 0.3, kind: "solid" },
    { id: "s4-mid", x: 6.9, y: S4_Y  + 4.2, w: 2.0, h: 0.28, kind: "oneWay" },
    { id: "s4-crown", x: 5.2, y: S4_Y  + 1.35, w: 5.6, h: 0.34, kind: "oneWay" },
  ],
};

const S5_Y = S4_Y - ROOM.height; // -9

const section5: MapSection = {
  id: 5,
  name: "Crown Ledge",
  worldYBottom: S5_Y,
  height: ROOM.height,
  colors: { top: "#1f2636", bottom: "#46585d" },
  platforms: [
    { id: "s5-entry", x: 1.4, y: S5_Y + 8.35, w: 2.4, h: 0.26, kind: "oneWay" },
    { id: "s5-left", x: 4.6, y: S5_Y + 6.95, w: 2.2, h: 0.26, kind: "solid" },
    { id: "s5-right", x: 9.6, y: S5_Y + 5.75, w: 2.2, h: 0.26, kind: "solid" },
    { id: "s5-mid", x: 6.6, y: S5_Y + 4.15, w: 2.3, h: 0.26, kind: "oneWay" },
    { id: "s5-crown", x: 3.6, y: S5_Y + 2.05, w: 3.0, h: 0.28, kind: "solid" },
  ],
};

const S6_Y = S5_Y - ROOM.height; // -18

const section6: MapSection = {
  id: 6,
  name: "Crown Ledge",
  worldYBottom: S6_Y,
  height: ROOM.height,
  colors: { top: "#1f2636", bottom: "#46585d" },
  platforms: [
    { id: "s6-entry", x: 9.2, y: S6_Y + 8.1, w: 2.2, h: 0.26, kind: "oneWay" },
    { id: "s6-left", x: 2.6, y: S6_Y + 6.95, w: 2.2, h: 0.26, kind: "solid" },
    { id: "s6-right", x: 8.8, y: S6_Y + 5.85, w: 2.0, h: 0.26, kind: "solid" },
    { id: "s6-mid", x: 5.8, y: S6_Y + 3.25, w: 2.1, h: 0.26, kind: "oneWay" },
    { id: "s6-crown", x: 10.4, y: S6_Y + 2.25, w: 2.2, h: 0.28, kind: "solid" },
  ],
};

const S7_Y = S6_Y - ROOM.height; // -27

const section7: MapSection = {
  id: 7,
  name: "Crown Ledge",
  worldYBottom: S7_Y,
  height: ROOM.height,
  colors: { top: "#1f2636", bottom: "#46585d" },
  platforms: [
    { id: "s7-entry", x: 3.4, y: S7_Y + 9.1, w: 2.4, h: 0.26, kind: "oneWay" },
    { id: "s7-left", x: 9.6, y: S7_Y + 7.05, w: 2.2, h: 0.26, kind: "solid" },
    { id: "s7-right", x: 5.2, y: S7_Y + 4.85, w: 2.0, h: 0.26, kind: "solid" },
    { id: "s7-mid", x: 10.6, y: S7_Y + 4.35, w: 0.06, h: 0.36, kind: "solid" },
    { id: "s7-crown", x: 3.4, y: S7_Y + 2.25, w: 3.0, h: 0.28, kind: "solid" },
  ],
};

const FLAG_W = 0.7;
const FLAG_H = 1.4;
const flagPlatform = section7.platforms.find((p) => p.id === "s7-crown") ?? section7.platforms[section7.platforms.length - 1];

export const FLAG = {
  x: flagPlatform.x + flagPlatform.w * 0.5 - FLAG_W * 0.5,
  y: flagPlatform.y - FLAG_H,
  w: FLAG_W,
  h: FLAG_H,
};

export const MAP_SECTIONS: MapSection[] = [
  section7,
  section6,
  section5,
  section4,
  section3,
  section2,
  section1,
  section0,
];

export const ALL_PLATFORMS: Platform[] = MAP_SECTIONS.flatMap((s) => s.platforms);

export const SPAWN = {
  x: 1.1,
  y: BASE_Y + 8.45 - SECTION0_LIFT - PLAYER.height,
};

export function getPositionedPlatforms(platforms: Platform[], timeSeconds: number): PositionedPlatform[] {
  return platforms.map((platform) => {
    const positioned: PositionedPlatform = {
      ...platform,
      baseX: platform.x,
      baseY: platform.y,
    };

    if (!platform.moving) return positioned;

    const { axis, distance, seconds, phase = 0 } = platform.moving;
    const cycle = (timeSeconds / seconds + phase) * Math.PI * 2;
    const offset = Math.sin(cycle) * distance * 0.5;

    if (axis === "x") positioned.x = platform.x + offset;
    else positioned.y = platform.y + offset;

    return positioned;
  });
}

export function getSectionAtWorldY(worldY: number): MapSection {
  for (const section of MAP_SECTIONS) {
    const top = section.worldYBottom - section.height;
    if (worldY >= top && worldY <= section.worldYBottom) return section;
  }
  if (worldY < MAP_SECTIONS[0].worldYBottom - MAP_SECTIONS[0].height) return MAP_SECTIONS[0];
  return MAP_SECTIONS[MAP_SECTIONS.length - 1];
}

export function getPlatformsInRange(minY: number, maxY: number): Platform[] {
  const margin = 2;
  return ALL_PLATFORMS.filter((p) => p.y + p.h >= minY - margin && p.y <= maxY + margin);
}
