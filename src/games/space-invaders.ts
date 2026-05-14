import { IncomingMsg, OutgoingMsg } from '../server';
import { GameServer, GameClient } from './game';
import { UserInput } from '../client/user-input';

/*
  Space Invaders - Server/Client split (simple, predictable enemy patterns)
  Server: SpaceServer extends GameServer - authoritative state, tick()
  Client: SpaceClient extends GameClient - local input, draw(), flushMessages()

  This file focuses on: Player heat/shield logic, Projectile handling, and
  three enemy behaviours: Pendulum, Jumper, Diver.
*/

// World & entity constants (normalized coordinates: -1..1)
const PLAYER_W = 0.12;
const PLAYER_H = 0.06;
const PLAYER_SPEED = 1.6; // units/sec for local smoothing

const PROJ_W = 0.01;
const PROJ_H = 0.03;
const PLAYER_PROJECTILE_SPEED = -1.8; // negative = up
// Base enemy projectile speed; will be scaled by `difficulty` per wave
const ENEMY_PROJECTILE_SPEED = 1.9;

// Make sustained firing slightly more costly for players (harder to spam)
const HEAT_PER_SHOT = 12;
// Increase dissipation so players recover heat faster between bursts
const HEAT_DISSIPATION_RATE = 22; // units/sec
// Shorter overheat penalty so gameplay feels snappier
const OVERHEAT_DURATION_MS = 1500;
// Shrink shields a bit and increase cooldown to make them less dominant
const SHIELD_DURATION_MS = 900;
// Reduced cooldown so shields are more usable during play
const SHIELD_COOLDOWN_MS = 3000;

// Maximum number of active players allowed in a game instance
const MAX_ACTIVE_PLAYERS = 2;

type EnemyType = 'PENDULUM' | 'JUMPER' | 'DIVER';

type ProjectileState = {
  x: number; y: number; vx: number; vy: number; w: number; h: number; owner: 'player' | 'enemy'; ownerId?: string; alive?: boolean;
}

type EnemyState = {
  id: number;
  type: EnemyType;
  x: number; y: number; w: number; h: number; vx?: number; vy?: number;
  // pendulum
  baseY?: number; amplitude?: number; frequency?: number; phase?: number; lastPeakFireAt?: number;
  // jumper
  lastJumpAt?: number; direction?: number; jumpIntervalMs?: number;
  // diver
  idleStartAt?: number; diving?: boolean; diveStartDelayMs?: number; diveSpeed?: number; visible?: boolean; lastBlinkAt?: number; blinkMs?: number;
  hp?: number;
  alive?: boolean;
}

type PlayerRuntimeState = {
  heat: number;
  isOverheated: boolean;
  overheatedUntil: number;
  lastShotAt: number;
  shieldExpiresAt: number;
  shieldCooldownUntil: number;
  // powerups, not fully implemented here but reserved
  powerups?: Record<string, number>;
}

function aabbCollision(a: {x:number;y:number;w:number;h:number}, b: {x:number;y:number;w:number;h:number}){
  return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
}

// Linear interpolation helper for smoothing positions
function lerp(a: number, b: number, t: number){
  return a + (b - a) * t;
}

/* =====================
   SpaceServer
   ===================== */
export class SpaceServer extends GameServer {
  private players: Record<string, any> = {};
  private playerState: Record<string, PlayerRuntimeState> = {};
  private projectiles: ProjectileState[] = [];
  private enemies: EnemyState[] = [];
  private respawnQueue: { type?: EnemyType; respawnAt: number }[] = [];
  private nextEnemyId: number = 1;
  private waveNumber: number = 1;
  // Increase starting lives per request
  private lives: number = 5;
  private teamScore: number = 0;
  // Track which player IDs are active in the current game (others are spectators)
  private activePlayerIds: Set<string> = new Set();

