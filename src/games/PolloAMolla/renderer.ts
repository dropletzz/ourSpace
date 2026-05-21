

import {
  COLORS,
  MAP_HEIGHT,
  PLAYER,
  ROOM,
  SPRITE_RENDER,
  SPRITE_SHEET,
} from "./constants";
import { Player } from "../../common";
import { chargeRatio } from "./player";
import {
  getPlatformsInRange,
  getSectionAtWorldY,
  getPositionedPlatforms,
  FLAG,
} from "./map";
import { JumpPlayer, Platform, PositionedPlatform } from "./types";

// particles removed

type View = {
  scale: number;
  offsetX: number;
  cameraY: number;
};

function worldToScreenY(worldY: number, view: View, screenH: number): number {
  return (worldY - view.cameraY) * view.scale + screenH * 0.5;
}

function worldToScreenX(worldX: number, view: View): number {
  return view.offsetX + worldX * view.scale;
}

let smoothCameraY = -1;
const CAMERA_LERP = 8;

function computeView(
  screenW: number,
  screenH: number,
  playerY: number,
  dt: number,
): View {
  const scale = Math.min(screenW / ROOM.width, screenH / ROOM.height);
  const offsetX = (screenW - ROOM.width * scale) * 0.5;
  const targetCameraY = playerY + PLAYER.height * 0.5 - (screenH / scale) * 0.4;

  if (smoothCameraY < 0) smoothCameraY = targetCameraY;
  const alpha = 1 - Math.exp(-CAMERA_LERP * dt);
  smoothCameraY += (targetCameraY - smoothCameraY) * alpha;

  return { scale, offsetX, cameraY: targetCameraY };
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  view: View,
  screenW: number,
  screenH: number,
  background: HTMLImageElement | null,
) {
  if (background) {
    const destX = view.offsetX;
    const destW = ROOM.width * view.scale;
    const destH = screenH;
    const destAspect = destW / destH;
    const cropHeight = background.width / destAspect;
    const sourceHeight = Math.min(background.height, cropHeight);
    const maxSourceY = background.height - sourceHeight;
    const viewHeightWorld = screenH / view.scale;
    const cameraBottomY = view.cameraY + viewHeightWorld * 0.5;
    const lookAheadOffset = viewHeightWorld * 0.4;
    const bottomY = Math.max(
      viewHeightWorld,
      Math.min(MAP_HEIGHT, cameraBottomY + lookAheadOffset),
    );
    const scrollRange = Math.max(1, MAP_HEIGHT - viewHeightWorld);
    const progress = (bottomY - viewHeightWorld) / scrollRange;
    const sourceY = maxSourceY * progress;

    ctx.drawImage(
      background,
      0,
      sourceY,
      background.width,
      sourceHeight,
      destX,
      0,
      destW,
      destH,
    );
    ctx.fillStyle = "rgba(5, 7, 12, 0.12)";
    ctx.fillRect(0, 0, screenW, screenH);
    return;
  }

  const section = getSectionAtWorldY(view.cameraY + ROOM.height * 0.5);

  const gradient = ctx.createLinearGradient(0, 0, 0, screenH);
  gradient.addColorStop(0, section.colors.top);
  gradient.addColorStop(1, section.colors.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, screenW, screenH);

  ctx.fillStyle = "rgba(255, 255, 255, 0.045)";
  const camOffset = view.cameraY * 0.15;
  for (let i = 0; i < 10; i++) {
    const wx = ((i * 3.3 + camOffset * 0.1) % (ROOM.width + 3)) - 1.5;
    const wy = (i * 2.7 + camOffset * 0.05) % (MAP_HEIGHT * 0.5);
    const sx = view.offsetX + wx * view.scale;
    const sy = worldToScreenY(wy, view, screenH);
    ctx.fillRect(sx, sy, 1.4 * view.scale, 0.09 * view.scale);
  }
}

function platformColor(platform: Platform): { body: string; top: string } {
  if (platform.moving) return { body: COLORS.moving, top: COLORS.movingTop };
  if (platform.kind === "oneWay")
    return { body: COLORS.oneWay, top: COLORS.oneWayTop };
  return { body: COLORS.stone, top: COLORS.stoneTop };
}

function drawSlope(
  ctx: CanvasRenderingContext2D,
  view: View,
  platform: PositionedPlatform,
  screenH: number,
) {
  const x = worldToScreenX(platform.x, view);
  const y = worldToScreenY(platform.y, view, screenH);
  const w = platform.w * view.scale;
  const h = platform.h * view.scale;

  ctx.beginPath();
  if (platform.slope === "upLeft") {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
  } else {
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
  }
  ctx.closePath();
  ctx.fillStyle = COLORS.slope;
  ctx.fill();
  ctx.strokeStyle = COLORS.slopeTop;
  ctx.lineWidth = Math.max(2, view.scale * 0.05);
  ctx.stroke();
}

