import type { Player } from '../common';
import type { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer } from './game';
import { UserInput } from '../client/user-input';
import { Button } from '../client/ui-elements';
import { getCharacterDrawFunction } from '../client/characters';

type Phase = 'countdown' | 'playing' | 'ended';
type Team = 0 | 1;

type InputMsg = {
    kind: 'input';
    mx: number;
    my: number;
    aim: number;
    action: boolean;
};

type DodgePlayer = Player & {
    id: string;
    team: Team;
    x: number;
    y: number;
    vx: number;
    vy: number;
    aim: number;
    color: string;
    lives: number;
    hits: number;
    catches: number;
    hasBall: number | null;
    charge: number;
    actionDown: boolean;
    invuln: number;
    dodgeCooldown: number;
    catchWindow: number;
    catchCooldown: number;
    catchFlash: number;
    dive: number;
    bench: number;
};

type Ball = {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    spin: number;
    heldBy: string | null;
    thrownBy: string | null;
    live: boolean;
    age: number;
};

type GameEvent =
    | { kind: 'throw'; x: number; y: number; team: Team }
    | { kind: 'hit'; x: number; y: number; victim: string; thrower: string | null }
    | { kind: 'catch'; x: number; y: number; catcher: string }
    | { kind: 'pickup'; x: number; y: number; player: string }
    | { kind: 'dive'; x: number; y: number; player: string }
    | { kind: 'wall'; x: number; y: number };

type StateMsg = {
    kind: 'state';
    phase: Phase;
    t: number;
    players: Record<string, DodgePlayer>;
    balls: Ball[];
    teamScore: [number, number];
    winnerTeam: Team | null;
    events: GameEvent[];
    note: string;
};

const COURT_W = 1500;
const COURT_H = 900;
const MID_X = COURT_W / 2;
const CENTER_GAP = 10;
const PLAYER_R = 22;
const BALL_R = 14;

const COUNTDOWN_TIME = 2.4;
const MATCH_TIME = 150;
const END_HOLD = 6;
const SCORE_TO_WIN = 12;
const WIN_MARGIN = 2;
const OVERTIME_TIME = 18;

const PLAYER_ACCEL = 1280;
const PLAYER_MAX_SPEED = 315;
const PLAYER_DRAG = 0.08;
const DIVE_SPEED = 610;
const DIVE_TIME = 0.24;
const DIVE_COOLDOWN = 1.25;
const CATCH_WINDOW_TIME = 0.24;
const CATCH_COOLDOWN = 0.52;
const CATCH_THREAT_RANGE = 185;
const CATCH_ANGLE = 0.68;

const BALL_DRAG = 0.50;
const BALL_RESTITUTION = 0.78;
const BALL_PICKUP_SPEED = 135;
const BALL_HIT_SPEED = 470;
const BALL_CATCH_SPEED = 420;
const CHARGE_TIME = 0.85;
const THROW_SPEED_MIN = 680;
const THROW_SPEED_MAX = 1220;

const TEAM_COLORS = ['#d83b2e', '#1f6fd6'] as const;
const TEAM_DARK = ['#7d1e17', '#123c78'] as const;
const TEAM_NAMES = ['Rossa', 'Blu'] as const;

function clamp(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v));
}

function rand(min: number, max: number) {
    return min + Math.random() * (max - min);
}

function distSq(ax: number, ay: number, bx: number, by: number) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
}

function normAngle(a: number) {
    while (a < -Math.PI) a += Math.PI * 2;
    while (a > Math.PI) a -= Math.PI * 2;
    return a;
}

function alpha(hex: string, amount: number) {
    return hex + Math.round(clamp(amount, 0, 1) * 255).toString(16).padStart(2, '0');
}

function smooth(from: number, to: number, dt: number, halfLife: number) {
    return to + (from - to) * Math.pow(2, -dt / halfLife);
}

function teamBounds(team: Team) {
    if (team === 0) {
        return { left: PLAYER_R, right: MID_X - CENTER_GAP - PLAYER_R };
    }
    return { left: MID_X + CENTER_GAP + PLAYER_R, right: COURT_W - PLAYER_R };
}

export class DodgeballServer extends GameServer {
    private players: Record<string, DodgePlayer> = {};
    private inputs: Record<string, InputMsg> = {};
    private balls: Ball[] = [];
    private nextBallId = 1;
    private phase: Phase = 'countdown';
    private countdown = COUNTDOWN_TIME;
    private timeLeft = MATCH_TIME;
    private elapsed = 0;
    private endTimer = 0;
    private teamScore: [number, number] = [0, 0];
    private winnerTeam: Team | null = null;
    private events: GameEvent[] = [];
    private stateTimer = 0;
    private note = 'WASD muovi, click schiva, tieni click con la palla e rilascia per tirare.';

    init(players: Record<string, Player>) {
        const ids = Object.keys(players || {});
        const leftCount = Math.ceil(ids.length / 2);
        ids.forEach((id, i) => {
            const team: Team = i < leftCount ? 0 : 1;
            const slot = team === 0 ? i : i - leftCount;
            const teamSize = team === 0 ? leftCount : Math.max(1, ids.length - leftCount);
            const x = team === 0 ? COURT_W * 0.24 : COURT_W * 0.76;
            const y = COURT_H * (0.28 + (slot + 0.5) / Math.max(1, teamSize) * 0.44);
            this.players[id] = {
                ...players[id],
                id,
                team,
                x,
                y,
                vx: 0,
                vy: 0,
                aim: team === 0 ? 0 : Math.PI,
                color: TEAM_COLORS[team],
                lives: 3,
                hits: 0,
                catches: 0,
                hasBall: null,
                charge: 0,
                actionDown: false,
                invuln: 1.2,
                dodgeCooldown: 0,
                catchWindow: 0,
                catchCooldown: 0,
                catchFlash: 0,
                dive: 0,
                bench: 0,
            };
            this.inputs[id] = { kind: 'input', mx: 0, my: 0, aim: team === 0 ? 0 : Math.PI, action: false };
        });

        const ballCount = clamp(Math.ceil(ids.length * 1.5), 3, 7);
        for (let i = 0; i < ballCount; i++) {
            this.balls.push({
                id: this.nextBallId++,
                x: MID_X + rand(-18, 18),
                y: COURT_H * (0.18 + (i + 0.5) / ballCount * 0.64),
                vx: rand(-35, 35),
                vy: rand(-20, 20),
                spin: rand(-4, 4),
                heldBy: null,
                thrownBy: null,
                live: false,
                age: 0,
            });
        }
    }