  init(players) {
    this.players = players;
    this.projectiles = [];
    this.enemies = [];
    // start with 5 lives per request
    this.lives = 5;
    this.teamScore = 0;

    // Initialize player positions and runtime state for up to MAX_ACTIVE_PLAYERS.
    // Additional connected clients are marked as spectators and kept out of
    // authoritative gameplay (they won't affect physics or receive input handling).
    this.activePlayerIds = new Set();
    const ids = Object.keys(players || {});
    let assigned = 0;
    for (const id of ids) {
      const p = players[id];
      if (assigned < MAX_ACTIVE_PLAYERS) {
        // active player
        this.activePlayerIds.add(id);
        p.x = (assigned % 2 === 0) ? -0.4 : 0.4; // left / right start
        p.y = 0.9; // bottom area
        p.w = PLAYER_W; p.h = PLAYER_H;
        p.color = (assigned % 2 === 0) ? '#88ff88' : '#88ccff';
        p.score = 0;
        this.playerState[id] = {
          heat: 0,
          isOverheated: false,
          overheatedUntil: 0,
          lastShotAt: 0,
          shieldExpiresAt: 0,
          shieldCooldownUntil: 0,
          powerups: {}
        };
        p.isSpectator = false;
        assigned += 1;
      } else {
        // spectator: mark and move off-screen so client won't draw them inside the playfield
        p.isSpectator = true;
        p.x = 0; p.y = 2; p.w = PLAYER_W; p.h = PLAYER_H;
        p.color = '#666666';
        p.score = p.score || 0;
      }
    }

      // spawn an initial wave (types chosen randomly)
      this.waveNumber = 1;
      this.spawnInitialWave(3, 7);
  }

    private spawnInitialWave(rows: number, cols: number){
      // increase wave density slowly as waves progress
      // increase density slightly faster so more enemies appear throughout the game
      const extra = Math.floor((this.waveNumber - 1) / 1);
      const actualRows = Math.min(8, rows + extra + 1);
      const actualCols = Math.min(12, cols + extra + 1);
      const startX = -0.9;
      const spacingX = 1.8 / Math.max(6, actualCols - 1);
      const startY = -0.8;
      const spacingY = 0.14;

      const difficulty = Math.pow(1.18, Math.max(0, this.waveNumber - 1));
      const baseHp = 1 + Math.floor((this.waveNumber - 1) / 2);

      for(let r=0;r<actualRows;r++){
        for(let c=0;c<actualCols;c++){
          const type = this.randomEnemyType();

          const ex = startX + c * spacingX + (Math.random()*0.02 - 0.01);
          const ey = startY + r * spacingY + (Math.random()*0.02 - 0.01);
          const e: EnemyState = {
            id: this.nextEnemyId++,
            type,
            x: ex,
            y: ey,
            w: 0.10,
            h: 0.06,
            hp: baseHp,
            alive: true
          };

          if (type === 'PENDULUM'){
            e.vx = (0.25 + Math.random()*0.2) * (Math.random() < 0.5 ? 1 : -1) * difficulty;
            e.baseY = ey;
            e.amplitude = (0.08 + Math.random()*0.06) * (1 + 0.08*(this.waveNumber-1));
            e.frequency = (2 + Math.random()*2) * (1 + 0.06*(this.waveNumber-1));
            e.phase = Math.random()*Math.PI*2;
            e.lastPeakFireAt = 0;
          } else if (type === 'JUMPER'){
            e.jumpIntervalMs = Math.max(350, Math.floor(1200 / difficulty) + Math.floor(Math.random()*400));
            e.lastJumpAt = Date.now() + Math.random()*e.jumpIntervalMs;
            e.direction = Math.random() < 0.5 ? -1 : 1;
          } else if (type === 'DIVER'){
            e.diving = false;
            e.idleStartAt = 0;
            e.diveStartDelayMs = Math.max(600, Math.floor(2200 / difficulty) + Math.floor(Math.random()*800));
            e.blinkMs = 150 + Math.floor(Math.random()*200);
            e.lastBlinkAt = Date.now();
            e.visible = true;
            e.diveSpeed = (3.2 + Math.random()*1.6) * difficulty;
          }

          this.enemies.push(e);
        }
      }
    }

  tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
    const now = Date.now();

    // Process incoming messages
    incomingMessages.forEach(m => {
      const id = m.clientId;
      const payload = m.payload;
      const p = this.players[id];
      if (!p) return;
      // ignore inputs from spectators
      if (p.isSpectator) return;

      if (payload.kind === 'move'){
        // authoritative player x from client
        this.players[id].x = Math.max(-1, Math.min(1 - PLAYER_W, payload.x));
      } else if (payload.kind === 'fire'){
        this.handleFire(id, now);
      } else if (payload.kind === 'shield'){
        this.handleShield(id, now);
      }
    });

