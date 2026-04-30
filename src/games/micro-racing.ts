/**
 * MicroRacingGame.ts
 * ==================
 * Tracciato custom "Circuit Ourspace" con rettilinei, chicane, esse e curve veloci.
 * Sistema qualifiche 3 minuti → recap griglia → gara 3 giri.
 */

import { Player }                   from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer }   from './game';
import { UserInput }                from '../client/user-input';
import { getCharacterDrawFunction } from '../client/characters';



const MONDO_W = 4800;
const MONDO_H = 3800;
const LARGHEZZA_PISTA = 160; // px — più larga per rendere il tracciato più leggibile

/**
 * Waypoint della linea centrale del tracciato (percorso in senso orario).
 * Punto 0 = linea del TRAGUARDO, sul rettilineo principale (lato est).
 *
 * Sezioni principali:
 *   wp 0–3   : rettilineo principale (est, verso nord)
 *   wp 3–6   : tornante 90° verso ovest (curva 1)
 *   wp 6–10  : rettilineo est-nord  →  curva veloce (curva 2)
 *   wp 10–14 : esse veloci (3 curve in rapida successione)
 *   wp 14–17 : rettilineo nord → chicane sinistra (curva 3+4)
 *   wp 17–21 : curva lenta a U (curva 5)
 *   wp 21–25 : rettilineo sud → doppia chicane (curva 6+7)
 *   wp 25–28 : rettilineo finale → traguardo
 */
const WAYPOINTS: { x: number; y: number }[] = [

    // ── Rettilineo principale (est, traguardo in mezzo) ─────────────────────
    { x: 3800, y: 2400 },   // 0  ← TRAGUARDO qui
    { x: 3800, y: 2100 },   // 1
    { x: 3800, y: 1800 },   // 2
    { x: 3800, y: 1550 },   // 3

    // ── Tornante 90° verso ovest (curva 1 — lenta, stretta) ─────────────────
    { x: 3700, y: 1380 },   // 4
    { x: 3500, y: 1270 },   // 5
    { x: 3300, y: 1230 },   // 6

    // ── Rettilineo nord-ovest → curva veloce sx (curva 2) ───────────────────
    { x: 3000, y: 1210 },   // 7
    { x: 2700, y: 1200 },   // 8
    { x: 2450, y: 1250 },   // 9
    { x: 2250, y: 1370 },   // 10

    // ── Esse veloci: S1 destra (curva 3) ────────────────────────────────────
    { x: 2100, y: 1280 },   // 11
    { x: 1950, y: 1160 },   // 12
    { x: 1800, y: 1200 },   // 13
    { x: 1680, y: 1320 },   // 14

    // ── S2 sinistra (curva 4) ────────────────────────────────────────────────
    { x: 1550, y: 1240 },   // 15
    { x: 1420, y: 1160 },   // 16
    { x: 1260, y: 1190 },   // 17

    // ── Rettilineo ovest → chicane sx/dx (curva 5+6) ────────────────────────
    { x: 1050, y: 1300 },   // 18
    { x:  870, y: 1450 },   // 19   chicane: sx
    { x:  780, y: 1620 },   // 20   chicane: dx
    { x:  870, y: 1800 },   // 21

    // ── Grande curva a U verso sud (curva 7 — lenta, punto tecnico) ─────────
    { x:  900, y: 2000 },   // 22
    { x:  820, y: 2200 },   // 23
    { x:  750, y: 2450 },   // 24
    { x:  820, y: 2650 },   // 25
    { x: 1000, y: 2780 },   // 26

    // ── Rettilineo sud → doppia chicane dx/sx (curva 8+9) ───────────────────
    { x: 1350, y: 2820 },   // 27
    { x: 1700, y: 2820 },   // 28
    { x: 2000, y: 2750 },   // 29   chicane dx
    { x: 2150, y: 2620 },   // 30
    { x: 2300, y: 2750 },   // 31   chicane sx
    { x: 2500, y: 2820 },   // 32

    // ── Rettilineo verso traguardo (sud-est) ─────────────────────────────────
    { x: 2850, y: 2820 },   // 33
    { x: 3200, y: 2750 },   // 34
    { x: 3500, y: 2620 },   // 35
    { x: 3700, y: 2500 },   // 36
    // → si ricongiunge al punto 0
];

// ── Checkpoint anti-cheating (in ordine obbligatorio) ────────────────────────
// Più checkpoint distribuiti su tutto il giro per ridurre tagli aggressivi.
const CHECKPOINTS = [
    { x: 3500, y: 1270, r: 90 },   // CP1: uscita tornante nord-est
    { x: 2700, y: 1200, r: 90 },   // CP2: rettilineo nord
    { x: 1800, y: 1200, r: 90 },   // CP3: esse centrali
    { x:  870, y: 1450, r: 90 },   // CP4: ingresso chicane ovest
    { x:  750, y: 2450, r: 90 },   // CP5: fondo curva a U
    { x: 1350, y: 2820, r: 90 },   // CP6: rettilineo sud
    { x: 2150, y: 2620, r: 90 },   // CP7: doppia chicane sud-est
    { x: 3200, y: 2750, r: 90 },   // CP8: lancio verso traguardo
];

// Traguardo: centro sul rettilineo principale
const TRAGUARDO    = { x: 3800, y: 2200, r: 80 };

// Griglia di partenza: due file sul rettilineo, scalano verso sud
const GRIGLIA_BASE = { dx: 35, dy: 90 }; // offset laterale e avanzamento per fila

// ═══════════════════════════════════════════════════════════════════════════════
//  COSTANTI FISICHE
// ═══════════════════════════════════════════════════════════════════════════════

const ACCEL          = 290;
const FRENO          = 560;
const ATTRITO        = 130;
const STERZO_RAD     = 3.05;
const VEL_MAX        = 315;
const ERBA_ACCEL_MULT   = 0.42;
const ERBA_VELMAX_MULT  = 0.34;
const ERBA_ATTRITO_MULT = 0.75;
const DRIFT          = 0.8;
const TURBO_BONUS    = 1.8;
const TURBO_DURATA   = 0.8;
const TURBO_RICARICA = 4.0;
const OLIO_RAGGIO    = 20;
const OLIO_SPIN      = 1.4;
const OLIO_RICARICA  = 5.0;
const OLIO_VITA      = 25.0;
const DURATA_QUALIFICHE = 100;  // TODO 3 minuti (ACCORCIATO PER VELOCITA TEST)
const DURATA_RECAP      = 8;    // secondi di schermata griglia prima che parta la gara
const DURATA_PARTENZA   = 4;    // countdown semaforo prima del via reale
const DNF_TIMEOUT       = 30;   // timer globale dopo il primo classificato
const GIRI_GARA         = 3;
const SCIA_BONUS        = 1.15;
const SCIA_DIST_MAX     = 180;
const SCIA_CONE_BASE    = 18;
const SCIA_CONE_GAIN    = 0.35;
const COLORI_AUTO = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];

