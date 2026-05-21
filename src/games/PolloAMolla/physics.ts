
import { MAP_HEIGHT, PHYSICS, PLAYER, ROOM } from "./constants";
import { getPlatformsInRange, getPositionedPlatforms, SPAWN } from "./map";
import { findPlatform, horizontalOverlap, overlaps, platformSurfaceY } from "./platforms";
import { createPlayer, resetPlayerToSpawn } from "./player";
import { JumpPlayer, PlayerInput, PositionedPlatform } from "./types";

const FALL_RESET_THRESHOLD = MAP_HEIGHT + 2;

type PreviousBody = {
  x: number;
  y: number;
  bottom: number;
  right: number;
};

function signDirection(value: number): -1 | 0 | 1 {
  if (value < -PHYSICS.inputDeadZone) return -1;
  if (value > PHYSICS.inputDeadZone) return 1;
  return 0;
}

function launch(player: JumpPlayer, direction: -1 | 0 | 1, chargeSeconds: number) {
  const ratio = Math.max(0, Math.min(1, chargeSeconds / PLAYER.maxChargeSeconds));

  player.vx = direction * PLAYER.maxHorizontalVelocity * ratio;
  player.vy = -PLAYER.maxJumpVelocity * ratio;

  player.onGround = false;
  player.isCharging = false;
  player.chargeSeconds = 0;
  player.coyoteSeconds = 0;
  player.groundPlatformId = null;
  player.jumpBufferSeconds = 0;
  player.bufferedRelease = false;
  player.bufferedChargeSeconds = 0;

  player.fallStartY = player.y;
  player.isFalling = false;

  if (direction !== 0) player.facing = direction;
}

function applyInput(player: JumpPlayer, input: PlayerInput, dt: number) {
  const jumpPressed = input.jumpHeld && !player.previousJumpHeld;
  const jumpReleased = !input.jumpHeld && player.previousJumpHeld;
  const releaseDirection = signDirection(input.moveDirectionX);
  const canStartCharge = player.onGround || player.coyoteSeconds > 0;

  if (jumpPressed) {
    if (canStartCharge) {
      player.isCharging = true;
      player.chargeSeconds = 0;
      player.vx = 0;
    } else {
      player.jumpBufferSeconds = PLAYER.jumpBufferSeconds;
      player.bufferedChargeSeconds = 0;
      player.bufferedRelease = false;
      player.bufferedDirection = releaseDirection;
    }
  }

  if (input.jumpHeld && player.isCharging) {
    player.chargeSeconds = Math.min(PLAYER.maxChargeSeconds, player.chargeSeconds + dt);
    player.vx = 0;
  }

  if (input.jumpHeld && player.jumpBufferSeconds > 0 && !player.onGround && !player.isCharging) {
    player.bufferedChargeSeconds = Math.min(PLAYER.maxChargeSeconds, player.bufferedChargeSeconds + dt);
  }

  if (jumpReleased) {
    if (player.isCharging) {
      launch(player, releaseDirection, player.chargeSeconds);
    } else if (player.jumpBufferSeconds > 0) {
      player.bufferedRelease = true;
      player.bufferedDirection = releaseDirection;
    }
  }

  if (player.onGround && !player.isCharging && input.moveDirectionX !== 0) {
    player.facing = input.moveDirectionX < 0 ? -1 : 1;
  }

  player.previousJumpHeld = input.jumpHeld;
}

function updateTimers(player: JumpPlayer, dt: number) {
  player.landedSeconds = Math.max(0, player.landedSeconds - dt);
  player.screenShakeSeconds = Math.max(0, player.screenShakeSeconds - dt);

  if (!player.onGround && player.coyoteSeconds > 0) {
    player.coyoteSeconds = Math.max(0, player.coyoteSeconds - dt);
  }

  if (player.jumpBufferSeconds > 0) {
    player.jumpBufferSeconds = Math.max(0, player.jumpBufferSeconds - dt);
    if (player.jumpBufferSeconds === 0) {
      player.bufferedRelease = false;
      player.bufferedChargeSeconds = 0;
    }
  }
}

function movingDeltaX(platform: PositionedPlatform, previousPlatforms: PositionedPlatform[]): number {
  const prev = previousPlatforms.find((p) => p.id === platform.id);
  if (!prev) return 0;
  return platform.x - prev.x;
}

function movingDeltaY(platform: PositionedPlatform, previousPlatforms: PositionedPlatform[]): number {
  const prev = previousPlatforms.find((p) => p.id === platform.id);
  if (!prev) return 0;
  return platform.y - prev.y;
}

function carryGroundedPlayer(
  player: JumpPlayer,
  platforms: PositionedPlatform[],
  previousPlatforms: PositionedPlatform[]
) {
  if (!player.onGround) return;
  const platform = findPlatform(platforms, player.groundPlatformId);
  if (!platform?.moving) return;
  player.x += movingDeltaX(platform, previousPlatforms);
  player.y += movingDeltaY(platform, previousPlatforms);
}

function resolveHorizontal(
  player: JumpPlayer,
  previous: PreviousBody,
  platforms: PositionedPlatform[]
) {
  if (player.x < 0) {
    player.x = 0;
    player.vx = 0;
  } else if (player.x + PLAYER.width > ROOM.width) {
    player.x = ROOM.width - PLAYER.width;
    player.vx = 0;
  }

  for (const platform of platforms) {
    if (platform.kind === "oneWay") continue;
    if (platform.kind === "slope") continue;

    if (!overlaps(
      player.x,
      player.y,
      PLAYER.width,
      PLAYER.height,
      platform.x,
      platform.y,
      platform.w,
      platform.h
    )) continue;

    if (previous.right <= platform.x + 0.01 && player.vx >= 0) {
      player.x = platform.x - PLAYER.width - PLAYER.wallSkin;
      player.vx = 0;
    } else if (previous.x >= platform.x + platform.w - 0.01 && player.vx <= 0) {
      player.x = platform.x + platform.w + PLAYER.wallSkin;
      player.vx = 0;
    }
  }
}