    // Update player runtime state (heat dissipation & overheated recovery)
    Object.keys(this.players).forEach(id => {
      const st = this.playerState[id];
      if (!st) return;
      // if last shot not recent, dissipate heat
      const firingRecently = (now - st.lastShotAt) < 250;
      if (!firingRecently) st.heat = Math.max(0, st.heat - HEAT_DISSIPATION_RATE * dt);
      if (st.isOverheated && now >= st.overheatedUntil){
        st.isOverheated = false;
        st.heat = Math.min(100, 60);
      }
    });

    // Update enemies
    this.updateEnemies(dt, now);

    // Update projectiles (move)
    for (const pr of this.projectiles) {
      if (!pr.alive) continue;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
    }

    // Collision detection with swept AABB to prevent fast projectiles from
    // passing through thin enemies between ticks. This keeps logic simple
    // and follows the same straightforward style used in multi-pong.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      if (!pr.alive) continue;

      const prevX = pr.x - pr.vx * dt;
      const prevY = pr.y - pr.vy * dt;
      const left = Math.min(prevX - pr.w/2, pr.x - pr.w/2);
      const top = Math.min(prevY - pr.h/2, pr.y - pr.h/2);
      const right = Math.max(prevX + pr.w/2, pr.x + pr.w/2);
      const bottom = Math.max(prevY + pr.h/2, pr.y + pr.h/2);
      const swept = { x: left, y: top, w: right - left, h: bottom - top };

