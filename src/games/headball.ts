import { getCollisionSide } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer } from './game';
import { UserInput } from '../client/user-input';

// ═══════════════════════════════════════════════════════════════
//  COSTANTI
//  Tutte le misure sono in pixel virtuali; il client scala in base alla risoluzione.
// ═══════════════════════════════════════════════════════════════

// Campo e porte.
const CW  = 1000;
const CH  = 500;
const GY  = 348;
const GW  = 75;
const GTY = 72;
const GPT = 10;

// Hitbox giocatore.
const PW = 68;
const PH = 96;

// Fisica palla (tuning per traiettoria più "morbida" rispetto al player).
const BR      = 22;
const B_GRAV  = 1900;
const B_BSX   = 0.88;
const B_BTY   = 0.98;
const B_BGR   = 0.82;
const B_FRIC  = 0.988;
const B_VSTOP = 18;
const B_KVX   = 320;
const B_KVY   = -480;

// Fisica player (gravità più alta per reattività).
const P_SPEED  = 390;
const P_JUMP_V = -1180;
const P_GRAV   = 3600;

// Durate (ms). Countdown breve, partita compatta, pausa post-goal per feedback visivo.
const CD_MS          = 3000;
const MATCH_MS       = 90000;
const GOAL_PAUSE_MS  = 2000;
const RESULT_EXIT_MS = 2500;

// Goal animation (feedback visivo e uditivo quando segna).
const SLOWMO_DURATION     = 500;     // Rallenta il tempo per 0.5s
const GOAL_TEXT_DURATION  = 2000;    // Durata animazione testo GOAL!
const MENU_BUTTON_DELAY   = 3000;    // Tasto "Gioca!" attivo dopo 3s
const CAMERA_ZOOM_SCALE   = 1.3;     // Zoom massimo (1.3x)
const CAMERA_SHAKE_INTENS = 8;       // Intensità shake camera
const PARTICLE_COUNT      = 40;      // Numero confetti
const PARTICLE_LIFETIME   = 2000;    // Durata particelle

// Teleport.
const TP_CD_MS = 15000;

// Powerup bolla (spawn fisso, ICE = debuff, BIG HEAD = buff).
const BUBBLE_SPAWN_MS = 15000;
const BUBBLE_RADIUS   = 20;
const ICE_DUR_MS      = 3000;
const BH_DUR_MS       = 5000;
const BH_HEAD_MULT    = 1.6;

// Fallback server-side per ID di personaggio non validi.
const DEF_CHAR = 'classic';

// Palette personaggi (id + colori UI).
const CHARS = [
    { id: 'classic', name: 'Classic', accent: '#00d8ff', jersey: '#006dff', trim: '#ffffff' },
    { id: 'wizard',  name: 'Wizard',  accent: '#ffcf33', jersey: '#8b5cf6', trim: '#ffe680' },
    { id: 'ninja',   name: 'Ninja',   accent: '#28ff88', jersey: '#00a84f', trim: '#edfff5' },
];

// Lookup veloce degli id validi.
const CHAR_IDS = new Set(CHARS.map(c => c.id));

// ═══════════════════════════════════════════════════════════════
//  TIPI
// ═══════════════════════════════════════════════════════════════

type Seat        = 0 | 1;

type Phase       = 'selection' | 'countdown' | 'playing' | 'finished';

type PowerupType = 'ice' | 'bighead';

// Particella per effetto confetti al goal.
interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    lifetime: number;      // Tempo rimanente (ms)
    maxLifetime: number;   // Durata totale (ms)
    rotation: number;      // Rotazione in radianti
    rotVel: number;        // Velocità di rotazione
}

interface Inp {
    moveX:    number;
    jump:     boolean;
    teleport: boolean;
}

interface Sel  { characterId: string; confirmed: boolean; }

interface Ball { x: number; y: number; vx: number; vy: number; }

interface Bubble { x: number; y: number; type: PowerupType; }

interface Ply {
    seat:        Seat;
    characterId: string;
    x: number; y: number;
    vx: number; vy: number;
    w: number; h: number;
    dir: number;
    onGround:  boolean;
    jumpHeld:  boolean;  // edge detection salto
    djUsed:    boolean;  // doppio salto consumato
    tpHeld:    boolean;
    inp:       Inp;
    tpCdMs:    number;
    frozenMs:  number;
    bigHeadMs: number;
}

// ═══════════════════════════════════════════════════════════════
//  FUNZIONI DI SUPPORTO (factory e utility)
// ═══════════════════════════════════════════════════════════════

// clamp: limita un valore nell'intervallo [lo, hi].
const clamp  = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// safeId: valida l'id inviato dal client e applica un fallback server-side.
const safeId = (id: unknown): string =>
    (typeof id === 'string' && CHAR_IDS.has(id.trim())) ? id.trim() : DEF_CHAR;

/**
 * mkInp: input iniziale (nessun tasto premuto).
 */
function mkInp(): Inp {
    return { moveX: 0, jump: false, teleport: false };
}

/**
 * mkBall: palla al centro con kickoff nella direzione di dir (-1/0/+1).
 */
function mkBall(dir = 0): Ball {
    return { x: CW / 2, y: GY - 160, vx: B_KVX * dir, vy: dir !== 0 ? B_KVY : 0 };
}

/**
 * mkPlayer: spawna il giocatore nel lato relativo al seat con timer azzerati.
 */
function mkPlayer(seat: Seat, charId: string): Ply {
    return {
        seat, characterId: charId,
        // Posizione iniziale: seat 0 parte a sinistra, seat 1 a destra
        x: seat === 0 ? 110 : CW - 110 - PW,
        y: GY - PH,       // posizionato appena sopra il suolo
        vx: 0, vy: 0, w: PW, h: PH,
        dir: seat === 0 ? 1 : -1,  // guarda verso il centro del campo
        onGround: true, jumpHeld: false, djUsed: false, tpHeld: false,
        inp: mkInp(),
        // Tutti i timer a zero: nessun effetto attivo, teleport subito disponibile
        tpCdMs: 0, frozenMs: 0, bigHeadMs: 0,
    };
}

/**
 * mkBubble: spawn 50/50 ICE/BIGHEAD in una zona sicura del campo.
 */
function mkBubble(): Bubble {
    // Sceglie il tipo con probabilità 50%
    const type: PowerupType = Math.random() < 0.5 ? 'ice' : 'bighead';
    // X casuale al centro del campo, lontana dalle porte e dai bordi
    const x = GW + 100 + Math.random() * (CW - GW * 2 - 200);
    // Y casuale tra la traversa e il suolo, con un margine
    const y = GTY + 60  + Math.random() * (GY - GTY - 120);
    return { x, y, type };
}

// ═══════════════════════════════════════════════════════════════
//  COLLISIONI
//  Queste funzioni gestiscono i rimbalzi e le collisioni della palla.
// ═══════════════════════════════════════════════════════════════

/**
 * ballVsRect: rimbalzo palla contro rettangolo (pali/traversa).
 * Usa getCollisionSide sul bounding box per riflettere la velocità sul lato impattato.
 */
function ballVsRect(b: Ball, r: { x: number; y: number; w: number; h: number }): boolean {
    const br   = { x: b.x - BR, y: b.y - BR, w: BR * 2, h: BR * 2 };
    const side = getCollisionSide(br, r);

    if (side === 'none') return false;

    if (side === 'top')    { b.y = r.y - BR;       b.vy = -Math.abs(b.vy) * B_BTY; }
    if (side === 'bottom') { b.y = r.y + r.h + BR; b.vy =  Math.abs(b.vy) * B_BTY; }
    if (side === 'left')   { b.x = r.x - BR;       b.vx = -Math.abs(b.vx) * B_BSX; }
    if (side === 'right')  { b.x = r.x + r.w + BR; b.vx =  Math.abs(b.vx) * B_BSX; }
    return true;
}

/**
 * ballVsPlayer: collisione testa/piede con priorità alla testa.
 * headRadius permette di allineare fisica e grafica (Big Head).
 * Impone una velocità minima per evitare colpi troppo deboli.
 */