function land(player: JumpPlayer, platform: PositionedPlatform, surfaceY: number) {
  player.y = surfaceY - PLAYER.height;
  player.vy = 0;

  if (platform.kind !== "slope") player.vx = 0;

  player.onGround = true;
  player.coyoteSeconds = PLAYER.coyoteSeconds;
  player.groundPlatformId = platform.id;
  player.landedSeconds = 0.14;

  if (player.fallStartY !== null) {
    const fallDistance = player.y - player.fallStartY;
    if (fallDistance > 1.5) {
      const intensity = Math.min(0.22, fallDistance * 0.015);
      const duration = Math.min(0.5, fallDistance * 0.03);
      player.screenShakeSeconds = Math.max(player.screenShakeSeconds, duration);
      player.screenShakeIntensity = Math.max(player.screenShakeIntensity, intensity);
    }
  }
  player.fallStartY = null;
  player.isFalling = false;
}

function resolveVertical(
  player: JumpPlayer,
  previous: PreviousBody,
  platforms: PositionedPlatform[]
) {
  const centerX = player.x + PLAYER.width * 0.5;
  let landed = false;

  if (player.vy >= 0) {
    if (!player.isFalling && !player.onGround && player.vy > 0) {
      player.isFalling = true;
      if (player.fallStartY === null) player.fallStartY = player.y;
    }

    for (const platform of platforms) {
      if (!horizontalOverlap(player.x, platform)) continue;
      const surfaceY = platformSurfaceY(platform, centerX);
      const wasAbove = previous.bottom <= surfaceY + PHYSICS.topLandingTolerance;
      const crossedSurface = player.y + PLAYER.height >= surfaceY;

      if (wasAbove && crossedSurface) {
        land(player, platform, surfaceY);
        landed = true;
        break;
      }
    }
  } else {
    for (const platform of platforms) {
      if (platform.kind === "oneWay" || platform.kind === "slope") continue;
      if (!horizontalOverlap(player.x, platform)) continue;

      const underside = platform.y + platform.h;
      if (previous.y >= underside - 0.01 && player.y <= underside) {
        player.y = underside + PLAYER.wallSkin;
        player.vy = PLAYER.ceilBounceVy;
        break;
      }
    }
  }

  if (!landed && player.onGround) {
    const platform = findPlatform(platforms, player.groundPlatformId);
    if (platform && horizontalOverlap(player.x, platform)) {
      const surfaceY = platformSurfaceY(platform, centerX);
      const feetDistance = Math.abs(player.y + PLAYER.height - surfaceY);
      if (feetDistance < PHYSICS.groundedSnapDistance) {
        player.y = surfaceY - PLAYER.height;
        landed = true;
      }
    }
  }

  if (!landed && player.onGround) {
    player.onGround = false;
    player.groundPlatformId = null;
    player.coyoteSeconds = PLAYER.coyoteSeconds;
    if (player.fallStartY === null) player.fallStartY = player.y;
    player.isFalling = true;
  }
}

function applyBufferedJump(player: JumpPlayer, input: PlayerInput) {
  if (!player.onGround || player.jumpBufferSeconds <= 0) return;

  if (player.bufferedRelease) {
    launch(player, player.bufferedDirection, player.bufferedChargeSeconds);
    return;
  }

  if (input.jumpHeld) {
    player.isCharging = true;
    player.chargeSeconds = Math.max(player.chargeSeconds, player.bufferedChargeSeconds);
    player.vx = 0;
    player.jumpBufferSeconds = 0;
  }
}

function applyGroundMovement(player: JumpPlayer, input: PlayerInput) {
  if (!player.onGround || player.isCharging) return;
  player.vx = signDirection(input.moveDirectionX) * PLAYER.groundMoveSpeed;
}

function applyGravity(player: JumpPlayer, dt: number) {
  if (player.onGround) return;
  player.vy = Math.min(PLAYER.terminalVelocity, player.vy + PLAYER.gravity * dt);
}

// flying input removed

function applyWorldBounds(player: JumpPlayer) {
  if (player.y < -PLAYER.height * 2) {
    player.y = -PLAYER.height * 2;
    if (player.vy < 0) player.vy = PLAYER.ceilBounceVy;
  }

  if (player.y > FALL_RESET_THRESHOLD) {
    resetPlayerToSpawn(player);
  }
}

export function updatePlayer(
  player: JumpPlayer,
  input: PlayerInput,
  dt: number,
  timeSeconds: number
) {
  const visibleMinY = player.y - ROOM.height;
  const visibleMaxY = player.y + ROOM.height * 2;
  const nearPlatforms = getPlatformsInRange(visibleMinY, visibleMaxY);

  const platforms = getPositionedPlatforms(nearPlatforms, timeSeconds);
  const previousPlatforms = getPositionedPlatforms(nearPlatforms, Math.max(0, timeSeconds - dt));

  updateTimers(player, dt);

  // flying input removed

  applyInput(player, input, dt);
  applyBufferedJump(player, input);
  applyGroundMovement(player, input);
  carryGroundedPlayer(player, platforms, previousPlatforms);

  const previous: PreviousBody = {
    x: player.x,
    y: player.y,
    bottom: player.y + PLAYER.height,
    right: player.x + PLAYER.width,
  };

  player.x += player.vx * dt;
  resolveHorizontal(player, previous, platforms);

  applyGravity(player, dt);
  player.y += player.vy * dt;
  resolveVertical(player, previous, platforms);

  applyWorldBounds(player);
}