    tick(messages: IncomingMsg[], dt: number): OutgoingMsg[] {
        dt = clamp(dt, 0, 0.05);
        this.elapsed += dt;
        this.events = [];

        for (const msg of messages) {
            const player = this.players[msg.clientId];
            const payload = msg.payload as InputMsg | undefined;
            if (!player || !payload || payload.kind !== 'input') continue;
            let mx = Number(payload.mx) || 0;
            let my = Number(payload.my) || 0;
            const len = Math.hypot(mx, my);
            if (len > 1) { mx /= len; my /= len; }
            this.inputs[msg.clientId] = {
                kind: 'input',
                mx,
                my,
                aim: Number.isFinite(payload.aim) ? payload.aim : player.aim,
                action: !!payload.action,
            };
        }

        if (this.phase === 'countdown') {
            this.countdown -= dt;
            if (this.countdown <= 0) this.phase = 'playing';
        } else if (this.phase === 'playing') {
            this.timeLeft -= dt;
            this.updatePlayers(dt);
            this.resolvePlayerContacts();
            this.updateBalls(dt);
            this.resolveBallContacts();
            this.checkWinner();
        } else {
            this.endTimer += dt;
        }

        this.stateTimer += dt;
        if (this.stateTimer >= 1 / 30 || this.phase !== 'playing') {
            this.stateTimer = 0;
            return [{ payload: this.makeState() }];
        }
        return [];
    }

    isFinished(): boolean {
        return this.phase === 'ended' && this.endTimer > END_HOLD;
    }

    private updatePlayers(dt: number) {
        for (const p of Object.values(this.players)) {
            const input = this.inputs[p.id] || { kind: 'input', mx: 0, my: 0, aim: p.aim, action: false };
            p.aim = input.aim;
            p.invuln = Math.max(0, p.invuln - dt);
            p.dodgeCooldown = Math.max(0, p.dodgeCooldown - dt);
            p.catchWindow = Math.max(0, p.catchWindow - dt);
            p.catchCooldown = Math.max(0, p.catchCooldown - dt);
            p.catchFlash = Math.max(0, p.catchFlash - dt);
            p.dive = Math.max(0, p.dive - dt);

            if (p.bench > 0) {
                p.bench -= dt;
                p.vx *= Math.pow(0.02, dt);
                p.vy *= Math.pow(0.02, dt);
                if (p.bench <= 0) this.respawnPlayer(p);
                p.actionDown = input.action;
                continue;
            }

            const pressedNow = input.action;
            const pressedBefore = p.actionDown;
            const justPressed = pressedNow && !pressedBefore;
            const justReleased = !pressedNow && pressedBefore;

            if (p.hasBall !== null) {
                if (pressedNow) p.charge = Math.min(CHARGE_TIME, p.charge + dt);
                if (justReleased) this.throwBall(p);
            } else if (justPressed) {
                if (!this.tryStartCatch(p)) this.tryDive(p, input);
            }

            if (p.dive <= 0) {
                p.vx += input.mx * PLAYER_ACCEL * dt;
                p.vy += input.my * PLAYER_ACCEL * dt;
            }

            const maxSpeed = p.dive > 0 ? DIVE_SPEED : PLAYER_MAX_SPEED * (p.hasBall === null ? 1 : 0.88);
            const speed = Math.hypot(p.vx, p.vy);
            if (speed > maxSpeed) {
                p.vx = p.vx / speed * maxSpeed;
                p.vy = p.vy / speed * maxSpeed;
            }

            p.vx *= Math.pow(PLAYER_DRAG, dt);
            p.vy *= Math.pow(PLAYER_DRAG, dt);
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            this.keepPlayerInside(p);
            this.tryPickupBall(p);
            p.actionDown = pressedNow;
        }
    }

    private tryDive(p: DodgePlayer, input: InputMsg) {
        if (p.dodgeCooldown > 0) return;
        const len = Math.hypot(input.mx, input.my);
        const angle = len > 0.1 ? Math.atan2(input.my, input.mx) : p.aim;
        p.vx += Math.cos(angle) * DIVE_SPEED;
        p.vy += Math.sin(angle) * DIVE_SPEED;
        p.invuln = Math.max(p.invuln, DIVE_TIME);
        p.dive = DIVE_TIME;
        p.dodgeCooldown = DIVE_COOLDOWN;
        this.events.push({ kind: 'dive', x: p.x, y: p.y, player: p.id });
    }

    private tryStartCatch(p: DodgePlayer): boolean {
        if (p.catchCooldown > 0 || p.dive > 0) return false;
        const threat = this.findCatchThreat(p);
        if (!threat) return false;
        p.catchWindow = CATCH_WINDOW_TIME;
        p.catchCooldown = CATCH_COOLDOWN;
        p.vx *= 0.72;
        p.vy *= 0.72;
        this.note = `${p.name} prova la presa al volo.`;
        return true;
    }

    private findCatchThreat(p: DodgePlayer): Ball | null {
        for (const ball of this.balls) {
            if (!ball.live || ball.heldBy) continue;
            const thrower = ball.thrownBy ? this.players[ball.thrownBy] : null;
            if (!thrower || thrower.team === p.team) continue;
            const dx = p.x - ball.x;
            const dy = p.y - ball.y;
            const d = Math.hypot(dx, dy);
            if (d > CATCH_THREAT_RANGE || d < PLAYER_R) continue;
            const speed = Math.hypot(ball.vx, ball.vy);
            if (speed < BALL_CATCH_SPEED) continue;
            const movingToward = (ball.vx * dx + ball.vy * dy) / Math.max(1, speed * d);
            if (movingToward < 0.56) continue;
            const toBall = Math.atan2(ball.y - p.y, ball.x - p.x);
            if (Math.abs(normAngle(toBall - p.aim)) > CATCH_ANGLE * 1.35) continue;
            return ball;
        }
        return null;
    }

    private keepPlayerInside(p: DodgePlayer) {
        const bounds = teamBounds(p.team);
        if (p.x < bounds.left) { p.x = bounds.left; p.vx = Math.abs(p.vx) * 0.25; }
        if (p.x > bounds.right) { p.x = bounds.right; p.vx = -Math.abs(p.vx) * 0.25; }
        if (p.y < PLAYER_R) { p.y = PLAYER_R; p.vy = Math.abs(p.vy) * 0.25; }
        if (p.y > COURT_H - PLAYER_R) { p.y = COURT_H - PLAYER_R; p.vy = -Math.abs(p.vy) * 0.25; }
    }