function ballVsPlayer(b: Ball, p: Ply, headRadius: number): void {
    const cx = p.x + p.w / 2;

    const headCenterY = p.y + p.h * 0.35;
    const dxH = b.x - cx;
    const dyH = b.y - headCenterY;
    const distHead = Math.sqrt(dxH * dxH + dyH * dyH);
    const hitHead  = distHead < headRadius + BR;

    // Piede controllato solo se la testa non ha già colpito.
    const footRadius   = p.w * 0.20;
    const footCenterY  = p.y + p.h * 0.88;
    const dxF = b.x - cx;
    const dyF = b.y - footCenterY;
    const distFoot = Math.sqrt(dxF * dxF + dyF * dyF);
    const hitFoot  = !hitHead && distFoot < footRadius + BR;

    if (!hitHead && !hitFoot) return;

    const playerDir = p.seat === 0 ? 1 : -1;
    const currentSpeed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);

    if (hitHead) {
        const safeD = Math.max(distHead, 0.001);
        const nx = dxH / safeD;
        const ny = dyH / safeD;
        const newSpeed = clamp(Math.max(560, currentSpeed), 560, 880);

        b.vx = clamp(nx * newSpeed * 0.50 + playerDir * 0.18 * newSpeed + p.vx * 0.15, -700, 700);
        b.vy = clamp(Math.min(ny * newSpeed * 0.50 + (ny < -0.3 ? -920 : -800), -640), -1050, -640);

        b.x += nx * (headRadius + BR - distHead);
        b.y += ny * (headRadius + BR - distHead);
    } else {
        const safeD = Math.max(distFoot, 0.001);
        const nx = dxF / safeD;
        const ny = dyF / safeD;

        const newSpeed = clamp(Math.max(600, currentSpeed * 1.15), 600, 1000);
        b.vx = clamp(nx * newSpeed * 0.90 + playerDir * newSpeed * 0.25 + p.vx * 0.25, -1000, 1000);
        b.vy = clamp(Math.min(ny * newSpeed * 0.5 - 480, -350), -850, -350);

        b.x += nx * (footRadius + BR - distFoot);
        b.y += ny * (footRadius + BR - distFoot);
    }
}

/**
 * ballVsGoalFrame: rimbalzi su palo interno e traversa.
 * Il palo frontale è "aperto" per permettere l'ingresso in porta.
 */
function ballVsGoalFrame(b: Ball, goalX: number, isLeft: boolean): void {
    const goalH = GY - GTY;
    const backX = isLeft ? goalX : goalX + GW - GPT;
    ballVsRect(b, { x: backX, y: GTY, w: GPT, h: goalH });
    ballVsRect(b, { x: goalX, y: GTY, w: GW,  h: GPT  });
}

// ═══════════════════════════════════════════════════════════════
//  SERVER
//  Authoritative: input → fase → fisica → snapshot.
// ═══════════════════════════════════════════════════════════════

export class HeadBallServer extends GameServer {

    private phase:  Phase = 'selection';

    private players: Record<string, Ply> = {};

    private order:   string[] = [];

    private sels:    Sel[] = [
        { characterId: DEF_CHAR, confirmed: false },
        { characterId: DEF_CHAR, confirmed: false },
    ];

    private ball:   Ball   = mkBall();

    private score          = { left: 0, right: 0 };

    private timeMs         = MATCH_MS;

    private cdMs           = CD_MS;

    private winner: 'left' | 'right' | 'draw' | null = null;

    private bubble:        Bubble | null = null;

    private bubbleSpawnMs: number = BUBBLE_SPAWN_MS;
    // Pausa temporanea post-goal (blocca fisica e timer).
    private goalPauseMs: number = 0;
    // Evento goal da segnalare al client (pulito dopo l'invio nello snapshot).
    private goalEvent: { scorer: Seat } | null = null;

    // ── Lifecycle (metodi chiamati dal framework) ────────────────────────────

    /** init: reset stato iniziale partita. */
    init(players: Record<string, any>): void {
        this.order  = Object.keys(players);
        this.phase  = 'selection';
        this.score  = { left: 0, right: 0 };
        this.winner = null;
        this.sels   = [
            { characterId: DEF_CHAR, confirmed: false },
            { characterId: DEF_CHAR, confirmed: false },
        ];
        this.order.forEach((id, i) => { this.players[id] = mkPlayer(i as Seat, DEF_CHAR); });
        this.ball          = mkBall();
        this.bubble        = null;
        this.bubbleSpawnMs = BUBBLE_SPAWN_MS;
        this.goalPauseMs   = 0;
        this.goalEvent     = null;
    }

    /** tick: loop server (input → fase → snapshot). */
    tick(msgs: IncomingMsg[], dt: number): OutgoingMsg[] {
        this.processMessages(msgs);
        this.updatePhase(dt);
        return [{ payload: this.buildSnapshot() }];
    }

    /** isFinished: il framework chiude il game loop quando la partita è finita. */
    isFinished(): boolean {
        return this.phase === 'finished';
    }

    // ── Elaborazione messaggi in arrivo dai client ────────────────────────────

    /**
     * processMessages: applica input e selezione validando i dati client.
     * selection → countdown solo quando entrambi confermano.
     */
    private processMessages(msgs: IncomingMsg[]): void {
        for (const msg of msgs) {
            const p   = this.players[msg.clientId];
            if (!p) continue;

            const pay  = msg.payload;
            const seat = p.seat;

            if (pay.kind === 'input' && this.phase === 'playing') {
                p.inp = {
                    moveX:    typeof pay.moveX    === 'number'  ? clamp(pay.moveX, -1, 1) : p.inp.moveX,
                    jump:     typeof pay.jump     === 'boolean' ? pay.jump     : p.inp.jump,
                    teleport: typeof pay.teleport === 'boolean' ? pay.teleport : p.inp.teleport,
                };
            }

            if (pay.kind === 'selection:update' && this.phase === 'selection' && !this.sels[seat].confirmed) {
                this.sels[seat].characterId = safeId(pay.characterId);
            }

            if (pay.kind === 'selection:confirm' && this.phase === 'selection' && !this.sels[seat].confirmed) {
                this.sels[seat].characterId = safeId(pay.characterId ?? this.sels[seat].characterId);
                this.sels[seat].confirmed   = true;
                if (this.sels[0].confirmed && this.sels[1].confirmed) this.goCountdown();
            }
        }
    }

    // ── Gestione delle transizioni di fase ──────────────────────────────────

    /** updatePhase: gestisce countdown, match timer e pausa post-goal. */
    private updatePhase(dt: number): void {
        if (this.phase === 'countdown') {
            this.cdMs -= dt * 1000;
            if (this.cdMs <= 0) this.goPlaying();
        }
        if (this.phase === 'playing') {
            if (this.goalPauseMs > 0) {
                this.goalPauseMs = Math.max(0, this.goalPauseMs - dt * 1000);
                return; // pausa post-goal: blocca fisica e timer partita
            }
            this.timeMs -= dt * 1000;
            if (this.timeMs <= 0) this.goFinished();
            else                  this.physics(dt);
        }
    }

    /** goCountdown: reset stato e avvia il countdown. */
    private goCountdown(): void {
        this.phase  = 'countdown';
        this.cdMs   = CD_MS;
        this.score  = { left: 0, right: 0 };
        this.winner = null;
        this.ball   = mkBall();
        this.bubble = null;
        this.bubbleSpawnMs = BUBBLE_SPAWN_MS;
        this.goalPauseMs = 0;
        this.order.forEach((id, i) => { this.players[id] = mkPlayer(i as Seat, this.sels[i].characterId); });
    }

    /** goPlaying: avvia la partita con kickoff casuale. */
    private goPlaying(): void {
        this.phase  = 'playing';
        this.timeMs = MATCH_MS;
        this.ball   = mkBall(Math.random() < 0.5 ? -1 : 1);
        this.goalPauseMs = 0;
        this.order.forEach((id, i) => { this.players[id] = mkPlayer(i as Seat, this.sels[i].characterId); });
    }

    /**
     * resetAfterGoal: reset posizioni, kickoff verso chi ha subito il gol.
     * I timer degli effetti restano attivi e parte la pausa post-goal.
     */
    private resetAfterGoal(scoringSeat: Seat): void {
        this.ball = mkBall(scoringSeat === 0 ? -1 : 1);

        this.order.forEach((id, i) => {
            const prev = this.players[this.order[i]];

            const savedTpCooldown = prev?.tpCdMs    ?? 0;
            const savedTpHeld     = prev?.tpHeld    ?? false;
            const savedBigHead    = prev?.bigHeadMs ?? 0;
            const savedFrozen     = prev?.frozenMs  ?? 0;

            this.players[this.order[i]] = mkPlayer(i as Seat, this.sels[i].characterId);

            this.players[this.order[i]].tpCdMs    = savedTpCooldown;
            this.players[this.order[i]].tpHeld    = savedTpHeld;
            this.players[this.order[i]].bigHeadMs = savedBigHead;
            this.players[this.order[i]].frozenMs  = savedFrozen;
        });
        this.goalPauseMs = GOAL_PAUSE_MS;
        this.goalEvent   = { scorer: scoringSeat };
    }

    /** goFinished: calcola il vincitore e chiude la partita. */
    private goFinished(): void {
        this.phase  = 'finished';
        this.winner = this.score.left > this.score.right ? 'left'
                    : this.score.right > this.score.left ? 'right'
                    : 'draw';
    }