function drawPlatform(
  ctx: CanvasRenderingContext2D,
  view: View,
  platform: PositionedPlatform,
  screenH: number,
) {
  if (platform.kind === "slope") {
    drawSlope(ctx, view, platform, screenH);
    return;
  }

  const sx = worldToScreenX(platform.x, view);
  const sy = worldToScreenY(platform.y, view, screenH);
  const sw = platform.w * view.scale;
  const sh = platform.h * view.scale;
  const color = platformColor(platform);

  ctx.fillStyle = COLORS.shadow;
  ctx.fillRect(sx + 0.05 * view.scale, sy + 0.08 * view.scale, sw, sh);
  ctx.fillStyle = color.body;
  ctx.fillRect(sx, sy, sw, sh);
  ctx.fillStyle = color.top;
  ctx.fillRect(sx, sy, sw, Math.min(sh, 0.08 * view.scale));
}

function drawFlag(
  ctx: CanvasRenderingContext2D,
  view: View,
  screenH: number,
) {
  const poleW = Math.max(2, Math.round(view.scale * 0.08));
  const sx = worldToScreenX(FLAG.x, view);
  const sy = worldToScreenY(FLAG.y, view, screenH);
  const sw = FLAG.w * view.scale;
  const sh = FLAG.h * view.scale;

  ctx.fillStyle = "#2a2a2a";
  ctx.fillRect(sx, sy, poleW, sh);

  ctx.fillStyle = "#e24b4b";
  ctx.beginPath();
  ctx.moveTo(sx + poleW, sy + sh * 0.1);
  ctx.lineTo(sx + sw, sy + sh * 0.35);
  ctx.lineTo(sx + poleW, sy + sh * 0.6);
  ctx.closePath();
  ctx.fill();
}

function spriteFrame(player: JumpPlayer) {
  if (player.isCharging) return SPRITE_SHEET.frames.charge;
  if (!player.onGround) return SPRITE_SHEET.frames.airborne;
  if (player.landedSeconds > 0) return SPRITE_SHEET.frames.land;
  return SPRITE_SHEET.frames.idle;
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  view: View,
  player: JumpPlayer,
  sprite: HTMLImageElement | null,
  isMe: boolean,
  screenH: number,
) {
  const sx = worldToScreenX(player.x, view);
  const sy = worldToScreenY(player.y, view, screenH);

  if (!sprite) {
    ctx.fillStyle = isMe ? "#f4f0d9" : "#d6bd6a";
    ctx.fillRect(sx, sy, PLAYER.width * view.scale, PLAYER.height * view.scale);
    return;
  }

  const frame = spriteFrame(player);
  const dw = PLAYER.width * view.scale * SPRITE_RENDER.scaleX;
  const dh = PLAYER.height * view.scale * SPRITE_RENDER.scaleY;
  const dx = sx - (dw - PLAYER.width * view.scale) * SPRITE_RENDER.pivotX;
  const dy = sy - (dh - PLAYER.height * view.scale) * SPRITE_RENDER.pivotY;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  if (player.facing < 0) {
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite, frame.x, frame.y, frame.w, frame.h, 0, 0, dw, dh);
  } else {
    ctx.drawImage(sprite, frame.x, frame.y, frame.w, frame.h, dx, dy, dw, dh);
  }
  ctx.restore();

  if (isMe && player.isCharging) {
    const ratio = chargeRatio(player);
    const meterW = PLAYER.width * view.scale * 1.3;
    const meterH = Math.max(5, view.scale * 0.09);
    const meterX = sx + (PLAYER.width * view.scale - meterW) * 0.5;
    const meterY = sy - 0.32 * view.scale;

    ctx.fillStyle = COLORS.chargeBack;
    const r = meterH * 0.5;
    ctx.beginPath();
    ctx.roundRect(meterX, meterY, meterW, meterH, r);
    ctx.fill();

    const hue = 50 - ratio * 40;
    ctx.fillStyle = `hsl(${hue}, 95%, 58%)`;
    ctx.beginPath();
    ctx.roundRect(meterX, meterY, meterW * ratio, meterH, r);
    ctx.fill();

    if (ratio >= 1) {
      ctx.fillStyle = `rgba(255,200,50,${0.3 + Math.sin(Date.now() * 0.015) * 0.2})`;
      ctx.beginPath();
      ctx.roundRect(meterX, meterY, meterW, meterH, r);
      ctx.fill();
    }
  }
}

function drawPlayerName(
  ctx: CanvasRenderingContext2D,
  view: View,
  player: JumpPlayer,
  screenH: number,
  name: string,
) {
  const sx = worldToScreenX(player.x + PLAYER.width * 0.5, view);
  const sy = worldToScreenY(player.y, view, screenH);
  const fontSize = Math.max(12, Math.min(18, view.scale * 0.18));
  const padding = Math.ceil(fontSize * 0.35);
  const nameLift = Math.max(4, view.scale * 0.38);
  const nameY = sy - fontSize - padding - nameLift;

  ctx.save();
  ctx.font = `${fontSize}px Arial`;
  const textWidth = ctx.measureText(name).width;
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(
    sx - textWidth * 0.5 - padding,
    nameY - padding * 0.5,
    textWidth + padding * 2,
    fontSize + padding,
  );
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = COLORS.text;
  ctx.fillText(name, sx, nameY);
  ctx.restore();
}