    private resolvePlayerContacts() {
        const list = Object.values(this.players).filter(p => p.bench <= 0);
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i];
                const b = list[j];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const d = Math.hypot(dx, dy);
                const min = PLAYER_R * 2;
                if (d <= 0 || d >= min) continue;
                const nx = dx / d;
                const ny = dy / d;
                const push = (min - d) * 0.5;
                a.x -= nx * push;
                a.y -= ny * push;
                b.x += nx * push;
                b.y += ny * push;
                const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                if (rel < 0) {
                    const impulse = -rel * 0.45 + 42;
                    a.vx -= nx * impulse;
                    a.vy -= ny * impulse;
                    b.vx += nx * impulse;
                    b.vy += ny * impulse;
                }
                this.keepPlayerInside(a);
                this.keepPlayerInside(b);
            }
        }
    }

    private updateBalls(dt: number) {
        for (const ball of this.balls) {
            ball.age += dt;
            if (ball.heldBy) {
                const holder = this.players[ball.heldBy];
                if (!holder || holder.bench > 0 || holder.hasBall !== ball.id) {
                    this.dropBall(ball);
                    continue;
                }
                ball.x = holder.x + Math.cos(holder.aim) * (PLAYER_R + BALL_R * 0.35);
                ball.y = holder.y + Math.sin(holder.aim) * (PLAYER_R + BALL_R * 0.35);
                ball.vx = holder.vx;
                ball.vy = holder.vy;
                ball.spin += dt * 7;
                continue;
            }

            ball.x += ball.vx * dt;
            ball.y += ball.vy * dt;
            ball.vx *= Math.pow(BALL_DRAG, dt);
            ball.vy *= Math.pow(BALL_DRAG, dt);
            ball.spin += (ball.vx + ball.vy) * 0.002 * dt;

            let bounced = false;
            if (ball.x < BALL_R) {
                ball.x = BALL_R;
                ball.vx = Math.abs(ball.vx) * BALL_RESTITUTION;
                bounced = true;
            } else if (ball.x > COURT_W - BALL_R) {
                ball.x = COURT_W - BALL_R;
                ball.vx = -Math.abs(ball.vx) * BALL_RESTITUTION;
                bounced = true;
            }
            if (ball.y < BALL_R) {
                ball.y = BALL_R;
                ball.vy = Math.abs(ball.vy) * BALL_RESTITUTION;
                bounced = true;
            } else if (ball.y > COURT_H - BALL_R) {
                ball.y = COURT_H - BALL_R;
                ball.vy = -Math.abs(ball.vy) * BALL_RESTITUTION;
                bounced = true;
            }
            if (bounced) {
                ball.live = false;
                this.events.push({ kind: 'wall', x: ball.x, y: ball.y });
            }
            if (Math.hypot(ball.vx, ball.vy) < BALL_PICKUP_SPEED * 0.55) {
                ball.live = false;
                ball.thrownBy = null;
            }
        }
    }

    private resolveBallContacts() {
        this.resolveBallBallContacts();
        for (const ball of this.balls) {
            if (ball.heldBy) continue;
            for (const p of Object.values(this.players)) {
                if (p.bench > 0) continue;
                if (distSq(ball.x, ball.y, p.x, p.y) > (BALL_R + PLAYER_R) * (BALL_R + PLAYER_R)) continue;
                this.handleBallPlayer(ball, p);
            }
        }
    }

    private resolveBallBallContacts() {
        for (let i = 0; i < this.balls.length; i++) {
            for (let j = i + 1; j < this.balls.length; j++) {
                const a = this.balls[i];
                const b = this.balls[j];
                if (a.heldBy || b.heldBy) continue;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const d = Math.hypot(dx, dy);
                const min = BALL_R * 2;
                if (d <= 0 || d >= min) continue;
                const nx = dx / d;
                const ny = dy / d;
                const push = (min - d) * 0.5;
                a.x -= nx * push;
                a.y -= ny * push;
                b.x += nx * push;
                b.y += ny * push;
                const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                if (rel < 0) {
                    const impulse = -rel * 0.86;
                    a.vx -= nx * impulse;
                    a.vy -= ny * impulse;
                    b.vx += nx * impulse;
                    b.vy += ny * impulse;
                    a.live = false;
                    b.live = false;
                }
            }
        }
    }

    private handleBallPlayer(ball: Ball, p: DodgePlayer) {
        const speed = Math.hypot(ball.vx, ball.vy);
        const thrower = ball.thrownBy ? this.players[ball.thrownBy] : null;
        const enemyThrow = !!thrower && thrower.team !== p.team;

        if (ball.live && enemyThrow && speed > BALL_CATCH_SPEED && p.hasBall === null && this.wantsCatch(p, ball)) {
            this.catchBall(p, ball);
            return;
        }

        if (ball.live && enemyThrow && speed > BALL_HIT_SPEED && p.invuln <= 0) {
            this.hitPlayer(p, ball, thrower);
            return;
        }

        if (speed < BALL_PICKUP_SPEED && p.hasBall === null && !ball.live) {
            this.giveBall(p, ball);
            return;
        }

        const dx = ball.x - p.x;
        const dy = ball.y - p.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const nx = dx / d;
        const ny = dy / d;
        ball.x = p.x + nx * (PLAYER_R + BALL_R + 1);
        ball.y = p.y + ny * (PLAYER_R + BALL_R + 1);
        const rel = (ball.vx - p.vx) * nx + (ball.vy - p.vy) * ny;
        if (rel < 0) {
            ball.vx -= nx * rel * 1.35;
            ball.vy -= ny * rel * 1.35;
        }
    }

    private wantsCatch(p: DodgePlayer, ball: Ball) {
        const input = this.inputs[p.id];
        if (!input || p.catchWindow <= 0 || p.dive > 0) return false;
        const toBall = Math.atan2(ball.y - p.y, ball.x - p.x);
        const aimOk = Math.abs(normAngle(toBall - p.aim)) < CATCH_ANGLE;
        const speed = Math.hypot(ball.vx, ball.vy);
        const dx = p.x - ball.x;
        const dy = p.y - ball.y;
        const toward = (ball.vx * dx + ball.vy * dy) / Math.max(1, speed * Math.hypot(dx, dy));
        return aimOk && toward > 0.38;
    }

    private catchBall(p: DodgePlayer, ball: Ball) {
        const thrower = ball.thrownBy ? this.players[ball.thrownBy] : null;
        if (thrower) this.teamScore[p.team] += 1;
        p.catches += 1;
        p.lives = Math.min(3, p.lives + 1);
        p.catchWindow = 0;
        p.catchFlash = 0.55;
        this.giveBall(p, ball);
        this.note = `${p.name} prende al volo!`;
        this.events.push({ kind: 'catch', x: p.x, y: p.y, catcher: p.id });
    }

    private hitPlayer(p: DodgePlayer, ball: Ball, thrower: DodgePlayer | null) {
        p.lives -= 1;
        p.invuln = 1.0;
        p.dive = 0;
        p.vx += ball.vx * 0.18;
        p.vy += ball.vy * 0.18;
        if (p.hasBall !== null) this.forceDropHeldBall(p, ball.vx * 0.35, ball.vy * 0.35);
        if (thrower) {
            thrower.hits += 1;
            this.teamScore[thrower.team] += p.lives <= 0 ? 2 : 1;
        }
        if (p.lives <= 0) {
            p.bench = 3.2;
            p.hasBall = null;
            this.note = `${p.name} va in panchina per qualche secondo.`;
        } else {
            this.note = `${p.name} colpito!`;
        }
        this.events.push({ kind: 'hit', x: p.x, y: p.y, victim: p.id, thrower: thrower?.id || null });
        ball.live = false;
        ball.thrownBy = null;
        ball.vx *= -0.18;
        ball.vy *= -0.18;
    }

    private respawnPlayer(p: DodgePlayer) {
        const bounds = teamBounds(p.team);
        p.x = p.team === 0 ? bounds.left + 115 : bounds.right - 115;
        p.y = rand(COURT_H * 0.25, COURT_H * 0.75);
        p.vx = 0;
        p.vy = 0;
        p.lives = 3;
        p.charge = 0;
        p.invuln = 1.4;
        p.dodgeCooldown = 0.4;
        p.catchWindow = 0;
        p.catchCooldown = 0.2;
        p.catchFlash = 0;
        p.bench = 0;
    }

    private giveBall(p: DodgePlayer, ball: Ball) {
        p.hasBall = ball.id;
        p.charge = 0;
        ball.heldBy = p.id;
        ball.thrownBy = null;
        ball.live = false;
        ball.vx = p.vx;
        ball.vy = p.vy;
        this.events.push({ kind: 'pickup', x: ball.x, y: ball.y, player: p.id });
    }

    private tryPickupBall(p: DodgePlayer) {
        if (p.hasBall !== null || p.bench > 0) return;
        for (const ball of this.balls) {
            if (ball.heldBy || ball.live) continue;
            const speed = Math.hypot(ball.vx, ball.vy);
            if (speed > BALL_PICKUP_SPEED) continue;
            if (distSq(ball.x, ball.y, p.x, p.y) <= (PLAYER_R + BALL_R + 4) * (PLAYER_R + BALL_R + 4)) {
                this.giveBall(p, ball);
                this.note = `${p.name} recupera palla.`;
                return;
            }
        }
    }

    private throwBall(p: DodgePlayer) {
        if (p.hasBall === null) return;
        const ball = this.balls.find(b => b.id === p.hasBall);
        if (!ball) {
            p.hasBall = null;
            p.charge = 0;
            return;
        }
        const t = clamp(p.charge / CHARGE_TIME, 0, 1);
        const speed = THROW_SPEED_MIN + (THROW_SPEED_MAX - THROW_SPEED_MIN) * (t * t * 0.85 + t * 0.15);
        const ax = Math.cos(p.aim);
        const ay = Math.sin(p.aim);
        ball.heldBy = null;
        ball.thrownBy = p.id;
        ball.live = true;
        ball.age = 0;
        ball.x = p.x + ax * (PLAYER_R + BALL_R + 4);
        ball.y = p.y + ay * (PLAYER_R + BALL_R + 4);
        ball.vx = ax * speed + p.vx * 0.35;
        ball.vy = ay * speed + p.vy * 0.35;
        ball.spin = (ay * ball.vx - ax * ball.vy) * 0.02;
        p.hasBall = null;
        p.charge = 0;
        p.actionDown = false;
        this.note = `${p.name} tira una sassata.`;
        this.events.push({ kind: 'throw', x: ball.x, y: ball.y, team: p.team });
    }

    private forceDropHeldBall(p: DodgePlayer, vx: number, vy: number) {
        const ball = this.balls.find(b => b.id === p.hasBall);
        if (!ball) {
            p.hasBall = null;
            return;
        }
        p.hasBall = null;
        p.charge = 0;
        ball.heldBy = null;
        ball.thrownBy = null;
        ball.live = false;
        ball.vx = vx;
        ball.vy = vy;
    }

    private dropBall(ball: Ball) {
        if (ball.heldBy && this.players[ball.heldBy]) {
            this.players[ball.heldBy].hasBall = null;
        }
        ball.heldBy = null;
        ball.thrownBy = null;
        ball.live = false;
    }

    private checkWinner() {
        const scoreDiff = Math.abs(this.teamScore[0] - this.teamScore[1]);
        const leader: Team = this.teamScore[0] >= this.teamScore[1] ? 0 : 1;
        const lives = this.teamLives();

        if (lives[0] <= 0 && lives[1] <= 0) {
            if (this.teamScore[0] !== this.teamScore[1]) {
                this.finishMatch(this.teamScore[0] > this.teamScore[1] ? 0 : 1, 'ultimo scambio');
                return;
            }
            this.timeLeft = OVERTIME_TIME;
            for (const p of Object.values(this.players)) this.respawnPlayer(p);
            this.note = 'Doppio KO: overtime immediato.';
            return;
        }

        if (lives[0] <= 0 || lives[1] <= 0) {
            this.finishMatch(lives[0] > lives[1] ? 0 : 1, 'KO totale');
            return;
        }

        if ((this.teamScore[0] >= SCORE_TO_WIN || this.teamScore[1] >= SCORE_TO_WIN) && scoreDiff >= WIN_MARGIN) {
            this.finishMatch(leader, 'distacco decisivo');
            return;
        }

        if (this.timeLeft <= 0) {
            if (this.teamScore[0] !== this.teamScore[1]) {
                this.finishMatch(this.teamScore[0] > this.teamScore[1] ? 0 : 1, 'tempo scaduto');
                return;
            }

            if (lives[0] !== lives[1]) {
                this.finishMatch(lives[0] > lives[1] ? 0 : 1, 'piu vite rimaste');
                return;
            }

            this.timeLeft = OVERTIME_TIME;
            this.note = 'Overtime: prossima azione pesante.';
        }
    }

    private finishMatch(winner: Team, reason: string) {
        this.winnerTeam = winner;
        this.phase = 'ended';
        this.note = `Squadra ${TEAM_NAMES[winner]} vince: ${reason}.`;
        for (let i = 0; i < 18; i++) {
            this.events.push({ kind: 'catch', x: rand(COURT_W * 0.18, COURT_W * 0.82), y: rand(COURT_H * 0.18, COURT_H * 0.82), catcher: '' });
        }
    }

    private teamLives(): [number, number] {
        const lives: [number, number] = [0, 0];
        for (const p of Object.values(this.players)) {
            lives[p.team] += p.bench > 0 ? 0 : p.lives;
        }
        return lives;
    }

    private makeState(): StateMsg {
        return {
            kind: 'state',
            phase: this.phase,
            t: this.phase === 'countdown' ? this.countdown : this.timeLeft,
            players: this.players,
            balls: this.balls,
            teamScore: this.teamScore,
            winnerTeam: this.winnerTeam,
            events: this.events,
            note: this.note,
        };
    }
}