      if (pr.owner === 'player') {
        for (let j = this.enemies.length - 1; j >= 0; j--) {
          const en = this.enemies[j];
          if (!en.alive) continue;
          if (aabbCollision(swept, { x: en.x, y: en.y, w: en.w, h: en.h })) {
            pr.alive = false;
            // decrement enemy HP; only kill when hp <= 0 (makes enemies require multiple hits)
            en.hp = (en.hp || 1) - 1;
            if (en.hp <= 0) {
              en.alive = false;
              // award score to shooter if known (per-player stat)
              if ((pr as any).ownerId && this.players[(pr as any).ownerId]) {
                const shooter = this.players[(pr as any).ownerId];
                shooter.score = (shooter.score || 0) + 1;
              }
              // increment common/team score
              this.teamScore += 1;
              // schedule a respawn (type chosen randomly at respawn time) — respawn faster on later waves
              const respawnDelay = Math.max(700, 1500 - (this.waveNumber - 1) * 150) + Math.floor(Math.random() * 1400);
              this.respawnQueue.push({ respawnAt: now + respawnDelay });
            }
            break;
          }
        }
      } else {
        // enemy projectile -> players & shields
        for (const pid of Object.keys(this.players)) {
          const p = this.players[pid];
          const st = this.playerState[pid];
          if (!p || !st) continue;
          const shieldActive = st.shieldExpiresAt > now;
          // shield is rectangle in front of player
          if (shieldActive) {
            const sw = PLAYER_W * 1.8;
            const sx = p.x + (PLAYER_W - sw) / 2;
            const sy = p.y - 0.05;
            if (aabbCollision(swept, { x: sx, y: sy, w: sw, h: 0.06 })) { pr.alive = false; break; }
          }
          if (aabbCollision(swept, { x: p.x, y: p.y, w: PLAYER_W, h: PLAYER_H })) { pr.alive = false; p.alive = false; this.lives -= 1; break; }
        }
      }
    }

    // Clean up dead projectiles and enemies
    this.projectiles = this.projectiles.filter(p => p.alive !== false && p.y > -2 && p.y < 2);
    this.enemies = this.enemies.filter(e => e.alive !== false);

    // Process pending respawns
    if (this.respawnQueue.length > 0) {
      const due = this.respawnQueue.filter(r => r.respawnAt <= now);
      for (const r of due) {
        const t = r.type || this.randomEnemyType();
        // spawn one primary enemy
        this.enemies.push(this.generateEnemy(t));
        // 50% chance to spawn a secondary extra enemy to increase pressure
        if (Math.random() < 0.5) this.enemies.push(this.generateEnemy(Math.random() < 0.6 ? t : this.randomEnemyType()));
      }
      this.respawnQueue = this.respawnQueue.filter(r => r.respawnAt > now);
    }

    // If no enemies left and no pending respawns, start next wave with higher difficulty
    if (this.enemies.length === 0 && this.respawnQueue.length === 0) {
      this.waveNumber += 1;
      this.spawnInitialWave(3, 7);
    }

    // Attach runtime state (heat/shield) to players so clients can render HUDs
      Object.keys(this.players).forEach(pid => {
        const st = this.playerState[pid];
        if (st) {
          this.players[pid].runtimeState = {
            heat: st.heat,
            isOverheated: st.isOverheated,
            shieldActive: st.shieldExpiresAt > now,
            shieldCooldownMs: Math.max(0, st.shieldCooldownUntil - now),
            shieldTimeLeftMs: Math.max(0, st.shieldExpiresAt - now)
          };
        } else {
          this.players[pid].runtimeState = null;
        }
      });

      // Broadcast state
      return [{ payload: { players: this.players, enemies: this.enemies, projectiles: this.projectiles, lives: this.lives, teamScore: this.teamScore } }];
  }

  private handleFire(clientId: string, now: number){
    const p = this.players[clientId];
    const st = this.playerState[clientId];
    if (!p || !st) return;
    if (st.isOverheated && now < st.overheatedUntil) return;
    if (now - st.lastShotAt < 40) return; // fire rate limit (shorter cooldown)

    st.lastShotAt = now;
    // heat handling
    st.heat += HEAT_PER_SHOT;
    if (st.heat >= 100){ st.heat = 100; st.isOverheated = true; st.overheatedUntil = now + OVERHEAT_DURATION_MS; }

    // spawn player projectile from player's center
    const proj: ProjectileState = {
      x: p.x + PLAYER_W/2,
      y: p.y,
      vx: 0,
      vy: PLAYER_PROJECTILE_SPEED,
      w: PROJ_W,
      h: PROJ_H,
      owner: 'player', ownerId: clientId,
      alive: true
    };
    this.projectiles.push(proj);

    // immediate collision check in case player fires into a very-close enemy
    for (let j = this.enemies.length - 1; j >= 0; j--) {
      const en = this.enemies[j];
      if (!en.alive) continue;
      const prRect = { x: proj.x - proj.w/2, y: proj.y - proj.h/2, w: proj.w, h: proj.h };
      if (aabbCollision(prRect, { x: en.x, y: en.y, w: en.w, h: en.h })) {
        proj.alive = false;
        en.hp = (en.hp || 1) - 1;
        if (en.hp <= 0) {
          en.alive = false;
          const shooter = this.players[clientId];
          if (shooter) shooter.score = (shooter.score || 0) + 1;
          // increment common/team score
          this.teamScore += 1;
          const respawnDelay = Math.max(700, 1500 - (this.waveNumber - 1) * 150) + Math.floor(Math.random() * 1400);
          this.respawnQueue.push({ respawnAt: now + respawnDelay });
        }
        break;
      }
    }
  }

  private handleShield(clientId: string, now: number){
    const st = this.playerState[clientId];
    if (!st) return;
    if (now < st.shieldCooldownUntil) return; // on cooldown
    st.shieldExpiresAt = now + SHIELD_DURATION_MS;
    st.shieldCooldownUntil = now + SHIELD_COOLDOWN_MS;
  }

  private updateEnemies(dt: number, now: number){
    const bounds = { left: -1, right: 1 };
    const difficulty = Math.pow(1.18, Math.max(0, this.waveNumber - 1));

    for(const e of this.enemies){
      if (!e.alive) continue;
      switch(e.type){
        case 'PENDULUM':
          e.x += (e.vx || 0) * dt;
          e.y = (e.baseY || 0) + (e.amplitude || 0) * Math.sin((e.frequency||1) * e.x + (e.phase||0));
          // fire at peaks
          const sinVal = Math.sin((e.frequency||1) * e.x + (e.phase||0));
          const peakCooldownMs = Math.max(120, Math.floor(700 / difficulty));
          if (sinVal > 0.9 && (!e.lastPeakFireAt || now - e.lastPeakFireAt > peakCooldownMs)){
            e.lastPeakFireAt = now;
            // main downward shot (scale speed by difficulty)
            this.projectiles.push({ x: e.x + e.w/2, y: e.y + e.h, vx: 0, vy: ENEMY_PROJECTILE_SPEED * difficulty, w: PROJ_W, h: PROJ_H, owner: 'enemy', alive: true });
            // increase chance of spread shots with difficulty (clamped)
            const spreadChance = Math.min(0.8, 0.35 * difficulty);
            if (Math.random() < spreadChance) {
              this.projectiles.push({ x: e.x + e.w/2 + 0.03, y: e.y + e.h, vx: 0.14 * difficulty, vy: ENEMY_PROJECTILE_SPEED * difficulty, w: PROJ_W, h: PROJ_H, owner: 'enemy', alive: true });
              this.projectiles.push({ x: e.x + e.w/2 - 0.03, y: e.y + e.h, vx: -0.14 * difficulty, vy: ENEMY_PROJECTILE_SPEED * difficulty, w: PROJ_W, h: PROJ_H, owner: 'enemy', alive: true });
            }
            // occasional extra straight shot on higher difficulties
            if (Math.random() < Math.min(0.35, 0.08 * difficulty)) {
              this.projectiles.push({ x: e.x + e.w/2, y: e.y + e.h, vx: 0, vy: ENEMY_PROJECTILE_SPEED * difficulty * 1.05, w: PROJ_W, h: PROJ_H, owner: 'enemy', alive: true });
            }
          }
          // wrap horizontally
          if (e.x < bounds.left - 0.2) e.x = bounds.right + 0.2;
          if (e.x > bounds.right + 0.2) e.x = bounds.left - 0.2;
          break;

        case 'JUMPER':
          if (!e.lastJumpAt) e.lastJumpAt = now;
          if (now - e.lastJumpAt >= (e.jumpIntervalMs || 1200)){
            e.lastJumpAt = now;
            const step = 0.22 * (e.direction || 1);
            const target = (e.x || 0) + step;
            if (target < bounds.left || target + e.w > bounds.right){
              e.direction = -(e.direction || 1);
              e.y += 0.06;
            } else {
              e.x = target;
            }
          }
          break;

        case 'DIVER':
          const anyPlayerBelow = Object.values(this.players).some((p:any) => p.y > e.y);
          if (!e.diving){
            if (anyPlayerBelow){
              if (!e.idleStartAt) e.idleStartAt = now;
              if (!e.lastBlinkAt || now - e.lastBlinkAt >= (e.blinkMs||300)){
                e.visible = !e.visible; e.lastBlinkAt = now;
              }
              if (now - e.idleStartAt >= (e.diveStartDelayMs||3000)){
                e.diving = true; e.vy = e.diveSpeed || 3.2; e.visible = true;
              }
            } else {
              e.idleStartAt = 0; e.visible = true;
            }
          } else {
            e.y += (e.vy||0) * dt;
            if (e.y > 1.3) e.alive = false;
          }
          break;
      }
    }
  }

  // Create a new enemy instance for respawn with varied positions by type
  private generateEnemy(type: EnemyType): EnemyState {
    const difficulty = Math.pow(1.18, Math.max(0, this.waveNumber - 1));
    const startX = -0.9 + Math.random() * 1.8;
    let ex = startX;
    let ey = -0.8;
    const baseHp = 1 + Math.floor((this.waveNumber - 1) / 2);
    const e: EnemyState = {
      id: this.nextEnemyId++,
      type,
      x: ex,
      y: ey,
      w: 0.10,
      h: 0.06,
      hp: baseHp,
      alive: true
    };

    if (type === 'PENDULUM'){
      e.vx = (0.25 + Math.random()*0.2) * (Math.random() < 0.5 ? 1 : -1) * difficulty;
      e.baseY = ey + (Math.random()*0.06 - 0.02);
      e.amplitude = (0.08 + Math.random()*0.06) * (1 + 0.08*(this.waveNumber-1));
      e.frequency = (2 + Math.random()*2) * (1 + 0.06*(this.waveNumber-1));
      e.phase = Math.random()*Math.PI*2;
      e.lastPeakFireAt = 0;
    } else if (type === 'JUMPER'){
      e.jumpIntervalMs = Math.max(350, Math.floor(1100 / difficulty) + Math.floor(Math.random()*800));
      e.lastJumpAt = Date.now() + Math.random()*e.jumpIntervalMs;
      e.direction = Math.random() < 0.5 ? -1 : 1;
      e.y = -0.7 + Math.random()*0.06;
    } else if (type === 'DIVER'){
      e.diving = false;
      e.idleStartAt = 0;
      e.diveStartDelayMs = Math.max(500, Math.floor(1800 / difficulty) + Math.floor(Math.random()*1500));
      e.blinkMs = 150 + Math.floor(Math.random()*200);
      e.lastBlinkAt = Date.now();
      e.visible = true;
      e.diveSpeed = (3.8 + Math.random()*1.8) * difficulty;
      e.x = -0.9 + Math.random()*1.8;
      e.y = -0.95 + Math.random()*0.08;
    }
    return e;
  }

  private randomEnemyType(): EnemyType {
    const types: EnemyType[] = ['PENDULUM','JUMPER','DIVER'];
    return types[Math.floor(Math.random() * types.length)];
  }

  isFinished(): boolean { return this.lives <= 0; }
}