    // ── Motore fisico ────────────────────────────────────────────────────────

    /** physics: aggiorna player, palla e bolle (solo in fase playing). */
    private physics(dt: number): void {
        const dtMs = dt * 1000;

        ([0, 1] as Seat[]).forEach(seat => {
            const p = this.players[this.order[seat]];
            if (!p) return;

            p.tpCdMs   = Math.max(0, p.tpCdMs   - dtMs);
            p.frozenMs  = Math.max(0, p.frozenMs  - dtMs);
            p.bigHeadMs = Math.max(0, p.bigHeadMs - dtMs);

            // Congelato: solo gravità, niente input.
            if (p.frozenMs > 0) {
                p.vx  = 0;
                p.vy += P_GRAV * dt;
                p.y  += p.vy * dt;
                if (p.y >= GY - p.h) { p.y = GY - p.h; p.vy = 0; }
                return;
            }

            this.applyInput(p, dt);

            p.vy += P_GRAV * dt;
            p.x  += p.vx * dt;
            p.y  += p.vy * dt;

            if (p.y >= GY - p.h) {
                p.y = GY - p.h;
                p.vy = 0;
                p.onGround = true;
                p.djUsed   = false; // reset doppio salto su atterraggio
            } else {
                p.onGround = false;
            }

            if (p.y < 0) { p.y = 0; if (p.vy < 0) p.vy = 0; }

            if (p.x < GW)           { p.x = GW;           p.vx = 0; }
            if (p.x > CW - GW - PW) { p.x = CW - GW - PW; p.vx = 0; }
        });

        this.updateBall(dt);
        this.updateBubble(dt);
    }

    /**
     * applyInput: movimento, salto (edge detection) e teleport.
     * Il teleport posiziona il player tra sé e la palla e clampa ai bordi.
     */
    private applyInput(p: Ply, dt: number): void {
        const inp = p.inp;

        p.vx = inp.moveX * P_SPEED;
        if (inp.moveX !== 0) p.dir = inp.moveX > 0 ? 1 : -1;

        if (inp.jump && !p.jumpHeld) {
            if (p.onGround) {
                p.vy = P_JUMP_V;
                p.onGround = false;
                p.djUsed   = false;
            } else if (!p.djUsed) {
                p.vy     = P_JUMP_V;
                p.djUsed = true;
            }
        }
        p.jumpHeld = inp.jump;

        if (inp.teleport && !p.tpHeld && p.tpCdMs <= 0) {
            const offset = BR + p.w / 2 + 8;
            const destinazioneX  = p.seat === 0
                ? this.ball.x - offset - p.w / 2
                : this.ball.x + offset - p.w / 2;

            p.x      = clamp(destinazioneX, GW, CW - GW - p.w);
            p.y      = clamp(this.ball.y - p.h / 2, 0, GY - p.h);
            p.vx     = 0;
            p.vy     = 0;
            p.tpCdMs = TP_CD_MS;
        }
        p.tpHeld = inp.teleport;
    }

    // ── Fisica della palla ──────────────────────────────────────────────────

    /**
     * updateBall: integra la fisica della palla e gestisce goal/collisioni.
     * Ordine: integrazione → goal → rimbalzi → collisioni player/porta.
     */
    private updateBall(dt: number): void {
        const b = this.ball;

        b.vy += B_GRAV * dt;
        b.x  += b.vx * dt;
        b.y  += b.vy * dt;

        // Goal: usa il centro della palla e limita l'altezza alla zona porta.
        const inGoalZone = b.y > GTY + GPT && b.y < GY;

        if (b.x < GW && inGoalZone) {
            this.score.right += 1; this.resetAfterGoal(1); return;
        }
        if (b.x > CW - GW && inGoalZone) {
            this.score.left  += 1; this.resetAfterGoal(0); return;
        }

        if (b.x - BR <= 0 && !inGoalZone)  { b.x = BR;       b.vx =  Math.abs(b.vx) * B_BSX; }
        if (b.x + BR >= CW && !inGoalZone) { b.x = CW - BR;  b.vx = -Math.abs(b.vx) * B_BSX; }
        if (b.y - BR <= 0) { b.y = BR; b.vy = Math.abs(b.vy) * B_BTY; }

        if (b.y + BR >= GY) {
            b.y   = GY - BR;
            b.vy *= -B_BGR;

            if (Math.abs(b.vy) < B_VSTOP) b.vy = 0;

            b.vx *= Math.pow(B_FRIC, dt * 60);
        }

        ([0, 1] as Seat[]).forEach(seat => {
            const p = this.players[this.order[seat]];
            if (!p) return;
            const headR = p.w * 0.48 * (p.bigHeadMs > 0 ? BH_HEAD_MULT : 1);
            ballVsPlayer(b, p, headR);
        });

        if (!inGoalZone) {
            ballVsGoalFrame(b, 0, true);
            ballVsGoalFrame(b, CW - GW, false);
        }
    }

    // ── Bolle superpotere ────────────────────────────────────────────────────

    /**
     * updateBubble: spawn e raccolta powerup (AABB circle test).
     * Un solo pickup per tick per evitare doppie raccolte.
     */
    private updateBubble(dt: number): void {
        const dtMs = dt * 1000;

        if (this.bubble === null) {
            this.bubbleSpawnMs -= dtMs;
            if (this.bubbleSpawnMs <= 0) {
                this.bubble = mkBubble();
            }
            return;
        }

        const bub = this.bubble;
        for (const seat of [0, 1] as Seat[]) {
            const p = this.players[this.order[seat]];
            if (!p) continue;

            const puntoVicinoX = clamp(bub.x, p.x, p.x + p.w);
            const puntoVicinoY = clamp(bub.y, p.y, p.y + p.h);

            const dx = bub.x - puntoVicinoX;
            const dy = bub.y - puntoVicinoY;

            if (dx * dx + dy * dy < BUBBLE_RADIUS * BUBBLE_RADIUS) {
                this.applyBubble(p, seat, bub.type);
                this.bubble        = null;
                this.bubbleSpawnMs = BUBBLE_SPAWN_MS;
                break;
            }
        }
    }

    /** applyBubble: ICE congela l'avversario, BIGHEAD potenzia il raccoglitore. */
    private applyBubble(p: Ply, seat: Seat, type: PowerupType): void {
        if (type === 'ice') {
            const avversarioId = this.order[1 - seat as Seat];
            if (avversarioId && this.players[avversarioId]) {
                this.players[avversarioId].frozenMs = ICE_DUR_MS;
            }
        } else {
            p.bigHeadMs = BH_DUR_MS;
        }
    }

    // ── Costruzione dello snapshot ──────────────────────────────────────────

    /**
     * buildSnapshot: pacchetto minimale per rendering client (no input privati).
     */
    private buildSnapshot(): object {
        const active = this.phase === 'playing' || this.phase === 'finished';
        const snapshot = {
            phase:   this.phase,
            score:   { ...this.score },
            timeMs:  Math.max(0, Math.round(this.phase === 'countdown' ? this.cdMs : this.timeMs)),
            ball:    active ? { ...this.ball } : null,
            players: this.order.map(id => {
                const p = this.players[id];
                return {
                    seat: p.seat, characterId: p.characterId,
                    x: p.x, y: p.y, w: p.w, h: p.h, dir: p.dir,
                    tpCdMs:    p.tpCdMs,
                    frozenMs:  p.frozenMs,
                    bigHeadMs: p.bigHeadMs,
                };
            }),
            bubble:        this.bubble ? { ...this.bubble } : null,
            bubbleSpawnMs: this.bubble ? 0 : Math.max(0, Math.round(this.bubbleSpawnMs)),
            sels:          this.sels.map(s => ({ ...s })),
            winner:        this.winner,
        };

        // Aggiungi goal event se presente e puliscilo per il prossimo tick.
        if (this.goalEvent) {
            (snapshot as any).goalEvent = this.goalEvent;
            this.goalEvent = null;
        }

        return snapshot;
    }
}

// ═══════════════════════════════════════════════════════════════
//  CLIENT
//  Rendering + input: tutta la logica resta sul server.
// ═══════════════════════════════════════════════════════════════

export class HeadBallClient extends GameClient {

    // ── Stato ricevuto dagli snapshot del server ──────────────────────────────
    private phase         = 'selection';
    private sPlayers:  any[]       = [];
    private ball:      any         = null;
    private score         = { left: 0, right: 0 };
    private timeMs        = MATCH_MS;
    private sels:      any[]       = [];
    private winner:    string|null = null;
    private mySeat        = -1;
    private bubble:    any         = null;
    private bubbleSpawnMs = BUBBLE_SPAWN_MS;
    // Timestamp (clock locale in secondi) in cui compare il risultato.
    private finishedAt: number | null = null;