type Particle = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    color: string;
};

export class DodgeballClient extends GameClient {
    private state: StateMsg | null = null;
    private renderPlayers: Record<string, DodgePlayer> = {};
    private renderBalls: Record<number, Ball> = {};
    private particles: Particle[] = [];
    private exit = false;
    private exitButton: Button;
    private endedAt: number | null = null;

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
        this.exitButton = new Button('exit', this.userInput, () => { this.exit = true; });
    }

    async init(_players: Record<string, Player>): Promise<void> {
        return Promise.resolve();
    }

    handleMessage(message: StateMsg) {
        if (!message || message.kind !== 'state') return;
        this.state = message;
        for (const [id, player] of Object.entries(message.players)) {
            if (!this.renderPlayers[id]) this.renderPlayers[id] = { ...player };
        }
        for (const ball of message.balls) {
            if (!this.renderBalls[ball.id]) this.renderBalls[ball.id] = { ...ball };
        }
        this.handleEvents(message.events || []);
        if (message.phase === 'ended' && this.endedAt === null) this.endedAt = performance.now() / 1000;
    }

    flushMessages(): InputMsg[] {
        if (!this.state || this.state.phase !== 'playing') return [];
        const aim = this.computeAim(this.state);
        return [{
            kind: 'input',
            mx: this.userInput.moveDirectionX,
            my: this.userInput.moveDirectionY,
            aim,
            action: this.userInput.isMouseLeftPressed,
        }];
    }

    isFinished(): boolean {
        if (this.exit) return true;
        return this.endedAt !== null && performance.now() / 1000 - this.endedAt > END_HOLD;
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        const w = this.userInput.screenW;
        const h = this.userInput.screenH;
        ctx.clearRect(0, 0, w, h);
        this.drawBackdrop(ctx, w, h);

        if (!this.state) {
            this.centerText(ctx, 'Entrata in palestra...', w / 2, h / 2, 28, '#fff4d8');
            return;
        }

        const view = this.view();
        ctx.save();
        ctx.translate(view.x, view.y);
        ctx.scale(view.s, view.s);
        this.drawCourt(ctx);
        this.updateAndDrawParticles(ctx, dt);
        this.drawBalls(ctx, this.state, dt);
        this.drawPlayers(ctx, this.state, dt);
        ctx.restore();

        this.drawHud(ctx, this.state, w, h);
        this.exitButton.draw(ctx, w - 92, 16, 76, 32);
    }

    private view() {
        const margin = 32;
        const s = Math.min((this.userInput.screenW - margin * 2) / COURT_W, (this.userInput.screenH - margin * 2) / COURT_H);
        return {
            s,
            x: (this.userInput.screenW - COURT_W * s) / 2,
            y: (this.userInput.screenH - COURT_H * s) / 2,
        };
    }

    private computeAim(st: StateMsg) {
        const me = st.players[this.myId];
        if (!me) return 0;
        const view = this.view();
        const wx = (this.userInput.mouseX - view.x) / view.s;
        const wy = (this.userInput.mouseY - view.y) / view.s;
        return Math.atan2(wy - me.y, wx - me.x);
    }

    private drawBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number) {
        const g = ctx.createRadialGradient(w * 0.5, h * 0.3, 80, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
        g.addColorStop(0, '#243447');
        g.addColorStop(0.55, '#111923');
        g.addColorStop(1, '#05070b');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }

    private drawCourt(ctx: CanvasRenderingContext2D) {
        ctx.save();
        roundedRect(ctx, 0, 0, COURT_W, COURT_H, 24);
        ctx.clip();

        const base = ctx.createLinearGradient(0, 0, 0, COURT_H);
        base.addColorStop(0, '#d8a256');
        base.addColorStop(0.48, '#c5883e');
        base.addColorStop(1, '#ad6d33');
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, COURT_W, COURT_H);

        for (let y = 0; y < COURT_H; y += 58) {
            ctx.fillStyle = y % 116 === 0 ? 'rgba(255,235,180,0.10)' : 'rgba(75,37,13,0.08)';
            ctx.fillRect(0, y, COURT_W, 58);
            ctx.strokeStyle = 'rgba(72,34,13,0.18)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(COURT_W, y);
            ctx.stroke();
        }
        for (let x = 42; x < COURT_W; x += 120) {
            ctx.strokeStyle = 'rgba(80,42,15,0.10)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + 24, COURT_H);
            ctx.stroke();
        }

        ctx.fillStyle = 'rgba(216,59,46,0.09)';
        ctx.fillRect(0, 0, MID_X, COURT_H);
        ctx.fillStyle = 'rgba(31,111,214,0.09)';
        ctx.fillRect(MID_X, 0, MID_X, COURT_H);

        ctx.strokeStyle = '#f8ead2';
        ctx.lineWidth = 7;
        ctx.strokeRect(20, 20, COURT_W - 40, COURT_H - 40);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(MID_X, 24);
        ctx.lineTo(MID_X, COURT_H - 24);
        ctx.stroke();

        ctx.setLineDash([24, 18]);
        ctx.strokeStyle = 'rgba(248,234,210,0.78)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(MID_X, COURT_H / 2, 118, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(20,25,32,0.35)';
        ctx.fillRect(MID_X - 4, 24, 8, COURT_H - 48);
        ctx.restore();

        ctx.save();
        roundedRect(ctx, 0, 0, COURT_W, COURT_H, 24);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
    }

    private drawPlayers(ctx: CanvasRenderingContext2D, st: StateMsg, dt: number) {
        for (const [id, target] of Object.entries(st.players)) {
            const p = this.renderPlayers[id] || { ...target };
            p.x = smooth(p.x, target.x, dt, 0.04);
            p.y = smooth(p.y, target.y, dt, 0.04);
            p.vx = target.vx;
            p.vy = target.vy;
            p.aim = target.aim;
            p.lives = target.lives;
            p.hasBall = target.hasBall;
            p.charge = target.charge;
            p.invuln = target.invuln;
            p.dodgeCooldown = target.dodgeCooldown;
            p.catchWindow = target.catchWindow;
            p.catchCooldown = target.catchCooldown;
            p.catchFlash = target.catchFlash;
            p.dive = target.dive;
            p.bench = target.bench;
            p.hits = target.hits;
            p.catches = target.catches;
            this.renderPlayers[id] = p;
            this.drawSinglePlayer(ctx, p, id === this.myId);
        }
    }

    private drawSinglePlayer(ctx: CanvasRenderingContext2D, p: DodgePlayer, isMe: boolean) {
        if (p.bench > 0) {
            ctx.save();
            ctx.globalAlpha = 0.42;
            this.drawBody(ctx, p, isMe);
            ctx.restore();
            this.drawName(ctx, p, isMe, `BENCH ${p.bench.toFixed(1)}`);
            return;
        }
        this.drawBody(ctx, p, isMe);
        this.drawName(ctx, p, isMe);
        this.drawHearts(ctx, p);
    }

    private drawBody(ctx: CanvasRenderingContext2D, p: DodgePlayer, isMe: boolean) {
        const angle = p.aim;
        ctx.save();
        this.drawFloorSignal(ctx, p, isMe, angle);

        if (p.dive > 0) {
            ctx.fillStyle = alpha(p.color, 0.16);
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(Math.atan2(p.vy, p.vx));
            ctx.beginPath();
            ctx.moveTo(-PLAYER_R * 0.9, PLAYER_R * 0.35);
            ctx.lineTo(-PLAYER_R * 3.0, PLAYER_R * 1.0);
            ctx.lineTo(-PLAYER_R * 1.0, PLAYER_R * 1.6);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        const drawCharacter = getCharacterDrawFunction(p.character);
        drawCharacter(ctx, p.x, p.y - 10, 34, 82, {
            mainColor: p.color,
            robeColor: p.color,
            shirtColor: p.color,
        });

        if (p.invuln > 0) {
            ctx.strokeStyle = `rgba(255,248,224,${0.22 + Math.sin(performance.now() * 0.018) * 0.14})`;
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y + 33, PLAYER_R * 1.55, PLAYER_R * 0.42, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }

    private drawFloorSignal(ctx: CanvasRenderingContext2D, p: DodgePlayer, isMe: boolean, angle: number) {
        const footY = p.y + 36;
        ctx.save();
        ctx.fillStyle = 'rgba(28,16,7,0.18)';
        ctx.beginPath();
        ctx.ellipse(p.x + 4, footY, PLAYER_R * 1.35, PLAYER_R * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();

        if (isMe) {
            ctx.strokeStyle = alpha(p.color, 0.52);
            ctx.lineWidth = 2.4;
            ctx.lineCap = 'round';
            ctx.setLineDash([16, 9]);
            ctx.beginPath();
            ctx.ellipse(p.x, footY + 1, PLAYER_R * 1.62, PLAYER_R * 0.52, 0, Math.PI * 0.05, Math.PI * 1.95);
            ctx.stroke();
            ctx.setLineDash([]);
        } else {
            ctx.strokeStyle = alpha(TEAM_DARK[p.team], 0.35);
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.ellipse(p.x, footY + 1, PLAYER_R * 1.25, PLAYER_R * 0.36, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(angle);
        ctx.strokeStyle = alpha(p.color, isMe ? 0.44 : 0.24);
        ctx.lineWidth = isMe ? 4 : 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(PLAYER_R + 16, PLAYER_R * 0.72);
        ctx.lineTo(PLAYER_R + 47, PLAYER_R * 0.72);
        ctx.stroke();
        ctx.fillStyle = alpha(p.color, isMe ? 0.62 : 0.32);
        ctx.beginPath();
        ctx.moveTo(PLAYER_R + 52, PLAYER_R * 0.72);
        ctx.lineTo(PLAYER_R + 40, PLAYER_R * 0.42);
        ctx.lineTo(PLAYER_R + 40, PLAYER_R * 1.02);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        if (p.catchWindow > 0 || p.catchFlash > 0) {
            const k = p.catchFlash > 0 ? p.catchFlash / 0.55 : p.catchWindow / CATCH_WINDOW_TIME;
            ctx.strokeStyle = `rgba(142,247,255,${0.18 + k * 0.48})`;
            ctx.lineWidth = 3.5;
            ctx.setLineDash([10, 6]);
            ctx.beginPath();
            ctx.ellipse(p.x, footY + 2, PLAYER_R * (1.55 + (1 - k) * 0.32), PLAYER_R * 0.56, 0, Math.PI * 0.08, Math.PI * 1.92);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        if (p.hasBall !== null && p.charge > 0) {
            const charge = clamp(p.charge / CHARGE_TIME, 0, 1);
            ctx.strokeStyle = p.charge >= CHARGE_TIME ? 'rgba(255,238,137,0.82)' : alpha(p.color, 0.62);
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.ellipse(p.x, footY + 5, PLAYER_R * 1.75, PLAYER_R * 0.64, 0, Math.PI, Math.PI + Math.PI * charge);
            ctx.stroke();
        }
        ctx.restore();
    }

    private drawName(ctx: CanvasRenderingContext2D, p: DodgePlayer, isMe: boolean, extra = '') {
        ctx.save();
        const text = `${isMe ? '* ' : ''}${p.name}${extra ? '  ' + extra : ''}`;
        ctx.font = 'bold 16px Trebuchet MS, Verdana, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(text).width + 18;
        ctx.fillStyle = 'rgba(54,31,14,0.62)';
        roundedRect(ctx, p.x - w / 2, p.y - 57, w, 24, 8);
        ctx.fill();
        ctx.strokeStyle = alpha(p.color, isMe ? 0.48 : 0.26);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#fff9ea';
        ctx.fillText(text, p.x, p.y - 44);
        ctx.restore();
    }

    private drawHearts(ctx: CanvasRenderingContext2D, p: DodgePlayer) {
        ctx.save();
        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = i < p.lives ? '#ffef6e' : 'rgba(65,35,14,0.32)';
            ctx.beginPath();
            ctx.arc(p.x - 15 + i * 15, p.y - 29, 4.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(64,35,13,0.42)';
            ctx.lineWidth = 1.2;
            ctx.stroke();
        }
        ctx.restore();
    }

    private drawBalls(ctx: CanvasRenderingContext2D, st: StateMsg, dt: number) {
        for (const target of st.balls) {
            const ball = this.renderBalls[target.id] || { ...target };
            ball.x = smooth(ball.x, target.x, dt, 0.035);
            ball.y = smooth(ball.y, target.y, dt, 0.035);
            ball.vx = target.vx;
            ball.vy = target.vy;
            ball.spin = target.spin;
            ball.heldBy = target.heldBy;
            ball.live = target.live;
            ball.thrownBy = target.thrownBy;
            this.renderBalls[target.id] = ball;
            this.drawBall(ctx, ball);
        }
    }

    private drawBall(ctx: CanvasRenderingContext2D, ball: Ball) {
        const speed = Math.hypot(ball.vx, ball.vy);
        const hot = ball.live && speed > BALL_HIT_SPEED;
        ctx.save();
        ctx.translate(ball.x, ball.y);

        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.ellipse(4, 9, BALL_R * 1.15, BALL_R * 0.52, 0, 0, Math.PI * 2);
        ctx.fill();

        if (hot) {
            ctx.strokeStyle = 'rgba(255,60,40,0.35)';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.arc(0, 0, BALL_R + 7, 0, Math.PI * 2);
            ctx.stroke();
        }

        const g = ctx.createRadialGradient(-5, -6, 1, 1, 2, BALL_R * 1.2);
        g.addColorStop(0, '#ffb1a5');
        g.addColorStop(0.4, '#d93527');
        g.addColorStop(1, '#7c130e');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
        ctx.fill();

        ctx.rotate(ball.spin);
        ctx.strokeStyle = 'rgba(255,238,224,0.86)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, BALL_R * 0.68, -1.2, 1.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, BALL_R * 0.68, Math.PI - 1.2, Math.PI + 1.2);
        ctx.stroke();
        ctx.restore();
    }

    private drawHud(ctx: CanvasRenderingContext2D, st: StateMsg, w: number, h: number) {
        const me = st.players[this.myId];
        ctx.save();
        this.drawCourtScoreHud(ctx, st, w);
        this.drawSidelineStatus(ctx, me, w, h);
        this.drawCourtFeed(ctx, st, w);
        if (st.phase === 'countdown') this.centerText(ctx, String(Math.ceil(Math.max(0, st.t))), w / 2, h / 2, 88, '#fff4d8');
        if (st.phase === 'ended') this.drawEnd(ctx, st, w, h);
        ctx.restore();
    }

    private drawCourtScoreHud(ctx: CanvasRenderingContext2D, st: StateMsg, screenW: number) {
        const w = Math.min(560, screenW - 36);
        const h = 72;
        const x = (screenW - w) / 2;
        const y = 16;
        const pulse = 0.5 + Math.sin(performance.now() * 0.004) * 0.5;
        const time = st.phase === 'countdown' ? Math.max(0, st.t).toFixed(1) : String(Math.max(0, Math.ceil(st.t)));

        ctx.save();
        ctx.fillStyle = 'rgba(44,24,10,0.20)';
        roundedRect(ctx, x + 5, y + 7, w - 10, h, 18);
        ctx.fill();

        const wood = ctx.createLinearGradient(x, y, x, y + h);
        wood.addColorStop(0, 'rgba(126,72,25,0.78)');
        wood.addColorStop(0.48, 'rgba(87,45,17,0.72)');
        wood.addColorStop(1, 'rgba(50,28,13,0.78)');
        ctx.fillStyle = wood;
        roundedRect(ctx, x, y, w, h, 18);
        ctx.fill();
        ctx.strokeStyle = `rgba(255,239,204,${0.38 + pulse * 0.16})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,239,204,0.10)';
        roundedRect(ctx, x + w / 2 - 72, y + 10, 144, 52, 15);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,239,204,0.22)';
        ctx.lineWidth = 1.4;
        ctx.stroke();

        const sideW = Math.max(72, Math.min(w * 0.32, (w - 178) / 2));
        this.drawCourtScoreSide(ctx, x + 14, y + 10, sideW, TEAM_COLORS[0], TEAM_NAMES[0], st.teamScore[0], false);
        this.drawCourtScoreSide(ctx, x + w - 14 - sideW, y + 10, sideW, TEAM_COLORS[1], TEAM_NAMES[1], st.teamScore[1], true);

        ctx.fillStyle = '#fff3d4';
        ctx.font = 'bold 30px Trebuchet MS, Verdana, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(time, x + w / 2, y + 32);
        ctx.font = 'bold 12px Trebuchet MS, Verdana, sans-serif';
        ctx.fillStyle = 'rgba(255,243,212,0.64)';
        ctx.fillText(`A ${SCORE_TO_WIN}`, x + w / 2, y + 53);
        ctx.strokeStyle = 'rgba(255,239,204,0.28)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + w / 2 - 70, y + 65);
        ctx.lineTo(x + w / 2 + 70, y + 65);
        ctx.stroke();
        ctx.restore();
    }

    private drawCourtScoreSide(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, color: string, label: string, score: number, right: boolean) {
        ctx.save();
        ctx.fillStyle = alpha(color, 0.38);
        roundedRect(ctx, x, y, w, 44, 13);
        ctx.fill();
        ctx.strokeStyle = alpha(color, 0.62);
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#fff6df';
        ctx.font = `bold ${w < 112 ? 25 : 30}px Trebuchet MS, Verdana, sans-serif`;
        ctx.textAlign = w < 112 ? 'center' : right ? 'right' : 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(score).padStart(2, '0'), w < 112 ? x + w / 2 : right ? x + w - 16 : x + 16, y + 22);
        if (w >= 112) {
            ctx.fillStyle = 'rgba(255,246,223,0.76)';
            ctx.font = 'bold 11px Trebuchet MS, Verdana, sans-serif';
            ctx.fillText(label.toUpperCase(), right ? x + w - 62 : x + 62, y + 24);
        }
        ctx.restore();
    }

    private actionStatus(me: DodgePlayer | undefined): { label: string; progress: number; color: string; hint: string } {
        if (!me) return { label: 'Entra in campo', progress: 0, color: '#8d8c85', hint: 'attesa' };
        if (me.bench > 0) return { label: `Panchina ${me.bench.toFixed(1)}s`, progress: 1 - clamp(me.bench / 3.2, 0, 1), color: '#9b9a93', hint: 'rientro' };
        if (me.hasBall !== null) return { label: 'Carica tiro', progress: clamp(me.charge / CHARGE_TIME, 0, 1), color: me.color, hint: 'tieni e rilascia' };
        if (me.catchWindow > 0) return { label: 'Presa al volo', progress: clamp(me.catchWindow / CATCH_WINDOW_TIME, 0, 1), color: '#8ef7ff', hint: 'timing stretto' };
        if (me.catchCooldown > 0) return { label: `Presa ${me.catchCooldown.toFixed(1)}s`, progress: 1 - clamp(me.catchCooldown / CATCH_COOLDOWN, 0, 1), color: '#8ef7ff', hint: 'mani in reset' };
        if (me.dodgeCooldown > 0) return { label: `Schivata ${me.dodgeCooldown.toFixed(1)}s`, progress: 1 - clamp(me.dodgeCooldown / DIVE_COOLDOWN, 0, 1), color: '#f0a23a', hint: 'recupero' };
        return { label: 'Pronto', progress: 1, color: me.color, hint: 'click sulla palla in arrivo' };
    }

    private drawSidelineStatus(ctx: CanvasRenderingContext2D, me: DodgePlayer | undefined, screenW: number, screenH: number) {
        if (!me) return;
        const status = this.actionStatus(me);
        const w = Math.min(560, screenW - 36);
        const h = 54;
        const x = (screenW - w) / 2;
        const y = screenH - h - 18;
        const compact = w < 450;

        ctx.save();
        ctx.fillStyle = 'rgba(47,25,9,0.18)';
        roundedRect(ctx, x + 5, y + 7, w - 10, h, 16);
        ctx.fill();

        const panel = ctx.createLinearGradient(x, y, x, y + h);
        panel.addColorStop(0, 'rgba(112,62,20,0.62)');
        panel.addColorStop(1, 'rgba(58,31,13,0.66)');
        ctx.fillStyle = panel;
        roundedRect(ctx, x, y, w, h, 16);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,238,201,0.34)';
        ctx.lineWidth = 1.6;
        ctx.stroke();

        ctx.fillStyle = '#fff0cf';
        ctx.font = `bold ${compact ? 14 : 17}px Trebuchet MS, Verdana, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(status.label, x + 18, y + (compact ? 15 : 19));
        ctx.fillStyle = 'rgba(255,240,207,0.62)';
        ctx.font = 'bold 11px Trebuchet MS, Verdana, sans-serif';
        if (!compact) ctx.fillText(status.hint.toUpperCase(), x + 20, y + 38);

        if (compact) this.drawSidelineMeter(ctx, x + 16, y + 30, w - 32, 14, status);
        else this.drawSidelineMeter(ctx, x + 190, y + 14, w - 212, 26, status);
        ctx.restore();
    }

    private drawSidelineMeter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, status: { progress: number; color: string }) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,238,201,0.10)';
        roundedRect(ctx, x, y, w, h, 12);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,238,201,0.18)';
        ctx.lineWidth = 1.4;
        ctx.stroke();

        ctx.save();
        roundedRect(ctx, x, y, w, h, 12);
        ctx.clip();
        const fillW = w * clamp(status.progress, 0, 1);
        const g = ctx.createLinearGradient(x, y, x + w, y);
        g.addColorStop(0, alpha(status.color, 0.24));
        g.addColorStop(0.7, alpha(status.color, 0.62));
        g.addColorStop(1, alpha(status.color, 0.84));
        ctx.fillStyle = g;
        roundedRect(ctx, x, y, fillW, h, 12);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,247,224,0.18)';
        roundedRect(ctx, x, y + 3, Math.max(0, fillW - 5), Math.max(2, h * 0.28), 8);
        ctx.fill();
        ctx.restore();

        const knobX = x + w * clamp(status.progress, 0, 1);
        ctx.fillStyle = 'rgba(255,246,220,0.86)';
        ctx.beginPath();
        ctx.arc(knobX, y + h / 2, Math.min(6, h * 0.32), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    private drawCourtFeed(ctx: CanvasRenderingContext2D, st: StateMsg, screenW: number) {
        const w = Math.min(360, screenW - 36);
        const x = 18;
        const y = 98;
        ctx.save();
        ctx.fillStyle = 'rgba(89,47,17,0.34)';
        ctx.strokeStyle = 'rgba(255,238,201,0.20)';
        ctx.lineWidth = 1.2;
        roundedRect(ctx, x, y, w, 34, 12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffe5b8';
        ctx.font = 'bold 13px Trebuchet MS, Verdana, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(st.note.slice(0, 48), x + 14, y + 17);
        ctx.restore();
    }

    private drawEnd(ctx: CanvasRenderingContext2D, st: StateMsg, w: number, h: number) {
        ctx.fillStyle = 'rgba(35,19,8,0.78)';
        ctx.fillRect(0, 0, w, h);
        const winner = st.winnerTeam;
        const color = winner === null ? '#fff4d8' : TEAM_COLORS[winner];
        const panelW = Math.min(620, w - 42);
        const panelH = 190;
        const x = (w - panelW) / 2;
        const y = h / 2 - panelH / 2;
        const pulse = 0.5 + Math.sin(performance.now() * 0.006) * 0.5;

        ctx.save();
        const glow = ctx.createRadialGradient(w / 2, h / 2, 30, w / 2, h / 2, panelW * 0.7);
        glow.addColorStop(0, alpha(color, 0.30));
        glow.addColorStop(1, 'rgba(255,244,216,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = 'rgba(92,48,17,0.74)';
        roundedRect(ctx, x + 8, y + 10, panelW - 16, panelH, 26);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,238,201,0.12)';
        roundedRect(ctx, x, y, panelW, panelH, 26);
        ctx.fill();
        ctx.strokeStyle = alpha(color, 0.46 + pulse * 0.22);
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff4d8';
        ctx.font = 'bold 20px Trebuchet MS, Verdana, sans-serif';
        ctx.fillText('PARTITA CHIUSA', w / 2, y + 40);
        ctx.fillStyle = color;
        ctx.font = 'bold 48px Trebuchet MS, Verdana, sans-serif';
        ctx.fillText(winner === null ? 'Pareggio' : `Squadra ${TEAM_NAMES[winner]}`, w / 2, y + 94);
        ctx.fillStyle = '#fff4d8';
        ctx.font = 'bold 34px Trebuchet MS, Verdana, sans-serif';
        ctx.fillText(`${st.teamScore[0]} - ${st.teamScore[1]}`, w / 2, y + 144);
        ctx.fillStyle = 'rgba(255,244,216,0.68)';
        ctx.font = 'bold 13px Trebuchet MS, Verdana, sans-serif';
        ctx.fillText(st.note.toUpperCase().slice(0, 64), w / 2, y + 170);
        ctx.restore();
    }

    private centerText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.font = `bold ${size}px Trebuchet MS, Verdana, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 18;
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    private handleEvents(events: GameEvent[]) {
        for (const ev of events) {
            if (ev.kind === 'throw') this.burst(ev.x, ev.y, TEAM_COLORS[ev.team], 10, 240, 0.28);
            else if (ev.kind === 'hit') this.burst(ev.x, ev.y, '#fff06a', 24, 430, 0.55);
            else if (ev.kind === 'catch') this.burst(ev.x, ev.y, '#8ef7ff', 20, 300, 0.5);
            else if (ev.kind === 'pickup') this.burst(ev.x, ev.y, '#ffffff', 8, 170, 0.25);
            else if (ev.kind === 'dive') this.burst(ev.x, ev.y, '#d6ecff', 14, 260, 0.35);
            else if (ev.kind === 'wall') this.burst(ev.x, ev.y, '#ffb09b', 7, 210, 0.22);
        }
    }

    private burst(x: number, y: number, color: string, count: number, speed: number, life: number) {
        for (let i = 0; i < count; i++) {
            const a = rand(0, Math.PI * 2);
            const s = rand(speed * 0.35, speed);
            this.particles.push({
                x,
                y,
                vx: Math.cos(a) * s,
                vy: Math.sin(a) * s,
                life,
                maxLife: life,
                size: rand(3, 7),
                color,
            });
        }
    }

    private updateAndDrawParticles(ctx: CanvasRenderingContext2D, dt: number) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vx *= Math.pow(0.08, dt);
            p.vy *= Math.pow(0.08, dt);
            p.life -= dt;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }
            const k = p.life / p.maxLife;
            ctx.fillStyle = alpha(p.color, k);
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (0.35 + k), 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}