/* =====================
   SpaceClient
   ===================== */
export class SpaceClient extends GameClient {
  private players: Record<string, any> = null;
  private enemies: EnemyState[] = [];
  private serverEnemies: EnemyState[] = [];
  private projectiles: ProjectileState[] = [];
  private messageQueue: any[] = [];
  // Start client-side lives matching server
  private lives: number = 5;
  private localShieldUntil: number = 0;
  private localShieldCooldownUntil: number = 0;
  private gameOver: boolean = false;
  private finalScores: { name: string; score: number }[] = [];
  private returnRequested: boolean = false;
  private gameOverAt: number = 0;
  private teamScore: number = 0;

  constructor(userInput: UserInput, myId: string){
    super(userInput, myId);

    // Simple key mapping for fire/shield (both Space/Enter and Shift/Ctrl)
    document.addEventListener('keydown', (e) => {
      // if this client has been marked spectator by the server, allow exit (Enter/Escape)
      // but ignore other game inputs
      const meCheck = (this.players && this.players[this.myId]) ? this.players[this.myId] : null;
      const isSpectator = !!(meCheck && meCheck.isSpectator);
      if (isSpectator) {
        if (e.code === 'Enter' || e.code === 'Escape') {
          this.requestReturnToLobby();
        }
        return;
      }
      // When game over, use Enter/Escape to confirm return to lobby
      if (this.gameOver) {
        if (e.code === 'Enter' || e.code === 'Escape') {
          this.requestReturnToLobby();
        }
        return;
      }

      if (e.code === 'Space' || e.code === 'Enter') this.messageQueue.push({ kind: 'fire' });
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'ControlLeft' || e.code === 'ControlRight'){
        const now = Date.now();
        if (now >= this.localShieldCooldownUntil){
          this.messageQueue.push({ kind: 'shield' });
          // immediate visual feedback and local cooldown prediction
          this.localShieldUntil = now + SHIELD_DURATION_MS;
          this.localShieldCooldownUntil = now + SHIELD_COOLDOWN_MS;
        }
      }
    });
  }

  async init(players){ this.players = players; }

  draw(ctx: CanvasRenderingContext2D, dt: number){
    if (!this.players) return;

    const { screenW, screenH, moveDirectionX } = this.userInput;
    const canvas = this.userInput.canvas;
    const canvasW = canvas.width;
    const canvasH = canvas.height;
    // compute device pixel ratio used by the canvas by comparing its
    // internal pixel size (canvas.width) with its CSS size (bounding rect)
    const canvasRect = canvas.getBoundingClientRect();
    const cssWidth = canvasRect.width || this.userInput.screenW || canvasW;
    const dprScale = canvasW / cssWidth || window.devicePixelRatio || 1;

    // Local smoothing movement for the local player (disabled if game over)
    const me = this.players[this.myId];
    if (me && !this.gameOver && !me.isSpectator){
      // apply immediate local input
      me.x += moveDirectionX * dt * PLAYER_SPEED;
      // clamp locally
      if (me.x < -1) me.x = -1;
      if (me.x + PLAYER_W > 1) me.x = 1 - PLAYER_W;
      // Smoothly correct toward server authoritative position when available
      const serverX = (me as any)._serverX;
      if (typeof serverX === 'number'){
        // use lerp for smooth correction towards server value
        const alpha = Math.min(1, dt * 8);
        me.x = lerp(me.x, serverX, alpha);
      }
    }

    // Smooth other players toward their server positions (skip smoothing on game over)
    if (!this.gameOver) {
      const playerSmoothingAlpha = Math.min(1, dt * 8);
      Object.keys(this.players).forEach(pid => {
        if (pid === this.myId) return;
        const other = this.players[pid];
        if (!other) return;
        const sx = (other as any)._serverX;
        if (typeof sx === 'number') other.x = lerp(other.x, sx, playerSmoothingAlpha);
      });
    }

    // Draw in normalized coordinates: translate/scale like other games
    ctx.save();
    ctx.translate(screenW/2, screenH/2);
    ctx.scale(screenW/2, screenH/2);

    // background
    ctx.fillStyle = '#001022'; ctx.fillRect(-1, -1, 2, 2);

    // players
    Object.keys(this.players).forEach(id => {
      const p = this.players[id];
      const color = p.color || '#88ff88';
      ctx.fillStyle = color;
      ctx.fillRect(p.x, p.y, PLAYER_W, PLAYER_H);
      // draw shield: prefer immediate local feedback for local player
      const st = (p as any).runtimeState;
      const isLocal = id === this.myId;
      const localShieldActive = isLocal && Date.now() < this.localShieldUntil;
      const serverShieldActive = !!(st && st.shieldActive);
      if (localShieldActive || serverShieldActive){
        const sw = PLAYER_W * 1.8; const sx = p.x + (PLAYER_W - sw)/2; const sy = p.y - 0.05;
        ctx.fillStyle = 'rgba(80,160,255,0.45)'; ctx.fillRect(sx, sy, sw, 0.06);
      }

      // draw heat bar & shield cooldown if available (server-provided runtimeState)
      if (st){
        // background for heat
        ctx.fillStyle = '#333'; ctx.fillRect(p.x, p.y - 0.04, PLAYER_W, 0.02);
        // heat fill
        ctx.fillStyle = st.isOverheated ? '#ff3333' : '#ffcc00';
        const heatW = (st.heat / 100) * PLAYER_W;
        ctx.fillRect(p.x, p.y - 0.04, heatW, 0.02);

        // shield cooldown indicator (under player) - use the larger of server-side and local predicted cooldown
        let cdMs = st.shieldCooldownMs || 0;
        if (isLocal){
          const localCd = Math.max(0, this.localShieldCooldownUntil - Date.now());
          cdMs = Math.max(cdMs, localCd);
        }
        const cdFrac = Math.min(1, cdMs / SHIELD_COOLDOWN_MS);
        ctx.fillStyle = '#555'; ctx.fillRect(p.x, p.y + PLAYER_H + 0.02, PLAYER_W, 0.01);
        ctx.fillStyle = '#00aaff'; ctx.fillRect(p.x, p.y + PLAYER_H + 0.02, PLAYER_W * (1 - cdFrac), 0.01);
      }
    });

    // enemies: smoothly lerp display enemies toward latest server snapshot
    const enemyAlpha = Math.min(1, dt * 10);
    this.enemies.forEach(e => {
      const serverE = this.serverEnemies.find(s => s.id === e.id);
      if (serverE) {
        e.x = lerp(e.x, serverE.x, enemyAlpha);
        e.y = lerp(e.y, serverE.y, enemyAlpha);
        e.visible = serverE.visible;
      }
      if (e.type === 'DIVER' && e.visible === false) return;
      ctx.fillStyle = e.type === 'PENDULUM' ? '#9bdfef' : e.type === 'JUMPER' ? '#ffd59e' : '#ff9090';
      ctx.fillRect(e.x, e.y, e.w, e.h);
    });

    // projectiles
    this.projectiles.forEach(p => {
      ctx.fillStyle = p.owner === 'player' ? '#ffffff' : '#ff4444';
      ctx.fillRect(p.x - p.w/2, p.y - p.h/2, p.w, p.h);
    });

    ctx.restore();

    // HUD — draw centered at the top so it never clips at the sides
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    // use canvas vs CSS scale to pick font sizes and margins so text isn't clipped on high-DPI
    const hudMarginCss = 18;
    const fontLargeCss = 20;
    const fontSmallCss = 14;
    const hudMargin = Math.max(8, Math.round(hudMarginCss * dprScale));
    const fontLargePx = Math.max(12, Math.round(fontLargeCss * dprScale));
    const fontSmallPx = Math.max(10, Math.round(fontSmallCss * dprScale));
    const extraPad = Math.max(2, Math.round(2 * dprScale));
    const cssTop = canvasRect.top || 0;
    const topInsetPx = Math.round(Math.max(0, cssTop) * dprScale);
    const hudY = Math.max(hudMargin + extraPad, topInsetPx + hudMargin + Math.round(2 * dprScale));
    const hudX = Math.round(canvasW / 2);
    ctx.font = `${fontLargePx}px Arial`;
    ctx.fillText(`Lives: ${this.lives}`, hudX, Math.round(hudY));
    ctx.font = `${fontSmallPx}px Arial`;
    ctx.fillText(`Score: ${this.teamScore}`, hudX, Math.round(hudY + fontLargePx + Math.round(6 * dprScale)));
    ctx.restore();

    // Game over overlay + final scoreboard
    if (this.gameOver) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      // draw overlay using canvas pixels
      ctx.fillRect(0, 0, canvasW, canvasH);

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.font = `${Math.max(18, Math.round(48 * dprScale))}px Arial`;
      ctx.fillText('Game Over', canvasW / 2, canvasH * 0.25);

      ctx.font = `${Math.max(14, Math.round(22 * dprScale))}px Arial`;
      ctx.fillText('Final Score', canvasW / 2, canvasH * 0.33);

      ctx.font = `${Math.max(18, Math.round(28 * dprScale))}px Arial`;
      ctx.fillText(`${this.teamScore}`, canvasW / 2, canvasH * 0.42);

      ctx.font = `${Math.max(12, Math.round(16 * dprScale))}px Arial`;
      ctx.fillText('Premi Enter o Escape per tornare alla lobby', canvasW / 2, canvasH * 0.83);
      ctx.restore();
    }
  }

  handleMessage(message: any){
    // Merge server snapshot with local state and separate server enemies for smoothing.
    const srvPlayers = message.players || {};
    if (!this.players) {
      this.players = {};
      Object.keys(srvPlayers).forEach(id => {
        this.players[id] = { ...srvPlayers[id] };
        (this.players[id] as any)._serverX = srvPlayers[id].x;
      });
    } else {
      Object.keys(srvPlayers).forEach(id => {
        const server = srvPlayers[id];
        if (id === this.myId) {
          const local = this.players[id] || {};
          const preservedX = local.x !== undefined ? local.x : server.x;
          this.players[id] = { ...server, x: preservedX };
          (this.players[id] as any)._serverX = server.x;
          this.players[id].runtimeState = server.runtimeState;
        } else {
          if (!this.players[id]) {
            this.players[id] = { ...server };
            (this.players[id] as any)._serverX = server.x;
          } else {
            // keep local display x, but set server correction target and runtime info
            (this.players[id] as any)._serverX = server.x;
            this.players[id].runtimeState = server.runtimeState;
            if (server.color && !this.players[id].color) this.players[id].color = server.color;
          }
        }
      });
    }

    // store authoritative enemy snapshot; prepare display enemies if first time
    this.serverEnemies = message.enemies || [];
    if (!this.enemies || this.enemies.length === 0) {
      this.enemies = this.serverEnemies.map(e => ({ ...e }));
    } else {
      // update/insert display enemies and mark removals
      for (const se of this.serverEnemies) {
        const disp = this.enemies.find(d => d.id === se.id);
        if (!disp) this.enemies.push({ ...se });
        else {
          (disp as any)._serverX = se.x;
          (disp as any)._serverY = se.y;
          disp.visible = se.visible;
          disp.w = se.w; disp.h = se.h; disp.type = se.type;
        }
      }
      // remove display enemies that the server no longer has
      this.enemies = this.enemies.filter(d => this.serverEnemies.some(s => s.id === d.id));
    }

    // projectiles and lives are displayed directly
    this.projectiles = message.projectiles || [];
    this.lives = message.lives;
    this.teamScore = typeof message.teamScore === 'number' ? message.teamScore : this.teamScore;

    // detect game over from server snapshot and capture final scores for the overlay
    if (this.lives <= 0 && !this.gameOver) {
      this.gameOver = true;
      this.gameOverAt = Date.now();
      // snapshot final scores from the last server update
      this.finalScores = Object.keys(this.players || {}).map(id => {
        const p = this.players[id] || {};
        return { name: (p.name || id), score: (p.score || 0) };
      }).sort((a,b) => b.score - a.score);
      // clear queued local actions
      this.messageQueue = [];
    }
  }

  flushMessages(): any[] {
    if (!this.players) return [];
    // while in the game-over menu, do not send any game actions
    if (this.gameOver) return [];
    const me = this.players[this.myId];
    if (!me) return [];
    // spectators do not send actions
    if (me.isSpectator) return [];

    const msgs = [];
    msgs.push({ kind: 'move', x: me.x });
    // append queued actions (fire/shield)
    msgs.push(...this.messageQueue);
    this.messageQueue = [];
    return msgs;
  }
  // Called by the lobby to know when to remove the game client.
  // We only return true after the player explicitly requests to return to the lobby.
  public requestReturnToLobby(): void {
    this.returnRequested = true;
  }

  isFinished(): boolean { return this.returnRequested; }
}