// ═══════════════════════════════════════════════════════════════════════════════
//  TIPI CONDIVISI
// ═══════════════════════════════════════════════════════════════════════════════

// Le tre fasi: qualifiche → recap griglia → gara
type Fase = 'qualifiche' | 'recap' | 'gara';

interface StatoAuto {
    x: number; y: number;
    prevX: number; prevY: number;
    a: number; vx: number; vy: number;
    giri: number; cp: number;
    cpQual: number; migliorGiro: number; tempoGiroAttuale: number;
    turboTimer: number; turboCooldown: number; olioCooldown: number; spinTimer: number;
    giroInvalido: boolean; inScia: boolean;
    nome: string; character: string;
    finito: boolean; dnf: boolean; posizione: number;
}

interface ChiazzaOlio { x: number; y: number; vita: number; }

interface MsgInput {
    kind: 'input';
    su: boolean; giu: boolean; sx: boolean; dx: boolean;
    turbo: boolean; olio: boolean;
}

interface MsgStato {
    kind: 'stato'; fase: Fase;
    tempoQual: number;   // secondi rimasti alle qualifiche
    tempoRecap: number;  // secondi rimasti al recap
    countdownPartenza: number;
    dnfTimer: number;
    auto: Record<string, StatoAuto>; olio: ChiazzaOlio[];
    garaFinita: boolean; gridOrder: string[]; migliorAssoluto: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FUNZIONI DI UTILITÀ
// ═══════════════════════════════════════════════════════════════════════════════

function distSegmento(px: number, py: number,
                      ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function sullaStrada(cx: number, cy: number): boolean {
    for (let i = 0; i < WAYPOINTS.length; i++) {
        const a = WAYPOINTS[i];
        const b = WAYPOINTS[(i + 1) % WAYPOINTS.length];
        if (distSegmento(cx, cy, a.x, a.y, b.x, b.y) < LARGHEZZA_PISTA / 2) return true;
    }
    return false;
}

function calcolaGriglia(auto: Record<string, StatoAuto>): string[] {
    return Object.keys(auto).sort((a, b) => {
        const ta = auto[a].migliorGiro < 0 ? Infinity : auto[a].migliorGiro;
        const tb = auto[b].migliorGiro < 0 ? Infinity : auto[b].migliorGiro;
        return ta - tb;
    });
}

function calcolaMigliorAssoluto(auto: Record<string, StatoAuto>): number {
    let best = Infinity;
    for (const id in auto) {
        const t = auto[id].migliorGiro;
        if (t >= 0 && t < best) best = t;
    }
    return best === Infinity ? -1 : best;
}

/** Formatta ms → "m:ss,ddd" */
function formatTempo(ms: number): string {
    if (ms < 0) return '--:--.---';
    const min  = Math.floor(ms / 60000);
    const sec  = Math.floor((ms % 60000) / 1000);
    const mill = Math.floor(ms % 1000);
    return `${min}:${String(sec).padStart(2, '0')},${String(mill).padStart(3, '0')}`;
}

function aggiornaFisica(
    auto: StatoAuto,
    input: { su: boolean; giu: boolean; sx: boolean; dx: boolean },
    dt: number,
    bonusScia: number,
    penalitaErba: boolean,
): void {

    if (auto.spinTimer     > 0) auto.spinTimer     = Math.max(0, auto.spinTimer     - dt);
    if (auto.turboTimer    > 0) {
        auto.turboTimer -= dt;
        if (auto.turboTimer <= 0) auto.turboCooldown = TURBO_RICARICA;
    }
    if (auto.turboCooldown > 0) auto.turboCooldown = Math.max(0, auto.turboCooldown - dt);
    if (auto.olioCooldown  > 0) auto.olioCooldown  = Math.max(0, auto.olioCooldown  - dt);

    // Spin-out: ruota e frena da sola
    if (auto.spinTimer > 0) {
        auto.a += 5.5 * dt;
        const v = Math.hypot(auto.vx, auto.vy);
        if (v > 0) { const f = Math.min(v, ATTRITO * 3 * dt); auto.vx -= (auto.vx / v) * f; auto.vy -= (auto.vy / v) * f; }
        auto.x += auto.vx * dt; auto.y += auto.vy * dt;
        return;
    }

    if (input.sx) auto.a -= STERZO_RAD * dt;
    if (input.dx) auto.a += STERZO_RAD * dt;

    const fw = { x: Math.cos(auto.a), y: Math.sin(auto.a) };
    // In erba la penalità è forte, ma deve restare sempre possibile rientrare in pista.
    const accelAttuale = penalitaErba ? ACCEL * ERBA_ACCEL_MULT : ACCEL;
    const velMaxBase = VEL_MAX * (penalitaErba ? ERBA_VELMAX_MULT : 1);
    const velMax = velMaxBase * (auto.turboTimer > 0 ? TURBO_BONUS : 1) * bonusScia;
    const attritoAttuale = penalitaErba ? ATTRITO * ERBA_ATTRITO_MULT : ATTRITO;

    if (input.su) { auto.vx += fw.x * accelAttuale * dt; auto.vy += fw.y * accelAttuale * dt; }
    if (input.giu) {
        const v = Math.hypot(auto.vx, auto.vy);
        if (v > 5) { auto.vx -= (auto.vx / v) * FRENO * dt; auto.vy -= (auto.vy / v) * FRENO * dt; }
    }

    // Drift: riduce la componente laterale
    const fwdVel = auto.vx * fw.x + auto.vy * fw.y;
    const latX   = auto.vx - fw.x * fwdVel;
    const latY   = auto.vy - fw.y * fwdVel;
    auto.vx = fw.x * fwdVel + latX * DRIFT;
    auto.vy = fw.y * fwdVel + latY * DRIFT;

    const v = Math.hypot(auto.vx, auto.vy);
    if (v > 0) { const f = Math.min(v, attritoAttuale * dt); auto.vx -= (auto.vx / v) * f; auto.vy -= (auto.vy / v) * f; }

    const vAtt = Math.hypot(auto.vx, auto.vy);
    if (vAtt > velMax) { auto.vx = (auto.vx / vAtt) * velMax; auto.vy = (auto.vy / vAtt) * velMax; }

    auto.x += auto.vx * dt; auto.y += auto.vy * dt;
}

/** Posizione di griglia: due file laterali, scalano verso sud lungo il rettilineo */
function posGriglia(i: number): { x: number; y: number; a: number } {
    const lato = i % 2 === 0 ? -1 : 1;           // sinistra/destra alternati
    const fila = Math.floor(i / 2);
    return {
        x: TRAGUARDO.x + lato * GRIGLIA_BASE.dx,
        y: TRAGUARDO.y + 150 + fila * GRIGLIA_BASE.dy, // partono sotto il traguardo
        a: -Math.PI / 2,                               // angolo verso nord
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════════════════

export class MicroRacingServer extends GameServer {

    private auto: Record<string, StatoAuto> = {};
    private olio: ChiazzaOlio[] = [];
    private fase: Fase      = 'qualifiche';
    private tempoQual       = DURATA_QUALIFICHE;
    private tempoRecap      = DURATA_RECAP;
    private countdownPartenza = 0;
    private dnfTimer        = -1;
    private gridOrder: string[] = [];
    private garaFinita      = false;
    private totGiocatori    = 0;

    init(giocatori: Record<string, Player>): void {
        let i = 0;
        for (const id in giocatori) {
            const g = posGriglia(i);
            this.auto[id] = {
                x: g.x, y: g.y, prevX: g.x, prevY: g.y, a: g.a,
                vx: 0, vy: 0, giri: 0, cp: 0, cpQual: 0,
                migliorGiro: -1, tempoGiroAttuale: 0,
                turboTimer: 0, turboCooldown: 0, olioCooldown: 0, spinTimer: 0,
                giroInvalido: false, inScia: false,
                nome: giocatori[id].name, character: giocatori[id].character,
                finito: false, dnf: false, posizione: 0,
            };
            i++;
        }
        this.totGiocatori = i;
    }

    tick(messaggi: IncomingMsg[], dt: number): OutgoingMsg[] {

        const garaAttiva = this.fase === 'gara' && this.countdownPartenza <= 0;
        const simulazioneAttiva = this.fase === 'qualifiche' || garaAttiva;

        // 1. Input dei giocatori (in qualifica o in gara dopo il semaforo)
        if (simulazioneAttiva) {
            for (const msg of messaggi) {
                const p = msg.payload as MsgInput;
                if (p.kind !== 'input') continue;
                const auto = this.auto[msg.clientId];
                if (!auto) continue;
                if (this.fase === 'gara' && auto.finito) continue;

                if (p.turbo && auto.turboTimer <= 0 && auto.turboCooldown <= 0)
                    auto.turboTimer = TURBO_DURATA;

                if (p.olio && auto.olioCooldown <= 0) {
                    auto.olioCooldown = OLIO_RICARICA;
                    this.olio.push({ x: auto.x - Math.cos(auto.a) * 25, y: auto.y - Math.sin(auto.a) * 25, vita: OLIO_VITA });
                }

                const eraFuoriPista = !sullaStrada(auto.x, auto.y);
                if (this.fase === 'qualifiche' && eraFuoriPista) auto.giroInvalido = true;

                const bonusScia = this.fase === 'gara' ? this.calcolaBonusScia(msg.clientId) : 1;
                auto.inScia = bonusScia > 1;

                auto.prevX = auto.x; auto.prevY = auto.y;
                aggiornaFisica(auto, p, dt, bonusScia, eraFuoriPista);

                if (this.fase === 'qualifiche' && !sullaStrada(auto.x, auto.y)) auto.giroInvalido = true;
            }
        } else if (this.fase === 'gara') {
            // Durante il countdown semaforo tutte le auto restano ferme.
            for (const id in this.auto) {
                const a = this.auto[id];
                a.vx = 0; a.vy = 0; a.inScia = false;
            }
        }

        // 2. Collisioni auto-auto (solo in gara, non in qualifica)
        if (garaAttiva) {
            const ids = Object.keys(this.auto);
            for (let i = 0; i < ids.length - 1; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const a = this.auto[ids[i]], b = this.auto[ids[j]];
                    const d = Math.hypot(a.x - b.x, a.y - b.y);
                    if (d < 12 && d > 0) {
                        const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
                        const ov = (12 - d) / 2;
                        a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
                        const va = a.vx * nx + a.vy * ny, vb = b.vx * nx + b.vy * ny;
                        a.vx += (vb - va) * nx * 0.7; a.vy += (vb - va) * ny * 0.7;
                        b.vx += (va - vb) * nx * 0.7; b.vy += (va - vb) * ny * 0.7;
                    }
                }
            }
        }

        // 3. Chiazze d'olio (in qualifica e gara attiva)
        if (simulazioneAttiva) {
            this.olio = this.olio.filter(o => (o.vita -= dt) > 0);
            for (const id in this.auto) {
                const a = this.auto[id];
                if (a.spinTimer > 0) continue;
                for (const o of this.olio) {
                    if (Math.hypot(a.x - o.x, a.y - o.y) < OLIO_RAGGIO) { a.spinTimer = OLIO_SPIN; break; }
                }
            }
        }

        // 5. Logica di fase
        if      (this.fase === 'qualifiche') this.tickQualifiche(dt);
        else if (this.fase === 'recap')      this.tickRecap(dt);
        else                                 this.tickGara(dt);

        const payload: MsgStato = {
            kind: 'stato', fase: this.fase,
            tempoQual: this.tempoQual, tempoRecap: this.tempoRecap,
            countdownPartenza: this.countdownPartenza, dnfTimer: this.dnfTimer,
            auto: this.auto, olio: this.olio,
            garaFinita: this.garaFinita, gridOrder: this.gridOrder,
            migliorAssoluto: calcolaMigliorAssoluto(this.auto),
        };
        return [{ payload }];
    }

    isFinished(): boolean { return this.garaFinita; }

    // ── Qualifiche ────────────────────────────────────────────────────────────

    private tickQualifiche(dt: number): void {
        this.tempoQual -= dt;

        for (const id in this.auto) {
            const a = this.auto[id];
            a.tempoGiroAttuale += dt * 1000; // accumula in millisecondi

            // Checkpoint in ordine obbligatorio
            for (let i = 0; i < CHECKPOINTS.length; i++) {
                const bit = 1 << i;
                if (a.cpQual & bit) continue;
                if (i > 0 && !(a.cpQual & (1 << (i - 1)))) continue;
                if (Math.hypot(a.x - CHECKPOINTS[i].x, a.y - CHECKPOINTS[i].y) < CHECKPOINTS[i].r)
                    a.cpQual |= bit;
            }

            // Calcola la distanza dal traguardo
            const distTraguardo = Math.hypot(a.x - TRAGUARDO.x, a.y - TRAGUARDO.y);

            // Se l'auto sta passando sul traguardo...
            if (distTraguardo < TRAGUARDO.r) {
                const tuttiCP = (1 << CHECKPOINTS.length) - 1;
                
                // 1. Se ha tutti i checkpoint, è un giro valido: salva il tempo
                if ((a.cpQual & tuttiCP) === tuttiCP) {
                    const t = a.tempoGiroAttuale;
                    if (!a.giroInvalido && (a.migliorGiro < 0 || t < a.migliorGiro)) a.migliorGiro = t;
                }
                
                // 2. In ogni caso (giro valido o primissimo passaggio dalla griglia),
                // azzera il cronometro e i checkpoint per iniziare un giro pulito.
                a.tempoGiroAttuale = 0;
                a.cpQual = 0;
                a.giroInvalido = false;
            }
        }

        // Fine qualifiche → calcola griglia, passa al recap
        if (this.tempoQual <= 0) {
            this.tempoQual = 0;
            this.gridOrder = calcolaGriglia(this.auto);
            // Ferma tutte le auto durante il recap
            for (const id in this.auto) {
                this.auto[id].vx = 0; this.auto[id].vy = 0;
            }
            this.fase = 'recap';
            this.tempoRecap = DURATA_RECAP;
        }
    }

    // ── Recap griglia ─────────────────────────────────────────────────────────

    private tickRecap(dt: number): void {
        this.tempoRecap -= dt;
        if (this.tempoRecap <= 0) {
            this.tempoRecap = 0;
            this.avviaGara();
        }
    }

    /** Riposiziona le auto secondo la griglia e avvia la gara */
    private avviaGara(): void {
        this.fase = 'gara';
        this.countdownPartenza = DURATA_PARTENZA;
        this.dnfTimer = -1;
        this.gridOrder.forEach((id, i) => {
            const g = posGriglia(i);
            const a = this.auto[id];
            a.x = g.x; a.y = g.y; a.prevX = g.x; a.prevY = g.y;
            a.a = g.a; a.vx = 0; a.vy = 0;
            a.giri = 0; a.cp = 0; a.finito = false; a.dnf = false; a.posizione = 0;
            a.giroInvalido = false; a.inScia = false;
        });
    }

    // ── Gara ──────────────────────────────────────────────────────────────────

    private tickGara(dt: number): void {
        if (this.countdownPartenza > 0) {
            this.countdownPartenza = Math.max(0, this.countdownPartenza - dt);
            return;
        }

        let finiti = 0;
        for (const id in this.auto) {
            const a = this.auto[id];
            if (a.finito) { finiti++; continue; }

            for (let i = 0; i < CHECKPOINTS.length; i++) {
                const bit = 1 << i;
                if (a.cp & bit) continue;
                if (i > 0 && !(a.cp & (1 << (i - 1)))) continue;
                if (Math.hypot(a.x - CHECKPOINTS[i].x, a.y - CHECKPOINTS[i].y) < CHECKPOINTS[i].r)
                    a.cp |= bit;
            }

            const tuttiCP = (1 << CHECKPOINTS.length) - 1;
            if ((a.cp & tuttiCP) === tuttiCP &&
                Math.hypot(a.x - TRAGUARDO.x, a.y - TRAGUARDO.y) < TRAGUARDO.r) {
                a.giri++; a.cp = 0;
                if (a.giri >= GIRI_GARA) {
                    a.finito = true;
                    a.posizione = ++finiti;
                    if (finiti === 1) this.dnfTimer = DNF_TIMEOUT;
                }
            }
        }

        if (finiti >= this.totGiocatori) {
            this.garaFinita = true;
            return;
        }

        if (this.dnfTimer >= 0) {
            this.dnfTimer = Math.max(0, this.dnfTimer - dt);
            if (this.dnfTimer === 0) {
                for (const id in this.auto) {
                    const a = this.auto[id];
                    if (!a.finito) {
                        a.finito = true;
                        a.dnf = true;
                        a.posizione = 0;
                    }
                }
                this.garaFinita = true;
            }
        }
    }

    /** Restituisce bonus scia se l'auto è nel cono posteriore di un avversario. */
    private calcolaBonusScia(idInScia: string): number {
        const follower = this.auto[idInScia];
        if (!follower) return 1;

        for (const id in this.auto) {
            if (id === idInScia) continue;
            const leader = this.auto[id];
            if (!leader || leader.finito) continue;

            const dx = follower.x - leader.x;
            const dy = follower.y - leader.y;
            const dist = Math.hypot(dx, dy);
            if (dist > SCIA_DIST_MAX || dist < 8) continue;

            const fwX = Math.cos(leader.a);
            const fwY = Math.sin(leader.a);
            const lungoAsse = -(dx * fwX + dy * fwY);
            if (lungoAsse <= 0) continue;

            const laterale = Math.abs(dx * (-fwY) + dy * fwX);
            const aperturaCono = SCIA_CONE_BASE + lungoAsse * SCIA_CONE_GAIN;
            if (laterale <= aperturaCono) return SCIA_BONUS;
        }

        return 1;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

export class MicroRacingClient extends GameClient {

    private statoServer: Record<string, StatoAuto> | null = null;
    private renderAuto: Record<string, StatoAuto> = {};
    private olioServer: ChiazzaOlio[] = [];
    private fase: Fase     = 'qualifiche';
    private tempoQual      = DURATA_QUALIFICHE;
    private tempoRecap     = DURATA_RECAP;
    private countdownPartenza = 0;
    private dnfTimer = -1;
    private garaFinita     = false;
    private gridOrder: string[] = [];
    private migliorAssoluto = -1;
    private colori: Record<string, string> = {};

    // Telecamera smooth
    private camX = TRAGUARDO.x;
    private camY = TRAGUARDO.y;
    private readonly ZOOM = 1.65;

    private trackCanvas: HTMLCanvasElement | null = null;
    private tasti = { su: false, giu: false, sx: false, dx: false, turbo: false, olio: false };
    private animTime = 0;
    private garaFinitaTimer = -1;
    private goFlashTimer = 0;

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
        this.registraTasti();
    }

    async init(giocatori: Record<string, Player>): Promise<void> {
        let i = 0;
        for (const id in giocatori) this.colori[id] = COLORI_AUTO[i++ % COLORI_AUTO.length];
        this.trackCanvas = this.costruisciCanvas();
    }

    handleMessage(msg: MsgStato): void {
        if (msg.kind !== 'stato') return;
        const countdownPrecedente = this.countdownPartenza;
        this.fase = msg.fase; this.tempoQual = msg.tempoQual; this.tempoRecap = msg.tempoRecap;
        this.countdownPartenza = msg.countdownPartenza; this.dnfTimer = msg.dnfTimer;
        if (countdownPrecedente > 0 && this.countdownPartenza <= 0 && this.fase === 'gara') this.goFlashTimer = 0.9;
        this.olioServer = msg.olio; this.garaFinita = msg.garaFinita; this.gridOrder = msg.gridOrder;
        this.migliorAssoluto = msg.migliorAssoluto;
        if (this.garaFinita && this.garaFinitaTimer < 0) this.garaFinitaTimer = 9;

        if (!this.statoServer) {
            this.statoServer = msg.auto;
            for (const id in msg.auto) this.renderAuto[id] = { ...msg.auto[id] };
            return;
        }
        for (const id in msg.auto) {
            if (!this.statoServer[id]) this.renderAuto[id] = { ...msg.auto[id] };
            this.statoServer[id] = msg.auto[id];
        }
        for (const id in this.statoServer)
            if (!msg.auto[id]) { delete this.statoServer[id]; delete this.renderAuto[id]; }
    }

    flushMessages(): MsgInput[] { return [{ kind: 'input', ...this.tasti }]; }

    isFinished(): boolean { return this.garaFinitaTimer === 0; }

    // ── Loop di rendering ─────────────────────────────────────────────────────

    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        if (!this.statoServer) return;
        this.animTime += dt;
        if (this.garaFinitaTimer > 0) this.garaFinitaTimer = Math.max(0, this.garaFinitaTimer - dt);
        if (this.goFlashTimer > 0) this.goFlashTimer = Math.max(0, this.goFlashTimer - dt);

        const { screenW: W, screenH: H } = this.userInput;
        const me = this.statoServer[this.myId];

        this.interpolaRenderAuto(dt);

        // Durante il recap la camera va al centro del tracciato
        if (this.fase === 'recap') {
            const cx = MONDO_W / 2, cy = MONDO_H / 2;
            this.camX += (cx - this.camX) * Math.min(1, dt * 3);
            this.camY += (cy - this.camY) * Math.min(1, dt * 3);
        } else if (me) {
            this.camX += (me.x - this.camX) * Math.min(1, dt * 9);
            this.camY += (me.y - this.camY) * Math.min(1, dt * 9);
        }

        // Sfondo erba
        ctx.fillStyle = '#3a7d44';
        ctx.fillRect(0, 0, W, H);

        // Trasformazione mondo → schermo
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(this.ZOOM, this.ZOOM);
        ctx.translate(-this.camX, -this.camY);

        if (this.trackCanvas) ctx.drawImage(this.trackCanvas, 0, 0);
        for (const o of this.olioServer) this.disegnaOlio(ctx, o);
        for (const id in this.renderAuto) this.disegnaAuto(ctx, id, this.renderAuto[id]);

        ctx.restore();

        // UI sovrapposta (coordinate schermo)
        if (this.fase === 'recap') {
            this.disegnaRecap(ctx, W, H);
        } else {
            this.disegnaHUD(ctx, me, W, H);
            this.disegnaSemaforoPartenza(ctx, W, H);
            this.disegnaClassifica(ctx, W, H);
            if (this.garaFinitaTimer >= 0) this.disegnaFinale(ctx, me, W, H);
        }
    }

    // ── Interpolazione anti-scatto ────────────────────────────────────────────

    private interpolaRenderAuto(dt: number): void {
        if (!this.statoServer) return;
        const alpha = Math.min(1, dt * 15);
        for (const id in this.statoServer) {
            const target  = this.statoServer[id];
            const current = this.renderAuto[id] ?? { ...target };
            current.x += (target.x - current.x) * alpha;
            current.y += (target.y - current.y) * alpha;
            let da = target.a - current.a;
            while (da >  Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            current.a += da * alpha;
            // Campi gameplay sempre autorevoli (non interpolati)
            current.vx = target.vx; current.vy = target.vy;
            current.giri = target.giri; current.cp = target.cp;
            current.turboTimer = target.turboTimer; current.turboCooldown = target.turboCooldown;
            current.olioCooldown = target.olioCooldown; current.spinTimer = target.spinTimer;
            current.nome = target.nome; current.character = target.character;
            current.finito = target.finito; current.posizione = target.posizione;
            current.migliorGiro = target.migliorGiro;
            current.tempoGiroAttuale = target.tempoGiroAttuale;
            current.cpQual = target.cpQual;
            this.renderAuto[id] = current;
        }
    }

    // ── Disegno auto ─────────────────────────────────────────────────────────

    private disegnaAuto(ctx: CanvasRenderingContext2D, id: string, auto: StatoAuto): void {
        const colore = this.colori[id] ?? '#fff';
        const sonoIo = id === this.myId;
        const CW = 8, CH = 14;

        ctx.save();
        if (this.fase === 'qualifiche' && !sonoIo) ctx.globalAlpha = 0.48;
        ctx.translate(auto.x, auto.y);
        ctx.rotate(auto.a - Math.PI / 2);

        // Ombra
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(-CW / 2 + 1, -CH / 2 + 2, CW, CH);

        // Corpo
        ctx.fillStyle   = auto.finito ? '#888' : colore;
        ctx.strokeStyle = sonoIo ? '#fff' : 'rgba(0,0,0,0.4)';
        ctx.lineWidth   = sonoIo ? 1.5 : 0.8;
        ctx.beginPath(); ctx.roundRect(-CW / 2, -CH / 2, CW, CH, 2); ctx.fill(); ctx.stroke();

        // Parabrezza
        ctx.fillStyle = 'rgba(180,230,255,0.7)';
        ctx.beginPath(); ctx.roundRect(-CW / 2 + 1.5, -CH / 2 + 2, CW - 3, CH * 0.3, 1.5); ctx.fill();

        // Fiamma turbo
        if (auto.turboTimer > 0) {
            const len = 5 + Math.sin(this.animTime * 25) * 2;
            ctx.fillStyle = '#ff7700'; ctx.shadowColor = '#ffaa00'; ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.moveTo(-2.5, CH / 2); ctx.lineTo(0, CH / 2 + len); ctx.lineTo(2.5, CH / 2);
            ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
        }

        // Cerchio giallo spin-out
        if (auto.spinTimer > 0) {
            ctx.strokeStyle = '#ffff00'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.arc(0, 0, CH * 0.8, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.restore();

        // Nome sopra l'auto (sempre orizzontale)
        ctx.save();
        ctx.font = `bold ${sonoIo ? 8 : 7}px Arial`; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(auto.x - 18, auto.y - CH / 2 - 12, 36, 10);
        ctx.fillStyle = sonoIo ? '#ffff88' : '#fff';
        ctx.fillText(auto.nome.substring(0, 8), auto.x, auto.y - CH / 2 - 4);
        ctx.restore();
    }

    private disegnaOlio(ctx: CanvasRenderingContext2D, o: ChiazzaOlio): void {
        ctx.save();
        ctx.globalAlpha = Math.min(0.9, o.vita / 5);
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.ellipse(o.x, o.y, OLIO_RAGGIO, OLIO_RAGGIO * 0.55, 0, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createRadialGradient(o.x - 4, o.y - 2, 1, o.x, o.y, OLIO_RAGGIO);
        g.addColorStop(0, 'rgba(140,0,255,0.5)'); g.addColorStop(0.6, 'rgba(0,210,180,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(o.x, o.y, OLIO_RAGGIO, OLIO_RAGGIO * 0.55, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    // ── HUD qualifiche / gara ─────────────────────────────────────────────────

    private disegnaHUD(ctx: CanvasRenderingContext2D, me: StatoAuto | undefined, W: number, H: number): void {
        if (!me) return;
        const p = 14;
        const pannelloH = this.fase === 'qualifiche' ? 190 : 125;
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(p - 3, p - 3, 235, pannelloH);

        if (this.fase === 'qualifiche') {
            // Countdown qualifiche
            ctx.font = 'bold 14px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#f1c40f';
            ctx.fillText('⏱ QUALIFICHE', p, p + 16);
            const min = Math.floor(this.tempoQual / 60);
            const sec = Math.ceil(this.tempoQual % 60);
            ctx.font = 'bold 36px Arial';
            ctx.fillStyle = this.tempoQual < 30 ? '#e74c3c' : '#fff';
            ctx.fillText(`${min}:${String(sec).padStart(2, '0')}`, p, p + 58);
            ctx.font = '11px Arial'; ctx.fillStyle = '#aaa'; ctx.fillText('Giro corrente:', p, p + 80);
            ctx.font = 'bold 13px Arial'; ctx.fillStyle = '#fff'; ctx.fillText(formatTempo(me.tempoGiroAttuale), p + 95, p + 80);
            ctx.font = '11px Arial'; ctx.fillStyle = '#aaa'; ctx.fillText('Miglior personale:', p, p + 98);
            ctx.font = 'bold 13px Arial'; ctx.fillStyle = '#7fff7f'; ctx.fillText(formatTempo(me.migliorGiro), p + 95, p + 98);
            ctx.font = '11px Arial'; ctx.fillStyle = '#aaa'; ctx.fillText('Miglior assoluto:', p, p + 116);
            ctx.font = 'bold 13px Arial'; ctx.fillStyle = '#f1c40f'; ctx.fillText(formatTempo(this.migliorAssoluto), p + 95, p + 116);
        } else {
            // Giri in gara
            ctx.font = 'bold 24px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
            ctx.fillText(`Giro ${Math.min(me.giri + 1, GIRI_GARA)} / ${GIRI_GARA}`, p, p + 28);
        }

        // Barre turbo e olio
        const turboY = this.fase === 'qualifiche' ? p + 144 : p + 50;
        const turboPct = me.turboTimer > 0 ? me.turboTimer / TURBO_DURATA : Math.max(0, 1 - me.turboCooldown / TURBO_RICARICA);
        this.disegnaBarra(ctx, p, turboY, 185, 12, turboPct,
            me.turboTimer > 0 ? '#ff6a00' : turboPct >= 1 ? '#00aaff' : '#004488', 'TURBO [SPAZIO]');
        const olioPct = Math.max(0, 1 - me.olioCooldown / OLIO_RICARICA);
        this.disegnaBarra(ctx, p, turboY + 28, 185, 12, olioPct, '#222', 'OLIO [SHIFT]', true);

        // Velocità
        const vel = Math.round(Math.hypot(me.vx, me.vy));
        ctx.fillStyle = 'rgba(0,0,0,0.52)'; ctx.fillRect(W - 115, H - 42, 107, 34);
        ctx.font = 'bold 20px Arial'; ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
        ctx.fillText(`${vel} m/s`, W - 10, H - 14);

        // Indicatori gara: scia e timer DNF
        if (this.fase === 'gara' && me.inScia) {
            ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(p - 3, p + 93, 140, 24);
            ctx.font = 'bold 14px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#7ecfff';
            ctx.fillText('SCIA ATTIVA', p + 6, p + 110);
        }
        if (this.fase === 'gara' && this.dnfTimer >= 0 && this.countdownPartenza <= 0) {
            const sec = Math.ceil(this.dnfTimer);
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(W / 2 - 95, 12, 190, 30);
            ctx.textAlign = 'center';
            ctx.font = 'bold 14px Arial';
            ctx.fillStyle = sec <= 10 ? '#ff6b6b' : '#f1c40f';
            ctx.fillText(`DNF tra ${sec}s`, W / 2, 32);
        }
    }

    private disegnaSemaforoPartenza(ctx: CanvasRenderingContext2D, W: number, _H: number): void {
        if (this.fase !== 'gara' || (this.countdownPartenza <= 0 && this.goFlashTimer <= 0)) return;

        const totale = DURATA_PARTENZA;
        const elapsed = totale - this.countdownPartenza;
        const accese = Math.max(0, Math.min(4, Math.floor(elapsed) + 1));
        const inPreStart = this.countdownPartenza > 0;

        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(W / 2 - 140, 14, 280, 82);

        for (let i = 0; i < 4; i++) {
            const x = W / 2 - 90 + i * 60;
            const y = 53;
            const attiva = inPreStart ? i < accese : false;
            ctx.beginPath();
            ctx.arc(x, y, 18, 0, Math.PI * 2);
            ctx.fillStyle = attiva ? '#ff3b30' : '#4a1f1a';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        ctx.textAlign = 'center';
        ctx.font = 'bold 18px Arial';
        if (inPreStart) {
            const sec = Math.ceil(this.countdownPartenza);
            ctx.fillStyle = '#fff';
            ctx.fillText(String(sec), W / 2, 90);
        } else {
            ctx.fillStyle = '#7fff7f';
            ctx.fillText('GO!', W / 2, 90);
        }
    }

    private disegnaBarra(ctx: CanvasRenderingContext2D,
        x: number, y: number, w: number, h: number,
        pct: number, colore: string, etichetta: string, iridescente = false): void {
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
        ctx.fillStyle = colore; ctx.fillRect(x, y, w * pct, h);
        if (iridescente && pct > 0) {
            const g = ctx.createLinearGradient(x, y, x + w * pct, y);
            g.addColorStop(0, 'rgba(140,0,255,0.6)'); g.addColorStop(1, 'rgba(0,255,200,0.6)');
            ctx.fillStyle = g; ctx.fillRect(x, y, w * pct, h);
        }
        ctx.font = 'bold 10px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#bbb';
        ctx.fillText(etichetta, x, y + h + 11);
    }

    // ── Classifica qualifiche / gara ──────────────────────────────────────────

    private disegnaClassifica(ctx: CanvasRenderingContext2D, W: number, _H: number): void {
        if (!this.statoServer) return;

        let voci: [string, StatoAuto][];
        if (this.fase === 'qualifiche') {
            voci = Object.entries(this.statoServer).sort((a, b) => {
                const ta = a[1].migliorGiro < 0 ? Infinity : a[1].migliorGiro;
                const tb = b[1].migliorGiro < 0 ? Infinity : b[1].migliorGiro;
                return ta - tb;
            });
        } else {
            const finiti = Object.entries(this.statoServer)
                .filter(([, a]) => a.finito)
                .sort((a, b) => {
                    if (a[1].dnf !== b[1].dnf) return a[1].dnf ? 1 : -1;
                    if (a[1].dnf && b[1].dnf) return 0;
                    return a[1].posizione - b[1].posizione;
                });
            const inGara = Object.entries(this.statoServer).filter(([, a]) => !a.finito).sort((a, b) => b[1].giri - a[1].giri);
            voci = [...finiti, ...inGara];
        }

        const lbW = 225, rowH = 24, pad = 8;
        const lbX = W - lbW - 10;
        ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(lbX, 10, lbW, rowH * (voci.length + 1) + pad);
        ctx.font = 'bold 12px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#f1c40f';
        ctx.fillText(this.fase === 'qualifiche' ? 'TEMPI QUALIFICHE' : 'CLASSIFICA GARA', lbX + pad, 26);

        const tempoLeader = calcolaMigliorAssoluto(this.statoServer);

        voci.forEach(([id, auto], i) => {
            const ry = 10 + rowH * (i + 1) + pad;
            ctx.fillStyle = this.colori[id] ?? '#fff'; ctx.fillRect(lbX + pad, ry - 11, 9, 12);
            ctx.font = id === this.myId ? 'bold 11px Arial' : '11px Arial';
            ctx.fillStyle = id === this.myId ? '#ffff88' : '#fff'; ctx.textAlign = 'left';
            ctx.fillText(`${i + 1}. ${auto.nome.substring(0, 9)}`, lbX + pad + 13, ry);
            ctx.textAlign = 'right'; ctx.font = '10px Arial'; ctx.fillStyle = '#ccc';
            if (this.fase === 'qualifiche') {
                if (i === 0 && auto.migliorGiro > 0) {
                    ctx.fillStyle = '#7fff7f'; ctx.fillText(formatTempo(auto.migliorGiro), lbX + lbW - pad, ry);
                } else if (auto.migliorGiro > 0 && tempoLeader > 0) {
                    ctx.fillText(`+${auto.migliorGiro - tempoLeader} ms`, lbX + lbW - pad, ry);
                } else {
                    ctx.fillText('--', lbX + lbW - pad, ry);
                }
            } else {
                if (auto.dnf) ctx.fillText('DNF', lbX + lbW - pad, ry);
                else ctx.fillText(auto.finito ? '✓ ARR.' : `G${auto.giri + 1}`, lbX + lbW - pad, ry);
            }
        });
    }

    // ── Schermata RECAP GRIGLIA (tra qualifiche e gara) ───────────────────────

    /**
     * Mostra la griglia di partenza DALL'ULTIMO AL PRIMO:
     * - L'ultimo classificato è in cima alla lista con la sua posizione in griglia
     * - La pole position è in fondo, evidenziata in oro
     * - Countdown in basso prima dell'avvio della gara
     */
    private disegnaRecap(ctx: CanvasRenderingContext2D, W: number, H: number): void {
        if (!this.statoServer) return;

        // Sfondo scuro semitrasparente
        ctx.fillStyle = 'rgba(0,0,0,0.82)';
        ctx.fillRect(0, 0, W, H);

        // Titolo
        ctx.textAlign = 'center';
        ctx.font = 'bold 38px Arial'; ctx.fillStyle = '#f1c40f';
        ctx.fillText('GRIGLIA DI PARTENZA', W / 2, 52);
        ctx.font = '18px Arial'; ctx.fillStyle = '#aaa';
        ctx.fillText('La gara inizia tra...', W / 2, 82);

        // Countdown circolare
        const cd = Math.ceil(this.tempoRecap);
        ctx.font = 'bold 52px Arial'; ctx.fillStyle = '#fff';
        ctx.fillText(String(cd), W / 2, 148);

        // Barra di progresso del countdown
        const progresso = 1 - this.tempoRecap / DURATA_RECAP;
        const barW = 260, barH = 8;
        const barX = W / 2 - barW / 2;
        ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(barX, 158, barW, barH);
        ctx.fillStyle = '#f1c40f'; ctx.fillRect(barX, 158, barW * progresso, barH);

        // Separatore
        ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(W / 2 - 180, 178, 360, 2);

        // Griglia DALL'ULTIMO AL PRIMO
        // gridOrder[0] = pole, gridOrder[last] = ultimo → invertiamo
        const gridRev = [...this.gridOrder].reverse();
        const tempoLeader = this.gridOrder.length > 0
            ? (this.statoServer[this.gridOrder[0]]?.migliorGiro ?? -1)
            : -1;

        const rigaH     = 44;
        const totH      = rigaH * gridRev.length;
        const startY    = 192;
        const listaW    = 440;
        const listaX    = W / 2 - listaW / 2;

        gridRev.forEach((id, idx) => {
            const auto  = this.statoServer![id];
            if (!auto) return;

            // Posizione reale in griglia (1 = pole, che è in fondo nella lista invertita)
            const posizioneGriglia = this.gridOrder.length - idx;
            const isPole  = posizioneGriglia === 1;
            const sonoIo  = id === this.myId;

            const ry = startY + idx * rigaH;

            // Sfondo riga (oro per la pole, azzurro per il giocatore locale, grigio scuro per gli altri)
            if (isPole) {
                ctx.fillStyle = 'rgba(200,155,30,0.35)';
            } else if (sonoIo) {
                ctx.fillStyle = 'rgba(52,152,219,0.28)';
            } else {
                ctx.fillStyle = idx % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.1)';
            }
            ctx.fillRect(listaX, ry, listaW, rigaH - 2);

            // Numero di posizione in griglia (grande, a sinistra)
            ctx.font = `bold ${isPole ? 26 : 22}px Arial`;
            ctx.textAlign = 'left';
            ctx.fillStyle = isPole ? '#f1c40f' : (sonoIo ? '#7ecfff' : '#888');
            ctx.fillText(`P${posizioneGriglia}`, listaX + 10, ry + rigaH * 0.68);

            // Pastiglia colore auto
            ctx.fillStyle = this.colori[id] ?? '#fff';
            ctx.fillRect(listaX + 58, ry + 12, 10, rigaH - 26);

            // Nome pilota
            ctx.font = sonoIo ? 'bold 16px Arial' : '15px Arial';
            ctx.fillStyle = sonoIo ? '#ffff88' : '#fff';
            ctx.fillText(auto.nome.substring(0, 14), listaX + 76, ry + rigaH * 0.66);

            // Tempo qualifiche (a destra)
            ctx.textAlign = 'right';
            ctx.font = isPole ? 'bold 14px Arial' : '13px Arial';
            if (isPole && auto.migliorGiro > 0) {
                // Leader: tempo assoluto in verde
                ctx.fillStyle = '#7fff7f';
                ctx.fillText(formatTempo(auto.migliorGiro), listaX + listaW - 10, ry + rigaH * 0.66);
            } else if (auto.migliorGiro > 0 && tempoLeader > 0) {
                // Altri: distacco in ms dal leader
                ctx.fillStyle = '#ccc';
                ctx.fillText(`+${auto.migliorGiro - tempoLeader} ms`, listaX + listaW - 10, ry + rigaH * 0.66);
            } else {
                ctx.fillStyle = '#666';
                ctx.fillText('senza tempo', listaX + listaW - 10, ry + rigaH * 0.66);
            }

            // Bandierina piccola per il leader
            if (isPole) {
                ctx.textAlign = 'left';
                ctx.font = '12px Arial'; ctx.fillStyle = '#f1c40f';
                ctx.fillText('🏆 POLE', listaX + 76, ry + rigaH * 0.66 - 16);
            }
        });

        // Nota finale
        ctx.textAlign = 'center';
        ctx.font = '13px Arial'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('Le macchine vengono riposizionate automaticamente', W / 2, startY + totH + 22);
    }

    // ── Schermata di fine gara ────────────────────────────────────────────────

    private disegnaFinale(ctx: CanvasRenderingContext2D, me: StatoAuto | undefined, W: number, H: number): void {
        ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(0, 0, W, H);
        ctx.textAlign = 'center';
        ctx.font = 'bold 52px Arial'; ctx.fillStyle = '#f1c40f';
        ctx.fillText('GARA FINITA!', W / 2, H / 2 - 90);
        if (me?.finito) {
            ctx.font = 'bold 26px Arial'; ctx.fillStyle = '#fff';
            ctx.fillText(me.dnf ? 'DNF' : `Hai concluso ${me.posizione}°!`, W / 2, H / 2 - 40);
        }
        if (this.statoServer) {
            const finiti = Object.values(this.statoServer)
                .filter(a => a.finito && !a.dnf)
                .sort((a, b) => a.posizione - b.posizione)
                .slice(0, 3);
            const medals = ['🥇', '🥈', '🥉'];
            finiti.forEach((a, i) => {
                ctx.font = `${i === 0 ? 'bold 26px' : '21px'} Arial`; ctx.fillStyle = '#fff';
                ctx.fillText(`${medals[i] ?? ''} ${a.nome}`, W / 2, H / 2 + 20 + i * 38);
                const draw = getCharacterDrawFunction(a.character);
                if (draw) draw(ctx, W / 2 - 80 + i * 80, H / 2 + 10 + i * 38, 14, 40);
            });
        }
    }

    // ── Canvas della pista (costruito una sola volta) ─────────────────────────

    private costruisciCanvas(): HTMLCanvasElement {
        const oc = document.createElement('canvas');
        oc.width = MONDO_W; oc.height = MONDO_H;
        const c = oc.getContext('2d')!;

        // Erba con righe alternate per profondità visiva
        c.fillStyle = '#2d6a35'; c.fillRect(0, 0, MONDO_W, MONDO_H);
        c.fillStyle = '#2a6130';
        for (let y = 0; y < MONDO_H; y += 60) c.fillRect(0, y, MONDO_W, 30);

        // Asfalto principale (linea larga che segue i waypoint)
        c.strokeStyle = '#4a4a4a';
        c.lineWidth   = LARGHEZZA_PISTA;
        c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath();
        c.moveTo(WAYPOINTS[0].x, WAYPOINTS[0].y);
        for (let i = 1; i <= WAYPOINTS.length; i++)
            c.lineTo(WAYPOINTS[i % WAYPOINTS.length].x, WAYPOINTS[i % WAYPOINTS.length].y);
        c.stroke();

        // Striscia centrale (linea bianca tratteggiata)
        c.strokeStyle = 'rgba(255,255,255,0.22)';
        c.lineWidth   = 2; c.setLineDash([18, 14]);
        c.beginPath();
        c.moveTo(WAYPOINTS[0].x, WAYPOINTS[0].y);
        for (let i = 1; i <= WAYPOINTS.length; i++)
            c.lineTo(WAYPOINTS[i % WAYPOINTS.length].x, WAYPOINTS[i % WAYPOINTS.length].y);
        c.stroke();
        c.setLineDash([]);

        // Cordoli rossi/bianchi ai checkpoint
        for (const cp of CHECKPOINTS) {
            for (let j = -4; j <= 4; j++) {
                c.fillStyle = j % 2 === 0 ? '#cc0000' : '#ffffff';
                c.fillRect(cp.x - 4 + j * 3, cp.y - cp.r * 0.6, 3, cp.r * 1.2);
            }
        }

        // Linea del traguardo (scacchi)
        const t = TRAGUARDO;
        for (let row = 0; row < 5; row++)
            for (let col = 0; col < 10; col++) {
                c.fillStyle = (row + col) % 2 === 0 ? '#ffffff' : '#000000';
                c.fillRect(t.x - 25 + col * 5, t.y - 25 + row * 5, 5, 5);
            }

        // Texture asfalto (punti random per varietà visiva)
        c.fillStyle = 'rgba(0,0,0,0.07)';
        for (let i = 0; i < 10000; i++) {
            const rx = Math.random() * MONDO_W;
            const ry = Math.random() * MONDO_H;
            if (sullaStrada(rx, ry)) c.fillRect(rx, ry, 2, 2);
        }

        // Numeri di curva (piccoli, sull'asfalto accanto ai checkpoint)
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.font = 'bold 22px Arial'; c.textAlign = 'center';
        CHECKPOINTS.forEach((cp, i) => c.fillText(String(i + 1), cp.x, cp.y + 8));

        return oc;
    }

    // ── Gestione tasti ────────────────────────────────────────────────────────

    private registraTasti(): void {
        const set = (e: KeyboardEvent, v: boolean) => {
            if (e.code === 'KeyW' || e.code === 'ArrowUp')         this.tasti.su    = v;
            if (e.code === 'KeyS' || e.code === 'ArrowDown')       this.tasti.giu   = v;
            if (e.code === 'KeyA' || e.code === 'ArrowLeft')       this.tasti.sx    = v;
            if (e.code === 'KeyD' || e.code === 'ArrowRight')      this.tasti.dx    = v;
            if (e.code === 'Space')                                { this.tasti.turbo = v; if (v) e.preventDefault(); }
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.tasti.olio  = v;
        };
        document.addEventListener('keydown', e => set(e, true));
        document.addEventListener('keyup',   e => set(e, false));
    }
}