    // ── Stato selezione personaggio ──────────────────────────────────────────
    private charIdx   = 0;
    private confirmed = false;

    // ── Stato input precedente (selezione) ────────────────────────────────────
    private prev        = { moveX: 0, jump: false, teleport: false };
    private prevSelX    = 0;
    private prevConfirm = false;

    // ── Tasti extra non gestiti da UserInput ──────────────────────────────────
    private keys: Record<string, boolean> = {};

    // ── Manuale di gioco ──────────────────────────────────────────────────────
    private showManual = true;

    // ── Animazione goal ───────────────────────────────────────────────────────
    private goalScoredAt: number | null = null;    // Clock quando segna
    private goalScorer: Seat | null = null;        // Chi ha segnato (0=left, 1=right)
    private particles: Particle[] = [];             // Confetti attivi
    private isGoalAnimating = false;               // Lock durante animazione
    private goalSlowmoUntil = 0;                   // Clock fino a cui rallentare
    private goalShakeDecay = 0;                    // Decremento shake (ms rimanenti)
    private audioContext: AudioContext | null = null; // Web Audio

    private clock  = 0;
    private outbox: any[] = [];

    private fit = 1;
    private ox  = 0;
    private oy  = 0;

    /** Costruttore: registra input e click sul manuale. */
    constructor(ui: UserInput, myId: string) {
        super(ui, myId);
        this.registerKeys();
        this.registerManualClick(ui);
    }

    // Arrow function per mantenere lo stesso riferimento nei removeEventListener.
    private onKeyDown = (e: KeyboardEvent) => { if (!e.repeat) this.keys[e.code] = true;  };
    private onKeyUp   = (e: KeyboardEvent) => { this.keys[e.code] = false; };
    private onBlur    = ()  => { Object.keys(this.keys).forEach(k => { this.keys[k] = false; }); };

    /** registerKeys: listener tastiera + blur. */
    private registerKeys(): void {
        document.addEventListener('keydown', this.onKeyDown);
        document.addEventListener('keyup',   this.onKeyUp);
        window.addEventListener('blur',      this.onBlur);
    }

    /** cleanup: rimuove i listener per evitare leak. */
    cleanup(): void {
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup',   this.onKeyUp);
        window.removeEventListener('blur',      this.onBlur);
    }

    /**
     * registerManualClick: converte coordinate reali → virtuali per chiudere il manuale.
     */
    private registerManualClick(ui: UserInput): void {
        ui.canvas.addEventListener('click', (e) => {
            if (!this.showManual) return;  // se il manuale non è aperto, ignoriamo

            // Otteniamo la posizione del canvas nel DOM
            const bounds = ui.canvas.getBoundingClientRect();
            // Convertiamo le coordinate del click in pixel del canvas
            const rawX   = (e.clientX - bounds.left) * (ui.canvas.width  / bounds.width);
            const rawY   = (e.clientY - bounds.top)  * (ui.canvas.height / bounds.height);

            // Convertiamo da pixel canvas a coordinate virtuali
            // (invertiamo la trasformazione: scala + offset applicata in draw())
            const vx     = (rawX - this.ox) / this.fit;
            const vy     = (rawY - this.oy) / this.fit;

            // Area del pulsante "Gioca!" — deve essere IDENTICA a quella disegnata in drawManual()
            const bw = 180, bh = 48;
            const bx = CW / 2 - bw / 2, by = CH * 0.78;

            // Se il click è dentro l'area del pulsante → chiudiamo il manuale
            if (vx >= bx && vx <= bx + bw && vy >= by && vy <= by + bh) {
                this.showManual = false;
            }
        });
    }

    /** init: risolve il seat del client in base all'ordine dei player. */
    async init(players: Record<string, any>): Promise<void> {
        this.mySeat = Object.keys(players).indexOf(this.myId);
        return Promise.resolve();
    }

    // ── Ciclo principale ──────────────────────────────────────────────────────

    /**
     * draw: loop di rendering. Calcola scala, legge input e disegna i layer.
     */
    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        const { screenW, screenH } = this.userInput;

        this.fit = Math.min(screenW / CW, screenH / CH);
        this.ox  = (screenW - CW * this.fit) / 2;
        this.oy  = (screenH - CH * this.fit) / 2;
        this.clock += dt;

        // Aggiorna particelle e shake
        this.updateGoalParticles(dt);
        this.updateGoalShake();

        // Input bloccato finché il manuale è aperto.
        if (!this.showManual) this.readInput();

        ctx.fillStyle = '#07111c';
        ctx.fillRect(0, 0, screenW, screenH);

        ctx.save();
        ctx.translate(this.ox, this.oy);
        ctx.scale(this.fit, this.fit);

        // Applica effetti camera (zoom + shake)
        const { zoomScale, shakeX, shakeY } = this.computeGoalCameraEffects();
        ctx.translate(CW / 2, CH / 2);
        ctx.scale(zoomScale, zoomScale);
        ctx.translate(-CW / 2 + shakeX, -CH / 2 + shakeY);

        ctx.beginPath(); ctx.rect(0, 0, CW, CH); ctx.clip();

        this.drawBackground(ctx);
        this.drawPitch(ctx);

        if (this.phase !== 'waiting' && this.phase !== 'selection') {
            this.sPlayers.forEach(p => this.drawPlayer(ctx, p));
            if (this.ball)   this.drawBall(ctx, this.ball);
            if (this.bubble) this.drawBubble(ctx, this.bubble);
        }

        if (this.phase === 'countdown') this.drawCountdown(ctx);

        this.drawHUD(ctx);

        // Disegna particelle goal
        if (this.particles.length > 0) this.drawGoalParticles(ctx);

        if (this.phase === 'selection' || this.phase === 'waiting') this.drawSelection(ctx);
        if (this.phase === 'finished')                               this.drawResult(ctx);

        if (this.showManual) this.drawManual(ctx);

        // Disegna testo GOAL!
        if (this.goalScoredAt !== null && this.isGoalAnimating) {
            this.drawGoalText(ctx);
        }