// particles drawing removed

function drawHud(
  ctx: CanvasRenderingContext2D,
  screenW: number,
  screenH: number,
  playerY: number,
  started: boolean,
) {
  const progress = Math.max(0, Math.min(1, 1 - playerY / MAP_HEIGHT));
  const barH = screenH * 0.4;
  const barW = 6;
  const barX = screenW - 18;
  const barY = screenH * 0.3;

  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = COLORS.charge;
  ctx.fillRect(barX, barY + barH * (1 - progress), barW, barH * progress);

  const section = getSectionAtWorldY(playerY);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = COLORS.text;
  ctx.font = "16px monospace";
  ctx.fillText(section.name, screenW * 0.5, 12);

  if (!started) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
    ctx.fillRect(0, 0, screenW, screenH);
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 48px monospace";
    ctx.fillText("POLLO A MOLLA", screenW * 0.5, screenH * 0.34);
    ctx.font = "20px monospace";
    ctx.fillStyle = "rgba(244,240,217,0.7)";
    ctx.fillText(
      "tieni SALTO per caricare • rilascia per saltare",
      screenW * 0.5,
      screenH * 0.34 + 64,
    );
  }
}

function drawVictoryOverlay(
  ctx: CanvasRenderingContext2D,
  screenW: number,
  screenH: number,
  winnerName: string,
  sprite: HTMLImageElement | null,
) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.fillRect(0, 0, screenW, screenH);

  ctx.fillStyle = COLORS.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 42px monospace";
  ctx.fillText(`HA VINTO: ${winnerName}`, screenW * 0.5, screenH * 0.32);

  if (sprite) {
    const frame = SPRITE_SHEET.frames.win;
    const size = Math.min(screenW, screenH) * 0.28;
    const dx = screenW * 0.5 - size * 0.5;
    const dy = screenH * 0.42;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, frame.x, frame.y, frame.w, frame.h, dx, dy, size, size);
    ctx.restore();
  }
}

export function drawGame(
  ctx: CanvasRenderingContext2D,
  screenW: number,
  screenH: number,
  players: Record<string, JumpPlayer>,
  lobbyPlayers: Record<string, Player>,
  myId: string,
  sprite: HTMLImageElement | null,
  background: HTMLImageElement | null,
  dt: number,
  timeSeconds: number,
  started: boolean,
  gameOver: boolean,
  winnerId: string | null,
  winSecondsRemaining: number,
) {
  const me = players[myId];
  if (!me) return;

  // particles removed

  const view = computeView(screenW, screenH, me.y, dt);

  let shakeOffsetX = 0;
  let shakeOffsetY = 0;
  if (me.screenShakeSeconds > 0) {
    const intensity =
      me.screenShakeIntensity * view.scale * (me.screenShakeSeconds * 4);
    shakeOffsetX = (Math.random() - 0.5) * intensity;
    shakeOffsetY = (Math.random() - 0.5) * intensity;
    ctx.save();
    ctx.translate(shakeOffsetX, shakeOffsetY);
  }

  ctx.fillStyle = COLORS.void;
  ctx.fillRect(0, 0, screenW, screenH);
  drawBackground(ctx, view, screenW, screenH, background);

  const visibleMinY = view.cameraY - ROOM.height;
  const visibleMaxY = view.cameraY + ROOM.height * 2;
  const nearPlatforms = getPlatformsInRange(visibleMinY, visibleMaxY);
  const positionedPlatforms = getPositionedPlatforms(
    nearPlatforms,
    timeSeconds,
  );

  for (const platform of positionedPlatforms) {
    drawPlatform(ctx, view, platform, screenH);
  }

  drawFlag(ctx, view, screenH);

  for (const [id, player] of Object.entries(players)) {
    const screenY = worldToScreenY(player.y, view, screenH);
    if (screenY > -100 && screenY < screenH + 100) {
      drawPlayer(ctx, view, player, sprite, id === myId, screenH);
      const lobbyPlayer = lobbyPlayers[id];
      drawPlayerName(ctx, view, player, screenH, lobbyPlayer.name);
    }
  }

  // particles removed

  if (me.screenShakeSeconds > 0) {
    ctx.restore();
  }

  drawHud(ctx, screenW, screenH, me.y, started);

  if (gameOver && winnerId) {
    const winnerName = lobbyPlayers[winnerId]?.name ?? "Giocatore";
    drawVictoryOverlay(ctx, screenW, screenH, winnerName, sprite);
  }
}
