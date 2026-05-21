

import { PLAYER } from "./constants";
import { SPAWN } from "./map";
import { JumpPlayer } from "./types";

export function createPlayer(spawnX: number = SPAWN.x, spawnY: number = SPAWN.y): JumpPlayer {
  return {
    x: spawnX,
    y: spawnY,
    vx: 0,
    vy: 0,
    onGround: true,
    facing: 1,
    isCharging: false,
    chargeSeconds: 0,
    coyoteSeconds: PLAYER.coyoteSeconds,
    jumpBufferSeconds: 0,
    bufferedChargeSeconds: 0,
    bufferedRelease: false,
    bufferedDirection: 0,
    previousJumpHeld: false,
    groundPlatformId: null,
    landedSeconds: 0,
    fallStartY: null,
    isFalling: false,
    screenShakeSeconds: 0,
    screenShakeIntensity: 0,
  };
}

/** Resetta il giocatore allo spawn iniziale (caduta fuori dalla mappa). */
export function resetPlayerToSpawn(player: JumpPlayer) {
  const p = createPlayer();
  Object.assign(player, p);
  player.landedSeconds = 0.25;
  player.screenShakeSeconds = 0.45;
  player.screenShakeIntensity = 0.18;
}

export function chargeRatio(player: JumpPlayer): number {
  return Math.max(0, Math.min(1, player.chargeSeconds / PLAYER.maxChargeSeconds));
}