        ctx.restore();
    }

    /**
     * handleMessage: aggiorna lo stato client usando snapshot server.
     */
    handleMessage(msg: any): void {
        if (!msg) return;
        if ('phase'         in msg) this.phase         = msg.phase;
        if ('score'         in msg) this.score         = msg.score;
        if ('timeMs'        in msg) this.timeMs        = msg.timeMs;
        if ('ball'          in msg) this.ball          = msg.ball;
        if ('players'       in msg) this.sPlayers      = msg.players;
        if ('sels'          in msg) this.sels          = msg.sels;
        if ('winner'        in msg) this.winner        = msg.winner;
        if ('bubble'        in msg) this.bubble        = msg.bubble;
        if ('bubbleSpawnMs' in msg) this.bubbleSpawnMs = msg.bubbleSpawnMs;

        // Evento goal: trigger animazione
        if ('goalEvent' in msg && msg.goalEvent) {
            this.onGoalScored(msg.goalEvent.scorer);
        }

        // Latch del momento in cui entriamo nella fase "finished".
        // Usare il clock locale evita dipendenze su timeMs del server (che arriva già a 0).
        const hasResult = this.phase === 'finished' && this.winner !== null;
        if (hasResult && this.finishedAt === null) this.finishedAt = this.clock;
        if (!hasResult) this.finishedAt = null;
    }

    /**
     * flushMessages: restituisce tutti i messaggi in coda e svuota la coda.
     * Viene chiamato dal framework per raccogliere i messaggi da inviare al server.
     * Lo spread [...this.outbox] crea una copia prima di svuotare l'originale.
     */
    flushMessages(): any[] {
        const out = [...this.outbox]; this.outbox = []; return out;
    }

    /**
     * isFinished: il client torna "finito" solo dopo aver mostrato il risultato.
     * Questo permette alla Lobby di chiudere il gioco e riportare il giocatore
     * alla schermata principale, senza troncare il feedback del vincitore.
     */
    isFinished(): boolean {
        if (this.phase !== 'finished' || this.finishedAt === null) return false;
        return (this.clock - this.finishedAt) * 1000 >= RESULT_EXIT_MS;
    }

    // ── Lettura input e invio messaggi al server ─────────────────────────────

    /** readInput: costruisce i messaggi input (selezione o gameplay). */
    private readInput(): void {
        const ui = this.userInput;
        const k  = this.keys;

        const moveX   = ui.moveDirectionX !== 0 ? ui.moveDirectionX
                      : k['ArrowLeft']  ? -1
                      : k['ArrowRight'] ?  1
                      : 0;
        const jump     = ui.moveDirectionY < 0 || k['ArrowUp'] === true;
        const moveDown = ui.moveDirectionY > 0 || k['ArrowDown'] === true;
        const confirm  = moveDown || k['Enter'] === true;

        if (this.phase === 'selection' && !this.confirmed) {
            // Edge detection per evitare scroll continuo.
            if (moveX !== this.prevSelX) {
                if (moveX > 0) {
                    this.charIdx = (this.charIdx + 1) % CHARS.length;
                    this.outbox.push({ kind: 'selection:update', characterId: CHARS[this.charIdx].id });
                } else if (moveX < 0) {
                    this.charIdx = (this.charIdx - 1 + CHARS.length) % CHARS.length;
                    this.outbox.push({ kind: 'selection:update', characterId: CHARS[this.charIdx].id });
                }
                this.prevSelX = moveX;
            }

            if (confirm && !this.prevConfirm) {
                this.confirmed = true;
                this.outbox.push({ kind: 'selection:confirm', characterId: CHARS[this.charIdx].id });
            }
            this.prevConfirm = confirm;
            return;
        }

        if (this.phase === 'playing') {
            const cur = {
                moveX,
                jump,
                teleport: k['KeyF'] === true,
            };
            // Invio per frame: evita di perdere input brevi.
            this.outbox.push({ kind: 'input', ...cur });
            this.prev = { ...cur };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  GRAFICA
    //  Tutte le funzioni qui sotto disegnano le varie parti del gioco.
    //  Tutte le misure sono proporzionali a CW/CH o a p.w/p.h
    //  → il gioco si vede bene a qualsiasi risoluzione.
    // ═══════════════════════════════════════════════════════════════

    /** drawBackground: cielo, prato e nuvole animate. */
    private drawBackground(ctx: CanvasRenderingContext2D): void {
        ctx.fillStyle = '#68c8ff'; ctx.fillRect(0, 0, CW, GY);
        ctx.fillStyle = '#239c3d'; ctx.fillRect(0, GY, CW, CH - GY);
        ctx.fillStyle = '#126d2b'; ctx.fillRect(0, GY, CW, 7);

        ctx.save();
        const clouds = [
            { x: 140, y: 60,  s: 1.00, sp: 0.22 },
            { x: 390, y: 48,  s: 1.18, sp: 0.18 },
            { x: 760, y: 62,  s: 0.95, sp: 0.15 },
        ];
        clouds.forEach(c => {
            const x = ((c.x + this.clock * c.sp * 18) % (CW + 100)) - 50;
            ctx.globalAlpha = 0.30;
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.ellipse(x,          c.y,        46*c.s, 18*c.s, 0, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(x+28*c.s,   c.y-8*c.s,  32*c.s, 14*c.s, 0, 0, Math.PI*2); ctx.fill();
        });
        ctx.restore();
    }

    /** drawPitch: linea centrale tratteggiata e due porte. */
    private drawPitch(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.beginPath(); ctx.moveTo(CW/2, GTY); ctx.lineTo(CW/2, GY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        this.drawGoal(ctx, 0,       true);
        this.drawGoal(ctx, CW - GW, false);
    }

    /** drawGoal: porta con rete + pali. */
    private drawGoal(ctx: CanvasRenderingContext2D, gx: number, isLeft: boolean): void {
        const goalH  = GY - GTY;
        const T      = GPT;
        const frontX = isLeft ? gx + GW - T : gx;
        const backX  = isLeft ? gx          : gx + GW - T;
        const netX   = isLeft ? backX + T   : frontX + T;
        const netW   = GW - T * 2;

        ctx.fillStyle = 'rgba(160,200,240,0.10)'; ctx.fillRect(netX, GTY+T, netW, goalH-T);
        ctx.save();
        ctx.beginPath(); ctx.rect(netX, GTY+T, netW, goalH-T); ctx.clip();
        ctx.strokeStyle = 'rgba(210,235,255,0.35)'; ctx.lineWidth = 0.8;
        for (let x = netX+8; x < netX+netW; x += 8) { ctx.beginPath(); ctx.moveTo(x, GTY+T); ctx.lineTo(x, GY); ctx.stroke(); }
        for (let y = GTY+T+8; y < GY; y += 8)        { ctx.beginPath(); ctx.moveTo(netX, y); ctx.lineTo(netX+netW, y); ctx.stroke(); }
        ctx.restore();

        ctx.fillStyle = '#c0ccd8'; ctx.fillRect(frontX, GTY, T, goalH);
        ctx.globalAlpha = 0.55; ctx.fillStyle = '#7f8b96'; ctx.fillRect(backX, GTY+T, T, goalH-T);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#c0ccd8'; ctx.fillRect(gx, GTY, GW, T);
    }

    /**
     * drawPlayer: corpo/testa/occhi + overlay ghiaccio + label P1/P2.
     * headR usa BH_HEAD_MULT per allineare visuale e hitbox.
     */
    private drawPlayer(ctx: CanvasRenderingContext2D, p: any): void {
        if (!p) return;
        const char      = CHARS.find(c => c.id === p.characterId) ?? CHARS[0];
        const cx        = p.x + p.w / 2;
        const isFrozen  = p.frozenMs  > 0;
        const isBigHead = p.bigHeadMs > 0;

        const baseHeadR = p.w * 0.48;
        const headR     = baseHeadR * (isBigHead ? BH_HEAD_MULT : 1);
        const headCY    = p.y + p.h * 0.35;

        const bodyY  = p.y + p.h * 0.70;
        const bodyRX = p.w * 0.26;
        const bodyRY = p.h * 0.18;

        ctx.save();

        ctx.globalAlpha = 0.20; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(cx, GY-2, p.w*0.40, 6, 0, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;

        ctx.fillStyle = char.jersey;
        ctx.beginPath(); ctx.ellipse(cx, bodyY, bodyRX, bodyRY, 0, 0, Math.PI*2); ctx.fill();

        const fR     = p.w * 0.15;
        const fCY    = p.y + p.h * 0.90;
        const spread = p.w * 0.22;
        const d      = p.dir ?? 1;

        [-1, 1].forEach(side => {
            const advance = side === d ? 4 : -1;
            const fx = cx + side * spread + advance;
            ctx.fillStyle = '#1a1a2e';
            ctx.beginPath(); ctx.ellipse(fx, fCY, fR, fR*0.65, 0, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = char.trim;
            ctx.beginPath(); ctx.ellipse(fx, fCY-fR*0.18, fR*0.85, fR*0.30, 0, 0, Math.PI*2); ctx.fill();
        });

        const skinG = ctx.createRadialGradient(
            cx - headR*0.3, headCY - headR*0.3, headR*0.05,
            cx, headCY, headR
        );
        skinG.addColorStop(0,    '#ffe8cc');
        skinG.addColorStop(0.65, '#f5c09a');
        skinG.addColorStop(1,    '#d4895a');
        ctx.beginPath(); ctx.arc(cx, headCY, headR, 0, Math.PI*2);
        ctx.fillStyle = skinG; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1.5; ctx.stroke();

        ctx.fillStyle = char.jersey;
        ctx.beginPath(); ctx.ellipse(cx, headCY-headR*0.72, headR*0.85, headR*0.30, 0, 0, Math.PI*2); ctx.fill();

        const eyeOffsetX = headR*0.32;
        const eyeY       = headCY - headR*0.05;
        const eyeRX      = headR*0.20;
        const eyeRY      = headR*0.24;

        ctx.fillStyle = '#fff';
        [cx-eyeOffsetX, cx+eyeOffsetX].forEach(ex => {
            ctx.beginPath(); ctx.ellipse(ex, eyeY, eyeRX, eyeRY, 0, 0, Math.PI*2); ctx.fill();
        });
        ctx.fillStyle = '#1a0800';
        [cx-eyeOffsetX, cx+eyeOffsetX].forEach(ex => {
            ctx.beginPath(); ctx.arc(ex + d*eyeRX*0.35, eyeY+eyeRY*0.10, eyeRX*0.55, 0, Math.PI*2); ctx.fill();
        });
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        [cx-eyeOffsetX, cx+eyeOffsetX].forEach(ex => {
            ctx.beginPath(); ctx.arc(ex + d*eyeRX*0.35 - eyeRX*0.2, eyeY-eyeRY*0.25, eyeRX*0.20, 0, Math.PI*2); ctx.fill();
        });

        // Overlay ghiaccio quando frozen.
        if (isFrozen) {
            ctx.globalAlpha = 0.42; ctx.fillStyle = '#a0e8ff';
            ctx.beginPath(); ctx.arc(cx, headCY, headR, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(cx, bodyY, bodyRX, bodyRY, 0, 0, Math.PI*2); ctx.fill();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#c8f0ff'; ctx.lineWidth = 1.5;
            [[0,-1],[0.866,0.5],[-0.866,0.5]].forEach(([ex, ey]) => {
                ctx.beginPath(); ctx.moveTo(cx, headCY);
                ctx.lineTo(cx + ex*headR*0.85, headCY + ey*headR*0.85); ctx.stroke();
            });
        }

        ctx.fillStyle = p.seat === 0 ? '#4ac7ff' : '#ff7272';
        ctx.font = `bold ${Math.round(headR*0.42)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.seat === 0 ? 'P1' : 'P2', cx, headCY - headR*1.42);

        this.drawTeleportBar(ctx, p);

        ctx.restore();
    }

    /** drawTeleportBar: barra cooldown sopra il giocatore. */
    private drawTeleportBar(ctx: CanvasRenderingContext2D, p: any): void {
        const barW = p.w;
        const barH = 5;
        const bx   = p.x;
        const by   = p.y - 14;
        const pct  = p.tpCdMs > 0 ? 1 - p.tpCdMs / TP_CD_MS : 1;

        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(bx, by, barW, barH);
        ctx.fillStyle = pct < 1 ? '#ffc66e' : '#68d68d';
        ctx.fillRect(bx, by, barW * pct, barH);

        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `bold ${Math.round(barH * 1.8)}px sans-serif`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('TP', bx, by + barH / 2);
    }

    /** drawBall: ombra + gradiente sferico + pentagono centrale. */
    private drawBall(ctx: CanvasRenderingContext2D, b: any): void {
        const { x, y } = b;
        ctx.save();

        ctx.globalAlpha = 0.18; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(x, GY-3, BR*0.9, BR*0.28, 0, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;

        const g = ctx.createRadialGradient(x-BR*0.35, y-BR*0.35, BR*0.05, x, y, BR);
        g.addColorStop(0,'#fff');
        g.addColorStop(0.4,'#f0f0f0');
        g.addColorStop(1,'#8888a0');
        ctx.beginPath(); ctx.arc(x, y, BR, 0, Math.PI*2);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = '#666'; ctx.lineWidth = 1.5; ctx.stroke();

        ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
        const verts = [[0,-1],[0.951,-0.309],[0.588,0.809],[-0.588,0.809],[-0.951,-0.309]];
        ctx.beginPath();
        verts.forEach(([vx, vy], i) => {
            const px2 = x + vx*BR*0.48, py2 = y + vy*BR*0.48;
            i === 0 ? ctx.moveTo(px2,py2) : ctx.lineTo(px2,py2);
        });
        ctx.closePath(); ctx.stroke();
        ctx.restore();
    }

    /**
     * drawBubble: bolla con pulsazione leggera per attirare l'attenzione.
     */
    private drawBubble(ctx: CanvasRenderingContext2D, bub: any): void {
        const pulse = 1 + 0.12 * Math.sin(this.clock * 4);
        const r     = BUBBLE_RADIUS * pulse;
        const color = bub.type === 'ice' ? '#7df0ff' : '#a0ff80';
        const icon  = bub.type === 'ice' ? '❄'       : '💪';

        ctx.save();

        ctx.globalAlpha = 0.25;
        ctx.fillStyle   = color;
        ctx.beginPath(); ctx.arc(bub.x, bub.y, r * 1.5, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;

        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(bub.x, bub.y, r, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();

        ctx.fillStyle    = '#07111c';
        ctx.font         = `${Math.round(r * 1.1)}px sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon, bub.x, bub.y);
        ctx.restore();
    }

    /** drawHUD: punteggio, timer e barra spawn bolla. */
    private drawHUD(ctx: CanvasRenderingContext2D): void {
        const secondiTotali = Math.ceil(Math.max(0, this.timeMs) / 1000);
        const mm   = String(Math.floor(secondiTotali/60)).padStart(2,'0');
        const ss   = String(secondiTotali%60).padStart(2,'0');
        const time = this.phase === 'countdown'
            ? String(Math.max(0, Math.ceil(this.timeMs / 1000)))
            : `${mm}:${ss}`;

        ctx.save();
        ctx.font = `bold ${Math.round(CW*0.028)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';

        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText(String(this.score.left),  CW*0.16+1, 13);
        ctx.fillText(time,                     CW/2+1,    13);
        ctx.fillText(String(this.score.right), CW*0.84+1, 13);

        ctx.fillStyle = '#4ac7ff'; ctx.fillText(String(this.score.left),  CW*0.16, 12);
        ctx.fillStyle = '#ffffff'; ctx.fillText(time,                     CW/2,    12);
        ctx.fillStyle = '#ff7272'; ctx.fillText(String(this.score.right), CW*0.84, 12);

        if (!this.bubble && this.phase === 'playing') {
            const pct = 1 - this.bubbleSpawnMs / BUBBLE_SPAWN_MS;
            const bw  = 140, bh = 6;
            const bx  = CW/2 - bw/2, by = 44;

            ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(bx, by, bw, bh);
            ctx.fillStyle = '#ffd700'; ctx.fillRect(bx, by, bw*pct, bh);
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = `${Math.round(CH*0.022)}px sans-serif`;
            ctx.fillText('⚡ prossima bolla', CW/2, by + 14);
        }
        ctx.restore();
    }

    /** drawCountdown: overlay con numero centrale. */
    private drawCountdown(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.fillStyle = 'rgba(7,12,20,0.55)'; ctx.fillRect(0, 0, CW, CH);
        const n = Math.max(0, Math.ceil(this.timeMs / 1000));
        ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(CH*0.20)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(n > 0 ? String(n) : 'Via!', CW/2, CH/2-16);
        ctx.font = `600 ${Math.round(CH*0.038)}px sans-serif`;
        ctx.fillStyle = 'rgba(228,238,255,0.8)';
        ctx.fillText('Pronti?', CW/2, CH/2+50);
        ctx.restore();
    }

    /** drawSelection: pannello selezione personaggio e stato avversario. */
    private drawSelection(ctx: CanvasRenderingContext2D): void {
        const pw = CW*0.44, ph = CH*0.70;
        const px = (CW-pw)/2, py = (CH-ph)/2;
        ctx.save();
        ctx.fillStyle = 'rgba(9,18,32,0.93)'; this.rr(ctx,px,py,pw,ph,24); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5; this.rr(ctx,px,py,pw,ph,24); ctx.stroke();

        const char = CHARS[this.charIdx];
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';

        ctx.fillStyle = 'rgba(238,245,255,0.55)'; ctx.font = `${Math.round(CH*0.022)}px sans-serif`;
        ctx.fillText('HEAD BALL ONLINE', CW/2, py+18);

        ctx.fillStyle = '#eef5ff'; ctx.font = `bold ${Math.round(CH*0.042)}px sans-serif`;
        ctx.fillText(
            this.confirmed           ? 'Pronto! In attesa avversario...' :
            this.phase === 'waiting' ? 'In attesa di avversario...'      :
                                       'Scegli il tuo personaggio',
            CW/2, py+42
        );

        const orbX = CW/2, orbY = py+ph*0.42, orbR = Math.round(pw*0.115);
        const gg = ctx.createRadialGradient(orbX-orbR*0.35,orbY-orbR*0.35,orbR*0.05,orbX,orbY,orbR);
        gg.addColorStop(0,'#fff'); gg.addColorStop(0.5,char.accent); gg.addColorStop(1,char.jersey);
        ctx.beginPath(); ctx.arc(orbX,orbY,orbR,0,Math.PI*2); ctx.fillStyle=gg; ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=2; ctx.stroke();
        ctx.fillStyle='#eef5ff'; ctx.font=`bold ${Math.round(CH*0.036)}px sans-serif`;
        ctx.fillText(char.name, CW/2, orbY+orbR+10);

        if (!this.confirmed && this.phase === 'selection') {
            ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font=`${Math.round(CH*0.048)}px sans-serif`;
            ctx.textBaseline='middle';
            ctx.fillText('◀', orbX-orbR*1.8, orbY);
            ctx.fillText('▶', orbX+orbR*1.8, orbY);
            ctx.textBaseline='top';
            ctx.fillStyle='rgba(238,245,255,0.6)'; ctx.font=`${Math.round(CH*0.026)}px sans-serif`;
            ctx.fillText('A / ←  ·  D / →   cambia', CW/2, py+ph*0.75);
            ctx.fillStyle='rgba(104,214,141,0.9)'; ctx.font=`bold ${Math.round(CH*0.028)}px sans-serif`;
            ctx.fillText('S / Enter   conferma', CW/2, py+ph*0.84);
        } else if (this.confirmed) {
            ctx.fillStyle='#68d68d'; ctx.font=`bold ${Math.round(CH*0.030)}px sans-serif`;
            ctx.fillText('✓ Confermato!', CW/2, py+ph*0.80);
        }

        const oppSel = this.sels[this.mySeat === 0 ? 1 : 0];
        if (oppSel) {
            const oppName = CHARS.find(c => c.id === oppSel.characterId)?.name ?? '?';
            ctx.fillStyle='rgba(238,245,255,0.40)'; ctx.font=`${Math.round(CH*0.024)}px sans-serif`;
            ctx.fillText(oppSel.confirmed ? `Avversario pronto (${oppName})` : 'Avversario sta scegliendo...', CW/2, py+ph-20);
        }
        ctx.restore();
    }

    /** drawResult: pannello finale con esito e punteggio. */
    private drawResult(ctx: CanvasRenderingContext2D): void {
        const pw = CW*0.44, ph = CH*0.38, px=(CW-pw)/2, py=(CH-ph)/2;
        ctx.save();
        ctx.fillStyle='rgba(9,18,32,0.95)'; this.rr(ctx,px,py,pw,ph,28); ctx.fill();
        ctx.textAlign='center'; ctx.textBaseline='middle';

        ctx.fillStyle='#eef5ff'; ctx.font=`bold ${Math.round(CH*0.064)}px sans-serif`;
        ctx.fillText(
            this.winner==='draw'  ? 'Pareggio!'     :
            this.winner==='left'  ? 'Vince P1  🎉'  :
                                    'Vince P2  🎉',
            CW/2, py+ph*0.32
        );

        ctx.fillStyle='rgba(238,245,255,0.60)'; ctx.font=`${Math.round(CH*0.034)}px sans-serif`;
        ctx.fillText(`${this.score.left} - ${this.score.right}`, CW/2, py+ph*0.58);
        ctx.fillText('Ritorno alla lobby principale...', CW/2, py+ph*0.80);
        ctx.restore();
    }

    /**
     * drawManual: pannello istruzioni. Le coordinate del pulsante devono
     * combaciare con registerManualClick() per il click.
     */
    private drawManual(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.fillStyle = 'rgba(5,12,24,0.82)'; ctx.fillRect(0, 0, CW, CH);

        const pw = CW*0.62, ph = CH*0.88;
        const px = (CW-pw)/2, py = (CH-ph)/2;
        ctx.fillStyle='rgba(10,20,38,0.97)'; this.rr(ctx,px,py,pw,ph,28); ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=1.5; this.rr(ctx,px,py,pw,ph,28); ctx.stroke();

        const cx = CW/2;
        ctx.textAlign='center'; ctx.textBaseline='top';

        ctx.fillStyle='#eef5ff'; ctx.font=`800 ${Math.round(CH*0.058)}px sans-serif`;
        ctx.fillText('⚽ HEAD BALL ONLINE', cx, py+20);
        ctx.fillStyle='rgba(238,245,255,0.55)'; ctx.font=`${Math.round(CH*0.026)}px sans-serif`;
        ctx.fillText('Manuale di gioco', cx, py+72);

        // ── Tabella controlli ────────────────────────────────────────
        const lineH = CH*0.068;   // altezza di ogni riga
        const col1  = px + pw*0.08;   // colonna icona
        const col2  = px + pw*0.22;   // colonna tasto
        let rowY = py + 108;          // Y di partenza per la prima riga

        // Array delle righe da disegnare
        const rows = [
            { icon: '←→', label: 'A / ←  D / →',  desc: 'Muovi il personaggio'                        },
            { icon: '↑',  label: 'W / ↑',           desc: 'Salta  (di nuovo in aria = doppio salto)'    },
            { icon: '⚡', label: 'F',                desc: `Teleport — davanti alla palla  (cooldown ${TP_CD_MS/1000}s)` },
        ];

        rows.forEach(row => {
            ctx.textAlign='left'; ctx.textBaseline='middle';
            // Sfondo riga (rettangolo arrotondato semitrasparente)
            ctx.fillStyle='rgba(255,255,255,0.12)'; this.rr(ctx, px+pw*0.04, rowY-lineH*0.42, pw*0.92, lineH*0.84, 10); ctx.fill();
            // Icona (gialla)
            ctx.fillStyle='#ffd966'; ctx.font=`bold ${Math.round(CH*0.038)}px sans-serif`; ctx.fillText(row.icon, col1+16, rowY);
            // Tasto (azzurro)
            ctx.fillStyle='#4ac7ff'; ctx.font=`bold ${Math.round(CH*0.028)}px sans-serif`; ctx.fillText(row.label, col2, rowY);
            // Descrizione (bianco)
            ctx.fillStyle='#eef5ff'; ctx.font=`${Math.round(CH*0.026)}px sans-serif`;      ctx.fillText(row.desc, col2+pw*0.28, rowY);
            rowY += lineH;  // andiamo alla riga successiva
        });

        rowY += lineH*0.3;
        ctx.textAlign='center'; ctx.textBaseline='top';
        ctx.fillStyle='rgba(255,255,255,0.45)'; ctx.font=`${Math.round(CH*0.024)}px sans-serif`;
        ctx.fillText('── Superpoteri Bolla ──', cx, rowY);
        rowY += lineH*0.65;

        const bubRows = [
            { icon: '❄', color: '#7df0ff', desc: `ICE — Congela l'avversario per ${ICE_DUR_MS/1000}s` },
            { icon: '💪', color: '#a0ff80', desc: `BIG HEAD — Testa enorme per ${BH_DUR_MS/1000}s  (hitbox più grande!)` },
        ];
        bubRows.forEach(row => {
            ctx.textAlign='left'; ctx.textBaseline='middle';
            ctx.fillStyle='rgba(255,255,255,0.12)'; this.rr(ctx, px+pw*0.04, rowY-lineH*0.42, pw*0.92, lineH*0.84, 10); ctx.fill();
            ctx.font=`${Math.round(CH*0.038)}px sans-serif`; ctx.fillText(row.icon, col1+14, rowY);
            ctx.fillStyle=row.color; ctx.font=`${Math.round(CH*0.026)}px sans-serif`; ctx.fillText(row.desc, col2, rowY);
            rowY += lineH;
        });

        rowY += lineH*0.2;
        ctx.textAlign='center'; ctx.textBaseline='top';
        ctx.fillStyle='rgba(238,245,255,0.40)'; ctx.font=`${Math.round(CH*0.022)}px sans-serif`;
        ctx.fillText(`Le bolle appaiono ogni ${BUBBLE_SPAWN_MS/1000}s — cammina sopra per raccoglierle!`, cx, rowY);

        // ATTENZIONE: le coordinate devono combaciare ESATTAMENTE con quelle di registerManualClick()
        const bw=180, bh=48, bx2=cx-bw/2, by2=CH*0.78;
        const btnG = ctx.createLinearGradient(bx2, by2, bx2, by2+bh);
        btnG.addColorStop(0,'#68d68d');
        btnG.addColorStop(1,'#2f9360');
        ctx.fillStyle=btnG; this.rr(ctx,bx2,by2,bw,bh,14); ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1; this.rr(ctx,bx2,by2,bw,bh,14); ctx.stroke();
        ctx.fillStyle='#07111c'; ctx.font=`800 ${Math.round(bh*0.50)}px sans-serif`;
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText('🎮  GIOCA!', cx, by2+bh/2);

        ctx.restore();
    }

    // ── Utility ───────────────────────────────────────────────────────────────

    /** rr: path di rounded-rect (compatibile con browser senza roundRect). */
    private rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
        ctx.beginPath();
        ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y);
        ctx.arcTo(x+w, y, x+w, y+r, r);
        ctx.lineTo(x+w, y+h-r);
        ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
        ctx.lineTo(x+r, y+h);
        ctx.arcTo(x, y+h, x, y+h-r, r);
        ctx.lineTo(x, y+r);
        ctx.arcTo(x, y, x+r, y, r);
        ctx.closePath();
    }

    // ── Animazione Goal ───────────────────────────────────────────────────────

    /**
     * onGoalScored: orchestratore dell'animazione goal.
     * Avvia: zoom/shake, testo GOAL!, particelle, audio.
     * L'animazione si auto-termina dopo 2s (sincronizzato con GOAL_PAUSE_MS dal server).
     */
    private onGoalScored(scorer: Seat): void {
        this.goalScoredAt = this.clock;
        this.goalScorer = scorer;
        this.isGoalAnimating = true;

        // Reset effetti precedenti
        this.particles = [];
        this.goalSlowmoUntil = this.clock + SLOWMO_DURATION / 1000;
        this.goalShakeDecay = SLOWMO_DURATION / 1000;

        // Crea particelle confetti
        this.spawnGoalParticles();

        // Riproduci suono
        this.playGoalAudio();
    }

    /**
     * spawnGoalParticles: genera confetti intorno alla porta.
     */
    private spawnGoalParticles(): void {
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const angle = (Math.random() * Math.PI * 2);
            const speed = 200 + Math.random() * 300;
            const x = this.goalScorer === 0 ? CW - GW / 2 : GW / 2;
            const y = GY - 100;

            this.particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 200,
                lifetime: PARTICLE_LIFETIME / 1000,
                maxLifetime: PARTICLE_LIFETIME / 1000,
                rotation: Math.random() * Math.PI * 2,
                rotVel: (Math.random() - 0.5) * 8,
            });
        }
    }

    /**
     * updateGoalParticles: aggiorna fisica particelle (gravità, lifetime).
     */
    private updateGoalParticles(dt: number): void {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.vy += B_GRAV * dt;
            p.x  += p.vx * dt;
            p.y  += p.vy * dt;
            p.lifetime = Math.max(0, p.lifetime - dt);
            p.rotation += p.rotVel * dt;

            if (p.lifetime <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }

    /**
     * updateGoalShake: decrementa la durata dello shake.
     */
    private updateGoalShake(): void {
        if (this.goalShakeDecay > 0) {
            this.goalShakeDecay = Math.max(0, this.goalShakeDecay - (1 / 60)); // ~60fps
        }
    }

    /**
     * computeGoalCameraEffects: calcola zoom e shake per effetti camera.
     * Ritorna scale e offset di shake.
     */
    private computeGoalCameraEffects(): { zoomScale: number; shakeX: number; shakeY: number } {
        if (this.goalScoredAt === null) {
            return { zoomScale: 1, shakeX: 0, shakeY: 0 };
        }

        const elapsed = (this.clock - this.goalScoredAt) * 1000;
        let zoomScale = 1;
        let shakeX = 0;
        let shakeY = 0;

        // Zoom: 0-1s animate 1 → 1.3 → 1
        if (elapsed < 1000) {
            const t = elapsed / 1000;
            if (t < 0.5) {
                zoomScale = 1 + (CAMERA_ZOOM_SCALE - 1) * (t / 0.5);
            } else {
                zoomScale = CAMERA_ZOOM_SCALE - (CAMERA_ZOOM_SCALE - 1) * ((t - 0.5) / 0.5);
            }
        }

        // Shake: decay 0-0.8s random offset
        if (this.goalShakeDecay > 0) {
            const intensity = CAMERA_SHAKE_INTENS * (this.goalShakeDecay / (SLOWMO_DURATION / 1000));
            shakeX = (Math.random() - 0.5) * intensity * 2;
            shakeY = (Math.random() - 0.5) * intensity * 2;
        }

        return { zoomScale, shakeX, shakeY };
    }

    /**
     * drawGoalText: disegna "GOAL!" con fade-in e scale pop.
     * Auto-termina dopo GOAL_PAUSE_MS (2s) per sincronizzarsi con il cooldown del server.
     */
    private drawGoalText(ctx: CanvasRenderingContext2D): void {
        if (this.goalScoredAt === null) return;

        const elapsed = (this.clock - this.goalScoredAt) * 1000;
        
        // Termina l'animazione dopo il cooldown goal (2s)
        if (elapsed > GOAL_PAUSE_MS) {
            this.isGoalAnimating = false;
            this.goalScoredAt = null;
            return;
        }

        if (elapsed > GOAL_TEXT_DURATION) return;

        // Fade-in: 0-0.3s (da 0 → 1)
        // Scale pop: 0-0.4s (da 0.5 → 1.2), poi 0.4-2s (da 1.2 → 1.0)
        let alpha = Math.min(1, elapsed / 300);
        let scale = 1;

        if (elapsed < 400) {
            const t = elapsed / 400;
            scale = 0.5 + t * (1.2 - 0.5);
        } else {
            const t = (elapsed - 400) / (GOAL_TEXT_DURATION - 400);
            scale = 1.2 - t * 0.2;
        }

        alpha = Math.max(0, 1 - Math.max(0, elapsed - 1500) / 500);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(CW / 2, CH / 2.5);
        ctx.scale(scale, scale);
        ctx.font = `800 ${Math.round(CH * 0.15)}px sans-serif`;
        ctx.fillStyle = '#ffff00';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(255, 100, 0, 0.8)';
        ctx.shadowBlur = 20;
        ctx.fillText('⚽ GOAL! ⚽', 0, 0);
        ctx.restore();
    }

    /**
     * drawGoalParticles: disegna le particelle confetti.
     */
    private drawGoalParticles(ctx: CanvasRenderingContext2D): void {
        this.particles.forEach(p => {
            const alpha = p.lifetime / p.maxLifetime;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.fillStyle = ['#ff6b6b', '#ffd93d', '#6bcf7f', '#4d96ff'][Math.floor(Math.random() * 4)];
            ctx.fillRect(-5, -5, 10, 10);
            ctx.restore();
        });
    }

    /**
     * drawGoalMenu: disegna overlay menu con pulsante "Gioca!" time-gated.
     */
    private drawGoalMenu(ctx: CanvasRenderingContext2D): void {
        if (this.goalScoredAt === null) return;

        const elapsed = (this.clock - this.goalScoredAt) * 1000;

        // Sfondo semi-trasparente
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, CW, CH);

        // Box menu
        const mw = CW * 0.5;
        const mh = CH * 0.35;
        const mx = (CW - mw) / 2;
        const my = (CH - mh) / 2;

        ctx.fillStyle = 'rgba(20, 30, 50, 0.9)';
        this.rr(ctx, mx, my, mw, mh, 15);
        ctx.fill();
        ctx.strokeStyle = '#4d96ff';
        ctx.lineWidth = 2;
        this.rr(ctx, mx, my, mw, mh, 15);
        ctx.stroke();

        // Pulsante "Continua"
        const bw = mw * 0.6;
        const bh = mh * 0.35;
        const bx = (CW - bw) / 2;
        const by = (CH - bh) / 2;

        const isButtonActive = elapsed >= MENU_BUTTON_DELAY;
        const btnColor = isButtonActive ? '#68d68d' : '#555555';
        const btnGrad = ctx.createLinearGradient(bx, by, bx, by + bh);
        btnGrad.addColorStop(0, isButtonActive ? '#7fd999' : '#666666');
        btnGrad.addColorStop(1, btnColor);

        ctx.fillStyle = btnGrad;
        this.rr(ctx, bx, by, bw, bh, 10);
        ctx.fill();
        ctx.strokeStyle = isButtonActive ? 'rgba(100, 255, 100, 0.5)' : 'rgba(100, 100, 100, 0.3)';
        ctx.lineWidth = 2;
        this.rr(ctx, bx, by, bw, bh, 10);
        ctx.stroke();

        ctx.font = `700 ${Math.round(bh * 0.5)}px sans-serif`;
        ctx.fillStyle = isButtonActive ? '#07111c' : '#999999';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🎮 CONTINUA', CW / 2, by + bh / 2);

        // Countdown badge
        if (elapsed < MENU_BUTTON_DELAY) {
            const remaining = Math.ceil((MENU_BUTTON_DELAY - elapsed) / 1000);
            ctx.font = `600 ${Math.round(CH * 0.04)}px sans-serif`;
            ctx.fillStyle = '#ffaa44';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`Aspetta ${remaining}s`, CW / 2, by - bh * 0.3);
        }

        // Termina animazione dopo che il button è stato attivo per un po' o se è passato troppo tempo
        if (elapsed > MENU_BUTTON_DELAY + 1000) {
            this.isGoalAnimating = false;
            this.goalScoredAt = null;
        }
    }

    /**
     * playGoalAudio: riproduce suono di pubblico che esulta.
     * Usa Web Audio API per generare un suono di celebrazione.
     */
    private playGoalAudio(): void {
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            }

            const ctx = this.audioContext;
            if (ctx.state === 'suspended') ctx.resume();

            const now = ctx.currentTime;
            const duration = 0.5;

            // Crea un breve burst di suono celebrativo con modulazione
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain = ctx.createGain();
            const gain1 = ctx.createGain();
            const gain2 = ctx.createGain();

            osc1.type = 'sine';
            osc2.type = 'triangle';
            osc1.frequency.setValueAtTime(400, now);
            osc2.frequency.setValueAtTime(600, now);

            gain1.gain.setValueAtTime(0.3, now);
            gain1.gain.exponentialRampToValueAtTime(0.1, now + duration);
            gain2.gain.setValueAtTime(0.2, now);
            gain2.gain.exponentialRampToValueAtTime(0.05, now + duration);

            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

            osc1.connect(gain1);
            osc2.connect(gain2);
            gain1.connect(gain);
            gain2.connect(gain);
            gain.connect(ctx.destination);

            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + duration);
            osc2.stop(now + duration);

        } catch (e) {
            // Audio fallback silenzioso se Web Audio non disponibile
        }
    }
}
