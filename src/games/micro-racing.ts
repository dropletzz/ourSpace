/**
 * MicroRacingGame.ts  —  "Circuit Ourspace"
 * ==========================================
 * Flusso: Qualifiche (3 min) → Recap griglia → Semaforo → Gara (3 giri) → DNF / Finale → Podio
 *
 * FUNZIONALITÀ IMPLEMENTATE:
 *  1. DNF Timer       – 30s dopo il primo classificato, poi DNF a chi non ha finito.
 *  2. Ghosting        – In qualifica le auto si attraversano e sono semi-trasparenti.
 *  3. Semaforo        – 4 luci rosse + GO! prima del via, input bloccati nel frattempo.
 *  4. Fuori pista     – Erba: attrito alto, accel ridotta, vel max dimezzata, giro invalido.
 *  5. 8 Checkpoint    – Distribuiti su tutto il giro, impediscono tagli aggressivi.
 *  6. Scia            – Bonus +15% vel max nel cono posteriore dell'avversario.
 *
 * ARCHITETTURA: GameServer (Node.js autoritative) + GameClient (browser, interpolazione).
 */

import { Player }                   from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer }   from './game';
import { UserInput }                from '../client/user-input';
import { getCharacterDrawFunction } from '../client/characters';


// ═══════════════════════════════════════════════════════════════════════════════
//  TRACCIATO  —  "Circuit Ourspace"
// ═══════════════════════════════════════════════════════════════════════════════

const MONDO_W = 4800;
const MONDO_H = 3800;
const LARGHEZZA_PISTA = 160; // ampia per permettere sorpassi side-by-side
const MARGINE_QUALI = 10; // px di tolleranza per evitare falsi track-limits in qualifica

/**
 * Waypoint della linea centrale (senso orario).
 * Il punto 0 è il primo waypoint DOPO il traguardo sul rettilineo principale,
 * così la griglia di partenza (posizionata ~200px più a sud) non coincide mai
 * con il raggio del traguardo all'avvio → nessun falso "primo giro".
 */
const WAYPOINTS: { x: number; y: number }[] = [
    // Rettilineo principale (lato est, verso nord)
    { x: 3800, y: 2400 },   // 0  — griglia qui (sotto il traguardo)
    { x: 3800, y: 2100 },   // 1  — traguardo a y≈2250, tra qui e il punto precedente
    { x: 3800, y: 1800 },   // 2
    { x: 3800, y: 1550 },   // 3
    // Tornante 90° verso ovest (curva 1 — lenta)
    { x: 3700, y: 1380 },   // 4
    { x: 3500, y: 1270 },   // 5
    { x: 3300, y: 1230 },   // 6
    // Rettilineo nord-ovest → curva veloce sinistra (curva 2)
    { x: 3000, y: 1210 },   // 7
    { x: 2700, y: 1200 },   // 8
    { x: 2450, y: 1250 },   // 9
    { x: 2250, y: 1370 },   // 10
    // Esse veloci S1 destra (curva 3)
    { x: 2100, y: 1280 },   // 11
    { x: 1950, y: 1160 },   // 12
    { x: 1800, y: 1200 },   // 13
    { x: 1680, y: 1320 },   // 14
    // S2 sinistra (curva 4)
    { x: 1550, y: 1240 },   // 15
    { x: 1420, y: 1160 },   // 16
    { x: 1260, y: 1190 },   // 17
    // Rettilineo ovest → chicane sx/dx (curve 5+6)
    { x: 1050, y: 1300 },   // 18
    { x:  870, y: 1450 },   // 19
    { x:  780, y: 1620 },   // 20
    { x:  870, y: 1800 },   // 21
    // Grande curva a U verso sud (curva 7 — lenta, tecnica)
    { x:  900, y: 2000 },   // 22
    { x:  820, y: 2200 },   // 23
    { x:  750, y: 2450 },   // 24
    { x:  820, y: 2650 },   // 25
    { x: 1000, y: 2780 },   // 26
    // Rettilineo sud → doppia chicane dx/sx (curve 8+9)
    { x: 1350, y: 2820 },   // 27
    { x: 1700, y: 2820 },   // 28
    { x: 2000, y: 2750 },   // 29
    { x: 2150, y: 2620 },   // 30
    { x: 2300, y: 2750 },   // 31
    { x: 2500, y: 2820 },   // 32
    // Rettilineo finale verso traguardo (sud-est)
    { x: 2850, y: 2820 },   // 33
    { x: 3200, y: 2750 },   // 34
    { x: 3500, y: 2620 },   // 35
    { x: 3700, y: 2500 },   // 36
    // → si ricongiunge a wp[0]
];

/**
 * 8 checkpoint distribuiti uniformemente sul giro.
 * Devono essere attraversati in ordine numerico — impediscono tagli aggressivi
 * e la guida al contrario per gonfiare i tempi.
 */
const CHECKPOINTS = [
    { x: 3500, y: 1270, r: 90 },  // CP1: uscita tornante nord-est
    { x: 2700, y: 1200, r: 90 },  // CP2: rettilineo nord
    { x: 1800, y: 1200, r: 90 },  // CP3: esse centrali
    { x:  870, y: 1450, r: 90 },  // CP4: ingresso chicane ovest
    { x:  750, y: 2450, r: 90 },  // CP5: fondo curva a U
    { x: 1350, y: 2820, r: 90 },  // CP6: rettilineo sud
    { x: 2150, y: 2620, r: 90 },  // CP7: doppia chicane sud-est
    { x: 3200, y: 2750, r: 90 },  // CP8: lancio verso traguardo
];

// Il traguardo è posizionato sopra la griglia di partenza sul rettilineo est.
// Le auto partono a y≈2400+, il traguardo è a y=2250 → mai sovrapposti.
const TRAGUARDO    = { x: 3800, y: 2250, r: 80 };
// Offset griglia: file alternate a sinistra/destra, avanzano verso sud (y crescente)
const GRIGLIA_BASE = { dx: 35, dy: 90 };


// ═══════════════════════════════════════════════════════════════════════════════
//  COSTANTI FISICHE
// ═══════════════════════════════════════════════════════════════════════════════

const ACCEL          = 290;    // px/s² accelerazione su asfalto
const FRENO          = 560;    // px/s² frenata
const ATTRITO        = 120;    // px/s² attrito passivo su asfalto
const STERZO_RAD     = 3.8;   // rad/s velocità di sterzata
const VEL_MAX        = 315;    // px/s velocità massima su asfalto

// ── Penalità fuori pista (punto 4) ────────────────────────────────────────────
// L'auto non rimbalza ma viene fortemente penalizzata sull'erba.
const ERBA_ACCEL_MULT  = 0.5;   // accelerazione ridotta al 50%
const ERBA_VELMAX_MULT = 0.4;   // velocità massima ridotta al 40%
const ERBA_ATTRITO_ADD = 0;     // attrito aggiuntivo sull'erba (si somma a ATTRITO)
//   → attrito totale su erba = 130 px/s² — resta lento ma può rientrare da fermo

const DRIFT          = 0.86;   // ritenzione velocità laterale (effetto derapata)

// ── Turbo ─────────────────────────────────────────────────────────────────────
const TURBO_BONUS    = 1.80;
const TURBO_DURATA   = 0.8;    // secondi
const TURBO_RICARICA = 4.0;    // secondi cooldown

// ── Olio ──────────────────────────────────────────────────────────────────────
const OLIO_RAGGIO    = 20;     // px raggio chiazza
const OLIO_SPIN      = 1.4;    // secondi di spin-out
const OLIO_RICARICA  = 5.0;
const OLIO_VITA      = 25.0;

// ── Timing di gara ────────────────────────────────────────────────────────────
const DURATA_QUALIFICHE = 100;  // secondi (TODO: rimettere a 180 = 3 min per produzione)
const DURATA_RECAP      = 8;    // secondi schermata griglia
const DURATA_PARTENZA   = 4;    // secondi semaforo (4 luci, 1 per secondo)
const DNF_TIMEOUT       = 30;   // secondi dopo il 1° classificato prima del DNF globale
const GIRI_GARA         = 3;

// ── Scia (punto 6) ────────────────────────────────────────────────────────────
const SCIA_BONUS      = 1.15;  // +15% vel max quando si è in scia
const SCIA_DIST_MAX   = 180;   // px: distanza massima per la scia
const SCIA_CONE_BASE  = 18;    // px: apertura base del cono posteriore
const SCIA_CONE_GAIN  = 0.35;  // px laterali per px di distanza (cono allargato)

const COLORI_AUTO = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];


// ═══════════════════════════════════════════════════════════════════════════════
//  TIPI CONDIVISI  (server ↔ client via JSON)
// ═══════════════════════════════════════════════════════════════════════════════

type Fase = 'qualifiche' | 'recap' | 'gara';

interface StatoAuto {
    x: number; y: number;
    a: number; vx: number; vy: number;
    // Gara
    giri: number;
    cp: number;             // bitmask checkpoint raccolti nel giro corrente (gara)
    // Qualifiche
    cpQual: number;         // bitmask checkpoint raccolti nel giro corrente (quali)
    migliorGiro: number;    // ms, -1 = nessun giro valido
    tempoGiroAttuale: number; // ms dall'inizio del giro corrente
    sulTraguardo: boolean;  // true = auto attualmente nel raggio del traguardo
                            // usato per l'edge-detection: conta solo l'INGRESSO nel raggio
    giroInvalido: boolean;  // true = è uscito dalla pista in questo giro (quali)
    // Power-up
    turboTimer: number; turboCooldown: number;
    olioCooldown: number; spinTimer: number;
    // Meccaniche speciali
    inScia: boolean;        // true = sta beneficiando della scia
    // Metadati
    nome: string; character: string;
    finito: boolean; dnf: boolean; posizione: number;
}

interface ChiazzaOlio { x: number; y: number; vita: number; }

interface MsgInput {
    kind: 'input';
    su: boolean; giu: boolean; sx: boolean; dx: boolean;
    turbo: boolean; olio: boolean;
    mouseAngolo: number;
}

interface MsgStato {
    kind: 'stato';
    fase: Fase;
    tempoQual: number;          // secondi rimasti alle qualifiche
    tempoRecap: number;         // secondi rimasti al recap
    countdownPartenza: number;  // secondi rimasti al semaforo
    dnfTimer: number;           // secondi rimasti prima del DNF globale (-1 = non attivo)
    auto: Record<string, StatoAuto>;
    olio: ChiazzaOlio[];
    garaFinita: boolean;
    gridOrder: string[];
    migliorAssoluto: number;    // ms del giro più veloce tra tutti
}


// ═══════════════════════════════════════════════════════════════════════════════
//  FUNZIONI DI UTILITÀ
// ═══════════════════════════════════════════════════════════════════════════════

/** Distanza minima dal punto P al segmento A→B */
function distSegmento(px: number, py: number,
                      ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** true se il punto (cx, cy) è sull'asfalto */
function sullaStrada(cx: number, cy: number): boolean {
    for (let i = 0; i < WAYPOINTS.length; i++) {
        const a = WAYPOINTS[i];
        const b = WAYPOINTS[(i + 1) % WAYPOINTS.length];
        if (distSegmento(cx, cy, a.x, a.y, b.x, b.y) < LARGHEZZA_PISTA / 2) return true;
    }
    return false;
}

function sullaStradaConMargine(cx: number, cy: number, extra: number): boolean {
    const limite = LARGHEZZA_PISTA / 2 + extra;
    for (let i = 0; i < WAYPOINTS.length; i++) {
        const a = WAYPOINTS[i];
        const b = WAYPOINTS[(i + 1) % WAYPOINTS.length];
        if (distSegmento(cx, cy, a.x, a.y, b.x, b.y) < limite) return true;
    }
    return false;
}

/** Ordina gli id per miglior tempo di qualifica (senza tempo → in fondo) */
function calcolaGriglia(auto: Record<string, StatoAuto>): string[] {
    return Object.keys(auto).sort((a, b) => {
        const ta = auto[a].migliorGiro < 0 ? Infinity : auto[a].migliorGiro;
        const tb = auto[b].migliorGiro < 0 ? Infinity : auto[b].migliorGiro;
        return ta - tb;
    });
}

/** Miglior tempo assoluto tra tutti i giocatori (-1 se nessuno ha girato) */
function calcolaMigliorAssoluto(auto: Record<string, StatoAuto>): number {
    let best = Infinity;
    for (const id in auto) {
        const t = auto[id].migliorGiro;
        if (t >= 0 && t < best) best = t;
    }
    return best === Infinity ? -1 : best;
}

/** ms → "m:ss,ddd" (es. 68423 → "1:08,423") */
function formatTempo(ms: number): string {
    if (ms < 0) return '--:--.---';
    const min  = Math.floor(ms / 60000);
    const sec  = Math.floor((ms % 60000) / 1000);
    const mill = Math.floor(ms % 1000);
    return `${min}:${String(sec).padStart(2, '0')},${String(mill).padStart(3, '0')}`;
}

function normalizzaAngolo(rad: number): number {
    while (rad > Math.PI) rad -= Math.PI * 2;
    while (rad < -Math.PI) rad += Math.PI * 2;
    return rad;
}

/**
 * Aggiorna la fisica dell'auto per dt secondi.
 * Usata sia dal server (tutti) sia internamente per eventuali predizioni lato client.
 *
 * @param bonusScia   moltiplicatore vel max da scia (1 = nessuna scia)
 * @param fuoriPista  true = penalità erba attive
 */
function aggiornaFisica(
    auto: StatoAuto,
    input: { su: boolean; giu: boolean; sx: boolean; dx: boolean; mouseAngolo: number },
    dt: number,
    bonusScia: number,
    fuoriPista: boolean,
): void {
    // Aggiorna timer
    if (auto.spinTimer     > 0) auto.spinTimer     = Math.max(0, auto.spinTimer     - dt);
    if (auto.turboTimer    > 0) {
        auto.turboTimer -= dt;
        if (auto.turboTimer <= 0) auto.turboCooldown = TURBO_RICARICA;
    }
    if (auto.turboCooldown > 0) auto.turboCooldown = Math.max(0, auto.turboCooldown - dt);
    if (auto.olioCooldown  > 0) auto.olioCooldown  = Math.max(0, auto.olioCooldown  - dt);

    // Spin-out: ruota vorticosamente e frena da sola
    if (auto.spinTimer > 0) {
        auto.a += 5.5 * dt;
        const v = Math.hypot(auto.vx, auto.vy);
        if (v > 0) {
            const f = Math.min(v, ATTRITO * 3 * dt);
            auto.vx -= (auto.vx / v) * f;
            auto.vy -= (auto.vy / v) * f;
        }
        auto.x += auto.vx * dt;
        auto.y += auto.vy * dt;
        return;
    }

    if (Number.isFinite(input.mouseAngolo)) {
        const diff = normalizzaAngolo(input.mouseAngolo - auto.a);
        const maxTurn = STERZO_RAD * dt * 1.7;
        auto.a += Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);
    } else {
        if (input.sx) auto.a -= STERZO_RAD * dt;
        if (input.dx) auto.a += STERZO_RAD * dt;
    }

    const fw = { x: Math.cos(auto.a), y: Math.sin(auto.a) };

    // Parametri fisici modulati dalla superficie e dalla scia
    const accelMax = fuoriPista ? ACCEL * ERBA_ACCEL_MULT : ACCEL;
    const velMax   = VEL_MAX
        * (fuoriPista ? ERBA_VELMAX_MULT : 1)
        * (auto.turboTimer > 0 ? TURBO_BONUS : 1)
        * bonusScia;
    const attritoTot = fuoriPista ? ATTRITO + ERBA_ATTRITO_ADD : ATTRITO;

    if (input.su) {
        auto.vx += fw.x * accelMax * dt;
        auto.vy += fw.y * accelMax * dt;
    }
    if (input.giu) {
        const v = Math.hypot(auto.vx, auto.vy);
        if (v > 5) {
            auto.vx -= (auto.vx / v) * FRENO * dt;
            auto.vy -= (auto.vy / v) * FRENO * dt;
        }
    }

    // Drift: decompone in avanti + laterale e riduce la laterale
    const fwdVel = auto.vx * fw.x + auto.vy * fw.y;
    const latX   = auto.vx - fw.x * fwdVel;
    const latY   = auto.vy - fw.y * fwdVel;
    auto.vx = fw.x * fwdVel + latX * DRIFT;
    auto.vy = fw.y * fwdVel + latY * DRIFT;

    // Attrito passivo (più forte su erba)
    const v = Math.hypot(auto.vx, auto.vy);
    if (v > 0) {
        const f = Math.min(v, attritoTot * dt);
        auto.vx -= (auto.vx / v) * f;
        auto.vy -= (auto.vy / v) * f;
    }

    // Clamp velocità massima
    const vAtt = Math.hypot(auto.vx, auto.vy);
    if (vAtt > velMax) {
        auto.vx = (auto.vx / vAtt) * velMax;
        auto.vy = (auto.vy / vAtt) * velMax;
    }

    auto.x += auto.vx * dt;
    auto.y += auto.vy * dt;
}

/** Posizione di griglia: file alternate sinistra/destra, avanzano verso sud */
function posGriglia(i: number): { x: number; y: number; a: number } {
    const lato = i % 2 === 0 ? -1 : 1;
    const fila  = Math.floor(i / 2);
    return {
        x: TRAGUARDO.x + lato * GRIGLIA_BASE.dx,
        y: TRAGUARDO.y + 150 + fila * GRIGLIA_BASE.dy, // 150px sotto il traguardo
        a: -Math.PI / 2,   // punta verso nord
    };
}


// ═══════════════════════════════════════════════════════════════════════════════
//  SERVER  —  autoritative, gira su Node.js
// ═══════════════════════════════════════════════════════════════════════════════

export class MicroRacingServer extends GameServer {

    private auto: Record<string, StatoAuto> = {};
    private olio: ChiazzaOlio[] = [];
    private fase: Fase          = 'qualifiche';
    private tempoQual           = DURATA_QUALIFICHE;
    private tempoRecap          = DURATA_RECAP;
    private countdownPartenza   = 0;    // >0 = semaforo attivo, input bloccati
    private dnfTimer            = -1;   // -1 = non attivo
    private gridOrder: string[] = [];
    private garaFinita          = false;
    private totGiocatori        = 0;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    init(giocatori: Record<string, Player>): void {
        let i = 0;
        for (const id in giocatori) {
            const g = posGriglia(i);
            this.auto[id] = {
                x: g.x, y: g.y, a: g.a, vx: 0, vy: 0,
                giri: 0, cp: 0, cpQual: 0,
                migliorGiro: -1, tempoGiroAttuale: 0,
                sulTraguardo: false,   // edge-detection: falso all'avvio
                giroInvalido: false,
                turboTimer: 0, turboCooldown: 0, olioCooldown: 0, spinTimer: 0,
                inScia: false,
                nome: giocatori[id].name, character: giocatori[id].character,
                finito: false, dnf: false, posizione: 0,
            };
            i++;
        }
        this.totGiocatori = i;
    }

    tick(messaggi: IncomingMsg[], dt: number): OutgoingMsg[] {
        const garaAttiva      = this.fase === 'gara' && this.countdownPartenza <= 0;
        const simulazioneOn   = this.fase === 'qualifiche' || garaAttiva;

        // ── 1. Input giocatori ────────────────────────────────────────────────
        if (simulazioneOn) {
            for (const msg of messaggi) {
                const p = msg.payload as MsgInput;
                if (p.kind !== 'input') continue;
                const auto = this.auto[msg.clientId];
                if (!auto || (garaAttiva && auto.finito)) continue;

                // Turbo
                if (p.turbo && auto.turboTimer <= 0 && auto.turboCooldown <= 0)
                    auto.turboTimer = TURBO_DURATA;

                // Olio: lascia la chiazza dietro l'auto solo in gara
                if (this.fase === 'gara' && p.olio && auto.olioCooldown <= 0) {
                    auto.olioCooldown = OLIO_RICARICA;
                    this.olio.push({
                        x: auto.x - Math.cos(auto.a) * 25,
                        y: auto.y - Math.sin(auto.a) * 25,
                        vita: OLIO_VITA,
                    });
                }

                // Fuori pista prima del movimento
                const fuoriPrima = !sullaStradaConMargine(auto.x, auto.y, MARGINE_QUALI);
                if (this.fase === 'qualifiche' && fuoriPrima) auto.giroInvalido = true;

                // Scia (solo in gara)
                const bonusScia = garaAttiva ? this.calcolaBonusScia(msg.clientId) : 1;
                auto.inScia = bonusScia > 1;

                aggiornaFisica(auto, p, dt, bonusScia, fuoriPrima);

                // Fuori pista dopo il movimento (nel caso sia uscito durante il tick)
                if (this.fase === 'qualifiche' && !sullaStradaConMargine(auto.x, auto.y, MARGINE_QUALI))
                    auto.giroInvalido = true;
            }
        } else if (this.fase === 'gara') {
            // Semaforo attivo: auto ferme, nessuna scia
            for (const id in this.auto) {
                this.auto[id].vx = 0;
                this.auto[id].vy = 0;
                this.auto[id].inScia = false;
            }
        }

        // ── 2. Collisioni auto-auto (solo in gara — ghosting in qualifica) ────
        if (garaAttiva) {
            const ids = Object.keys(this.auto);
            for (let i = 0; i < ids.length - 1; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const a = this.auto[ids[i]], b = this.auto[ids[j]];
                    const d = Math.hypot(a.x - b.x, a.y - b.y);
                    if (d < 12 && d > 0) {
                        const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
                        const ov = (12 - d) / 2;
                        a.x -= nx * ov; a.y -= ny * ov;
                        b.x += nx * ov; b.y += ny * ov;
                        const va = a.vx * nx + a.vy * ny, vb = b.vx * nx + b.vy * ny;
                        a.vx += (vb - va) * nx * 0.7; a.vy += (vb - va) * ny * 0.7;
                        b.vx += (va - vb) * nx * 0.7; b.vy += (va - vb) * ny * 0.7;
                    }
                }
            }
        }

        // ── 3. Chiazze d'olio (invecchiano e fanno slittare) ─────────────────
        if (simulazioneOn) {
            this.olio = this.olio.filter(o => (o.vita -= dt) > 0);
            for (const id in this.auto) {
                const a = this.auto[id];
                if (a.spinTimer > 0) continue;
                for (const o of this.olio) {
                    if (Math.hypot(a.x - o.x, a.y - o.y) < OLIO_RAGGIO) {
                        a.spinTimer = OLIO_SPIN;
                        break;
                    }
                }
            }
        }

        // ── 4. Logica di fase ─────────────────────────────────────────────────
        if      (this.fase === 'qualifiche') this.tickQualifiche(dt);
        else if (this.fase === 'recap')      this.tickRecap(dt);
        else                                 this.tickGara(dt);

        // ── 5. Broadcast stato ────────────────────────────────────────────────
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

            // Accumula tempo giro (in millisecondi)
            a.tempoGiroAttuale += dt * 1000;

            // Checkpoint in ordine obbligatorio
            for (let i = 0; i < CHECKPOINTS.length; i++) {
                const bit = 1 << i;
                if (a.cpQual & bit) continue;
                if (i > 0 && !(a.cpQual & (1 << (i - 1)))) continue;
                if (Math.hypot(a.x - CHECKPOINTS[i].x, a.y - CHECKPOINTS[i].y) < CHECKPOINTS[i].r)
                    a.cpQual |= bit;
            }

            // Edge-detection traguardo: il giro si conta solo all'INGRESSO nel raggio.
            // Senza questo, ogni tick in cui l'auto è nel raggio verrebbe contato
            // come un nuovo "passaggio", resettando il cronometro più volte.
            const nelRaggio = Math.hypot(a.x - TRAGUARDO.x, a.y - TRAGUARDO.y) < TRAGUARDO.r;
            const tuttiCP   = (1 << CHECKPOINTS.length) - 1;

            if (nelRaggio && !a.sulTraguardo) {
                // L'auto è appena entrata nel raggio del traguardo
                if ((a.cpQual & tuttiCP) === tuttiCP) {
                    // Giro valido: salva il tempo se non è invalido e se è il migliore
                    if (!a.giroInvalido) {
                        const t = a.tempoGiroAttuale;
                        if (a.migliorGiro < 0 || t < a.migliorGiro) a.migliorGiro = t;
                    }
                }
                // In ogni caso (giro valido, invalido, o primo passaggio dalla griglia):
                // resetta cronometro e checkpoint per iniziare un giro pulito.
                a.tempoGiroAttuale = 0;
                a.cpQual = 0;
                a.giroInvalido = false;
            }

            a.sulTraguardo = nelRaggio;
        }

        // Fine qualifiche → calcola griglia e passa al recap
        if (this.tempoQual <= 0) {
            this.tempoQual = 0;
            this.gridOrder = calcolaGriglia(this.auto);
            for (const id in this.auto) { this.auto[id].vx = 0; this.auto[id].vy = 0; }
            this.fase      = 'recap';
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

    /** Riposiziona le auto in griglia secondo i risultati delle qualifiche e accende il semaforo */
    private avviaGara(): void {
        this.fase               = 'gara';
        this.countdownPartenza  = DURATA_PARTENZA;
        this.dnfTimer           = -1;

        this.gridOrder.forEach((id, i) => {
            const g = posGriglia(i);
            const a = this.auto[id];
            a.x = g.x; a.y = g.y; a.a = g.a;
            a.vx = 0; a.vy = 0;
            a.giri = 0; a.cp = 0;
            a.sulTraguardo = false;  // fondamentale: riparte fuori dal raggio
            a.finito = false; a.dnf = false; a.posizione = 0;
            a.giroInvalido = false; a.inScia = false;
        });
    }

    // ── Gara ──────────────────────────────────────────────────────────────────

    private tickGara(dt: number): void {
        // Semaforo: decrementa il countdown; input bloccati nel tick() sopra
        if (this.countdownPartenza > 0) {
            this.countdownPartenza = Math.max(0, this.countdownPartenza - dt);
            return; // nessuna logica di checkpoint finché non parte
        }

        let finiti = 0;
        for (const id in this.auto) {
            const a = this.auto[id];
            if (a.finito) { finiti++; continue; }

            // Checkpoint in ordine obbligatorio
            for (let i = 0; i < CHECKPOINTS.length; i++) {
                const bit = 1 << i;
                if (a.cp & bit) continue;
                if (i > 0 && !(a.cp & (1 << (i - 1)))) continue;
                if (Math.hypot(a.x - CHECKPOINTS[i].x, a.y - CHECKPOINTS[i].y) < CHECKPOINTS[i].r)
                    a.cp |= bit;
            }

            // Edge-detection traguardo anche in gara
            const nelRaggio = Math.hypot(a.x - TRAGUARDO.x, a.y - TRAGUARDO.y) < TRAGUARDO.r;
            const tuttiCP   = (1 << CHECKPOINTS.length) - 1;

            if (nelRaggio && !a.sulTraguardo) {
                if ((a.cp & tuttiCP) === tuttiCP) {
                    a.giri++;
                    a.cp = 0;
                    if (a.giri >= GIRI_GARA) {
                        a.finito    = true;
                        a.posizione = ++finiti;
                        // Primo classificato: avvia il conto alla rovescia DNF
                        if (finiti === 1) this.dnfTimer = DNF_TIMEOUT;
                    }
                } else {
                    a.cp = 0;
                }
            }

            a.sulTraguardo = nelRaggio;
        }

        // Tutti hanno finito → gara conclusa
        if (finiti >= this.totGiocatori) {
            this.garaFinita = true;
            return;
        }

        // DNF globale: allo scadere del timer, chi non ha finito prende DNF
        if (this.dnfTimer >= 0) {
            this.dnfTimer = Math.max(0, this.dnfTimer - dt);
            if (this.dnfTimer === 0) {
                for (const id in this.auto) {
                    const a = this.auto[id];
                    if (!a.finito) {
                        a.finito    = true;
                        a.dnf       = true;
                        a.posizione = ++finiti;
                    }
                }
                this.garaFinita = true;
                this.dnfTimer = -1;
            }
        }
    }

    /**
     * Calcola il bonus scia per l'auto `idFollower`.
     * Un'auto è in scia se si trova nel cono posteriore dell'auto davanti:
     *   - distanza < SCIA_DIST_MAX
     *   - proiezione lungo l'asse del leader > 0 (è dietro)
     *   - distanza laterale < SCIA_CONE_BASE + distanza * SCIA_CONE_GAIN
     */
    private calcolaBonusScia(idFollower: string): number {
        const follower = this.auto[idFollower];
        if (!follower) return 1;

        for (const id in this.auto) {
            if (id === idFollower) continue;
            const leader = this.auto[id];
            if (!leader || leader.finito) continue;

            const dx = follower.x - leader.x;
            const dy = follower.y - leader.y;
            const dist = Math.hypot(dx, dy);
            if (dist > SCIA_DIST_MAX || dist < 8) continue;

            // Asse del leader: forward e laterale
            const fwX = Math.cos(leader.a);
            const fwY = Math.sin(leader.a);

            // "lungoAsse" > 0 significa che il follower è DIETRO il leader
            const lungoAsse = -(dx * fwX + dy * fwY);
            if (lungoAsse <= 0) continue;

            // Distanza laterale dall'asse del leader
            const laterale = Math.abs(dx * (-fwY) + dy * fwX);
            const aperturaCono = SCIA_CONE_BASE + lungoAsse * SCIA_CONE_GAIN;

            if (laterale <= aperturaCono) return SCIA_BONUS;
        }

        return 1;
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
//  CLIENT  —  gira nel browser, solo rendering e invio input
// ═══════════════════════════════════════════════════════════════════════════════

export class MicroRacingClient extends GameClient {

    // Stato ricevuto dal server (fonte di verità)
    private statoServer: Record<string, StatoAuto> | null = null;
    // Versioni interpolate per rendering fluido (anti-scatto da rete)
    private renderAuto: Record<string, StatoAuto> = {};

    private olioServer: ChiazzaOlio[]  = [];
    private fase: Fase                 = 'qualifiche';
    private tempoQual                  = DURATA_QUALIFICHE;
    private tempoRecap                 = DURATA_RECAP;
    private countdownPartenza          = 0;
    private dnfTimer                   = -1;
    private garaFinita                 = false;
    private gridOrder: string[]        = [];
    private migliorAssoluto            = -1;
    private colori: Record<string, string> = {};

    // Telecamera: segue l'auto del giocatore locale con smooth lerp
    private camX = TRAGUARDO.x;
    private camY = TRAGUARDO.y;
    private readonly ZOOM = 1.65;

    private trackCanvas: HTMLCanvasElement | null = null;
    private tasti = { su: false, giu: false, sx: false, dx: false, turbo: false, olio: false };
    private turboPremuto = false;
    private olioPremuto = false;
    private animTime       = 0;
    private garaFinitaTimer = -1;

    // goFlashTimer: dura ~0.9s dopo il GO! per mostrare il testo verde
    private goFlashTimer = 0;

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
        this.registraTasti();
    }

    // ── Interfaccia GameClient ────────────────────────────────────────────────

    async init(giocatori: Record<string, Player>): Promise<void> {
        let i = 0;
        for (const id in giocatori) this.colori[id] = COLORI_AUTO[i++ % COLORI_AUTO.length];
        this.trackCanvas = this.costruisciCanvas();
    }

    handleMessage(msg: MsgStato): void {
        if (msg.kind !== 'stato') return;

        // Rileva il momento in cui il semaforo scatta a 0 → mostra "GO!"
        const countdownPrecedente = this.countdownPartenza;
        this.fase               = msg.fase;
        this.tempoQual          = msg.tempoQual;
        this.tempoRecap         = msg.tempoRecap;
        this.countdownPartenza  = msg.countdownPartenza;
        this.dnfTimer           = msg.dnfTimer;
        this.olioServer         = msg.olio;
        this.garaFinita         = msg.garaFinita;
        this.gridOrder          = msg.gridOrder;
        this.migliorAssoluto    = msg.migliorAssoluto;

        if (countdownPrecedente > 0 && this.countdownPartenza <= 0 && this.fase === 'gara')
            this.goFlashTimer = 0.9;

        if (this.garaFinita && this.garaFinitaTimer < 0) this.garaFinitaTimer = 9;

        // Prima ricezione: inizializza renderAuto
        if (!this.statoServer) {
            this.statoServer = msg.auto;
            for (const id in msg.auto) this.renderAuto[id] = { ...msg.auto[id] };
            return;
        }

        // Aggiorna stato server; gestisce entrate/uscite di giocatori
        for (const id in msg.auto) {
            if (!this.statoServer[id]) this.renderAuto[id] = { ...msg.auto[id] };
            this.statoServer[id] = msg.auto[id];
        }
        for (const id in this.statoServer)
            if (!msg.auto[id]) { delete this.statoServer[id]; delete this.renderAuto[id]; }
    }

    flushMessages(): MsgInput[] {
        const input: MsgInput = {
            kind: 'input',
            ...this.tasti,
            mouseAngolo: this.calcolaAngoloMouse(),
        };
        this.tasti.turbo = false;
        this.tasti.olio = false;
        return [input];
    }

    isFinished(): boolean { return this.garaFinitaTimer === 0; }

    // ── Loop di rendering (~60 fps) ───────────────────────────────────────────

    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        if (!this.statoServer) return;
        this.animTime += dt;
        if (this.garaFinitaTimer > 0) this.garaFinitaTimer = Math.max(0, this.garaFinitaTimer - dt);
        if (this.goFlashTimer    > 0) this.goFlashTimer    = Math.max(0, this.goFlashTimer    - dt);

        const { screenW: W, screenH: H } = this.userInput;
        const me = this.statoServer[this.myId];

        this.interpolaRenderAuto(dt);

        // Camera: durante il recap va al centro del tracciato; altrimenti segue il giocatore
        if (this.fase === 'recap') {
            const cx = MONDO_W / 2, cy = MONDO_H / 2;
            this.camX += (cx - this.camX) * Math.min(1, dt * 3);
            this.camY += (cy - this.camY) * Math.min(1, dt * 3);
        } else if (me) {
            this.camX += (me.x - this.camX) * Math.min(1, dt * 9);
            this.camY += (me.y - this.camY) * Math.min(1, dt * 9);
        }

        // ── Sfondo + pista ────────────────────────────────────────────────────
        ctx.fillStyle = '#3a7d44';
        ctx.fillRect(0, 0, W, H);

        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(this.ZOOM, this.ZOOM);
        ctx.translate(-this.camX, -this.camY);

        if (this.trackCanvas) ctx.drawImage(this.trackCanvas, 0, 0);
        for (const o of this.olioServer)          this.disegnaOlio(ctx, o);
        for (const id in this.renderAuto)          this.disegnaAuto(ctx, id, this.renderAuto[id]);

        ctx.restore();

        // ── UI in coordinate schermo ──────────────────────────────────────────
        if (this.fase === 'recap') {
            this.disegnaRecap(ctx, W, H);
        } else {
            this.disegnaHUD(ctx, me, W, H);
            this.disegnaSemaforo(ctx, W);
            this.disegnaClassifica(ctx, W);
            if (this.garaFinitaTimer >= 0) this.disegnaFinale(ctx, me, W, H);
        }
    }

    // ── Interpolazione anti-scatto ────────────────────────────────────────────

    /**
     * Avvicina renderAuto verso statoServer ogni frame.
     * Posizione e angolo vengono interpolati (lerp) per nascondere la latenza di rete.
     * Tutti gli altri campi sono autorevoli e vengono copiati direttamente.
     */
    private interpolaRenderAuto(dt: number): void {
        if (!this.statoServer) return;
        const alpha = Math.min(1, dt * 15);

        for (const id in this.statoServer) {
            const t = this.statoServer[id];
            const c = this.renderAuto[id] ?? { ...t };

            // Lerp posizione
            c.x += (t.x - c.x) * alpha;
            c.y += (t.y - c.y) * alpha;

            // Lerp angolo sul percorso più breve (evita giri da 360°)
            let da = t.a - c.a;
            while (da >  Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            c.a += da * alpha;

            // Campi gameplay: sempre autorevoli
            c.vx = t.vx; c.vy = t.vy;
            c.giri = t.giri; c.cp = t.cp; c.cpQual = t.cpQual;
            c.turboTimer = t.turboTimer; c.turboCooldown = t.turboCooldown;
            c.olioCooldown = t.olioCooldown; c.spinTimer = t.spinTimer;
            c.inScia = t.inScia; c.giroInvalido = t.giroInvalido;
            c.sulTraguardo = t.sulTraguardo;
            c.nome = t.nome; c.character = t.character;
            c.finito = t.finito; c.dnf = t.dnf; c.posizione = t.posizione;
            c.migliorGiro = t.migliorGiro; c.tempoGiroAttuale = t.tempoGiroAttuale;

            this.renderAuto[id] = c;
        }
    }

    private calcolaAngoloMouse(): number {
        const me = this.statoServer?.[this.myId];
        if (!me || this.userInput.screenW <= 0 || this.userInput.screenH <= 0) return Number.NaN;

        const mouseWorldX = this.camX + (this.userInput.mouseX - this.userInput.screenW / 2) / this.ZOOM;
        const mouseWorldY = this.camY + (this.userInput.mouseY - this.userInput.screenH / 2) / this.ZOOM;
        const dx = mouseWorldX - me.x;
        const dy = mouseWorldY - me.y;

        if (Math.hypot(dx, dy) < 12) return me.a;
        return Math.atan2(dy, dx);
    }

    // ── Disegno auto ──────────────────────────────────────────────────────────

    private disegnaAuto(ctx: CanvasRenderingContext2D, id: string, auto: StatoAuto): void {
        const colore = this.colori[id] ?? '#fff';
        const sonoIo = id === this.myId;
        const CW = 8, CH = 14;

        ctx.save();

        // Ghosting in qualifica: le auto avversarie sono semi-trasparenti
        if (this.fase === 'qualifiche' && !sonoIo) ctx.globalAlpha = 0.45;

        ctx.translate(auto.x, auto.y);
        ctx.rotate(auto.a - Math.PI / 2); // 0 rad = verso destra; l'auto punta su → -90°

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

        // Fiamma turbo con flickering
        if (auto.turboTimer > 0) {
            const len = 5 + Math.sin(this.animTime * 25) * 2;
            ctx.fillStyle = '#ff7700'; ctx.shadowColor = '#ffaa00'; ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.moveTo(-2.5, CH / 2); ctx.lineTo(0, CH / 2 + len); ctx.lineTo(2.5, CH / 2);
            ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
        }

        // Cerchio giallo durante lo spin-out
        if (auto.spinTimer > 0) {
            ctx.strokeStyle = '#ffff00'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.arc(0, 0, CH * 0.8, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.restore();

        // Nome sopra l'auto (sempre orizzontale, fuori dalla rotazione)
        ctx.save();
        ctx.font = `bold ${sonoIo ? 8 : 7}px Arial`; ctx.textAlign = 'center';
        if (this.fase === 'qualifiche' && !sonoIo) ctx.globalAlpha = 0.45;
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

    // ── HUD ───────────────────────────────────────────────────────────────────

    private disegnaHUD(ctx: CanvasRenderingContext2D, me: StatoAuto | undefined, W: number, H: number): void {
        if (!me) return;
        const p = 14;

        const pannelloH = this.fase === 'qualifiche' ? 195 : 130;
        ctx.fillStyle = 'rgba(0,0,0,0.58)';
        ctx.fillRect(p - 3, p - 3, 242, pannelloH);

        if (this.fase === 'qualifiche') {
            // Timer qualifiche
            ctx.font = 'bold 14px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#f1c40f';
            ctx.fillText('⏱ QUALIFICHE', p, p + 16);

            const min = Math.floor(this.tempoQual / 60);
            const sec = Math.ceil(this.tempoQual % 60);
            ctx.font = 'bold 36px Arial';
            ctx.fillStyle = this.tempoQual < 30 ? '#e74c3c' : '#fff';
            ctx.fillText(`${min}:${String(sec).padStart(2, '0')}`, p, p + 56);

            // Avviso giro invalido
            if (me.giroInvalido) {
                ctx.font = 'bold 11px Arial'; ctx.fillStyle = '#ff6b6b';
                ctx.fillText('⚠ GIRO INVALIDO (fuori pista)', p, p + 72);
            }

            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(p, p + 78, 225, 1);

            // Tre righe tempi
            this.disegnaRigaTempo(ctx, p, p + 96,  'Giro corrente', formatTempo(me.tempoGiroAttuale), '#fff');
            this.disegnaRigaTempo(ctx, p, p + 116, 'Mio miglior giro', formatTempo(me.migliorGiro), '#7fff7f');
            this.disegnaRigaTempo(ctx, p, p + 136, 'Miglior assoluto', formatTempo(this.migliorAssoluto), '#f1c40f');

        } else {
            // Gara: contatore giri
            ctx.font = 'bold 26px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
            ctx.fillText(`Giro ${Math.min(me.giri + 1, GIRI_GARA)} / ${GIRI_GARA}`, p, p + 30);

            // Timer DNF in cima allo schermo
            if (this.dnfTimer >= 0 && this.countdownPartenza <= 0) {
                const sec = Math.ceil(this.dnfTimer);
                ctx.fillStyle = 'rgba(0,0,0,0.65)';
                ctx.fillRect(W / 2 - 105, 10, 210, 34);
                ctx.textAlign = 'center'; ctx.font = 'bold 15px Arial';
                ctx.fillStyle = sec <= 10 ? '#ff6b6b' : '#f1c40f';
                ctx.fillText(`Gara termina tra ${sec}s`, W / 2, 32);
            }

            // Indicatore scia
            if (me.inScia) {
                ctx.fillStyle = 'rgba(0,150,255,0.18)';
                ctx.fillRect(p - 3, p + 42, 130, 22);
                ctx.font = 'bold 13px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#7ecfff';
                ctx.fillText('⚡ SCIA ATTIVA', p + 4, p + 57);
            }
        }

        // Barre turbo e olio
        const turboY = this.fase === 'qualifiche' ? p + 152 : p + 52;
        const turboPct = me.turboTimer > 0
            ? me.turboTimer / TURBO_DURATA
            : Math.max(0, 1 - me.turboCooldown / TURBO_RICARICA);
        this.disegnaBarra(ctx, p, turboY, 185, 12, turboPct,
            me.turboTimer > 0 ? '#ff6a00' : turboPct >= 1 ? '#00aaff' : '#004488', 'TURBO [SPAZIO]');

        const olioPct = Math.max(0, 1 - me.olioCooldown / OLIO_RICARICA);
        this.disegnaBarra(ctx, p, turboY + 28, 185, 12, olioPct, '#222', 'OLIO [SHIFT]', true);

        // Velocità (in basso a destra)
        const vel = Math.round(Math.hypot(me.vx, me.vy));
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(W - 118, H - 44, 110, 36);
        ctx.font = 'bold 22px Arial'; ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
        ctx.fillText(`${vel} m/s`, W - 10, H - 14);

        this.disegnaMiniMappa(ctx, me, W, H);
    }

    private disegnaMiniMappa(ctx: CanvasRenderingContext2D, me: StatoAuto, W: number, H: number): void {
        const size = 150;
        const pad = 12;
        const x = W - size - pad;
        const y = H - size - pad - 52;

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x - 3, y - 3, size + 6, size + 6);
        ctx.fillStyle = 'rgba(20,20,20,0.85)';
        ctx.fillRect(x, y, size, size);

        // Tracciato
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i <= WAYPOINTS.length; i++) {
            const p = WAYPOINTS[i % WAYPOINTS.length];
            const mx = x + (p.x / MONDO_W) * size;
            const my = y + (p.y / MONDO_H) * size;
            if (i === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
        }
        ctx.stroke();

        // Auto giocatore
        const px = x + (me.x / MONDO_W) * size;
        const py = y + (me.y / MONDO_H) * size;
        ctx.translate(px, py);
        ctx.rotate(me.a);
        ctx.fillStyle = '#f1c40f';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(-5, -4);
        ctx.lineTo(-3, 0);
        ctx.lineTo(-5, 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    }

    /** Riga etichetta + valore allineati a sinistra/destra nel pannello HUD */
    private disegnaRigaTempo(ctx: CanvasRenderingContext2D,
        x: number, y: number, etichetta: string, valore: string, coloreValore: string): void {
        ctx.font = '11px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#aaa';
        ctx.fillText(etichetta, x, y);
        ctx.font = 'bold 13px Arial'; ctx.textAlign = 'right'; ctx.fillStyle = coloreValore;
        ctx.fillText(valore, x + 232, y);
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

    // ── Semaforo di partenza (punto 3) ────────────────────────────────────────

    /**
     * Disegna 4 luci rosse che si accendono una per secondo (simulando il semaforo F1),
     * poi tutte si spengono e compare "GO!" in verde.
     *
     * La logica di scaglionamento usa DURATA_PARTENZA=4 secondi:
     *   - elapsed 0→1s: 1 luce accesa
     *   - elapsed 1→2s: 2 luci accese
     *   - elapsed 2→3s: 3 luci accese
     *   - elapsed 3→4s: 4 luci accese
     *   - countdown = 0: tutte spente + "GO!" per goFlashTimer secondi
     */
    private disegnaSemaforo(ctx: CanvasRenderingContext2D, W: number): void {
        const inPreStart  = this.fase === 'gara' && this.countdownPartenza > 0;
        const inGoFlash   = this.fase === 'gara' && this.countdownPartenza <= 0 && this.goFlashTimer > 0;
        if (!inPreStart && !inGoFlash) return;

        ctx.fillStyle = 'rgba(0,0,0,0.60)';
        ctx.fillRect(W / 2 - 150, 10, 300, 88);

        // Calcola quante luci sono accese in base al tempo trascorso
        const elapsed  = DURATA_PARTENZA - this.countdownPartenza;
        const nAccese  = inPreStart ? Math.max(0, Math.min(4, Math.ceil(elapsed))) : 0;

        for (let i = 0; i < 4; i++) {
            const x = W / 2 - 90 + i * 60;
            const y = 52;
            const accesa = inPreStart && i < nAccese;

            // Bagliore rosso sulle luci accese
            if (accesa) {
                ctx.shadowColor = '#ff3b30'; ctx.shadowBlur = 18;
            }
            ctx.beginPath();
            ctx.arc(x, y, 20, 0, Math.PI * 2);
            ctx.fillStyle = accesa ? '#ff3b30' : '#3a1515';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 2;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        ctx.textAlign = 'center';
        if (inPreStart) {
            // Numero di secondi rimasti
            ctx.font = 'bold 16px Arial'; ctx.fillStyle = '#fff';
            ctx.fillText(String(Math.ceil(this.countdownPartenza)), W / 2, 86);
        } else {
            // GO! in verde, con fade-out
            ctx.font = 'bold 28px Arial';
            ctx.fillStyle = `rgba(100,255,100,${this.goFlashTimer / 0.9})`;
            ctx.fillText('GO!', W / 2, 74);
        }
    }

    // ── Classifica ────────────────────────────────────────────────────────────

    private disegnaClassifica(ctx: CanvasRenderingContext2D, W: number): void {
        if (!this.statoServer) return;

        let voci: [string, StatoAuto][];
        if (this.fase === 'qualifiche') {
            voci = Object.entries(this.statoServer).sort((a, b) => {
                const ta = a[1].migliorGiro < 0 ? Infinity : a[1].migliorGiro;
                const tb = b[1].migliorGiro < 0 ? Infinity : b[1].migliorGiro;
                return ta - tb;
            });
        } else {
            // In gara: chi ha finito prima, poi chi è ancora in pista per giri
            const finiti = Object.entries(this.statoServer)
                .filter(([, a]) => a.finito)
                .sort((a, b) => {
                    if (a[1].dnf !== b[1].dnf) return a[1].dnf ? 1 : -1;
                    return a[1].posizione - b[1].posizione;
                });
            const inGara = Object.entries(this.statoServer)
                .filter(([, a]) => !a.finito)
                .sort((a, b) => b[1].giri - a[1].giri);
            voci = [...finiti, ...inGara];
        }

        const lbW = 228, rowH = 24, pad = 8;
        const lbX = W - lbW - 10;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(lbX, 10, lbW, rowH * (voci.length + 1) + pad);
        ctx.font = 'bold 12px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#f1c40f';
        ctx.fillText(this.fase === 'qualifiche' ? 'TEMPI QUALIFICHE' : 'CLASSIFICA GARA', lbX + pad, 26);

        const tempoLeader = calcolaMigliorAssoluto(this.statoServer);

        voci.forEach(([id, auto], i) => {
            const ry = 10 + rowH * (i + 1) + pad;

            // Pastiglia colore auto
            ctx.fillStyle = this.colori[id] ?? '#fff';
            ctx.fillRect(lbX + pad, ry - 11, 9, 12);

            // Nome pilota
            ctx.font = id === this.myId ? 'bold 11px Arial' : '11px Arial';
            ctx.fillStyle = id === this.myId ? '#ffff88' : '#fff';
            ctx.textAlign = 'left';
            ctx.fillText(`${i + 1}. ${auto.nome.substring(0, 9)}`, lbX + pad + 13, ry);

            // Tempo / stato
            ctx.textAlign = 'right'; ctx.font = '10px Arial'; ctx.fillStyle = '#ccc';
            if (this.fase === 'qualifiche') {
                if (i === 0 && auto.migliorGiro > 0) {
                    ctx.fillStyle = '#7fff7f';
                    ctx.fillText(formatTempo(auto.migliorGiro), lbX + lbW - pad, ry);
                } else if (auto.migliorGiro > 0 && tempoLeader > 0) {
                    ctx.fillText(`+${auto.migliorGiro - tempoLeader} ms`, lbX + lbW - pad, ry);
                } else {
                    ctx.fillText('--', lbX + lbW - pad, ry);
                }
            } else {
                if (auto.dnf)    ctx.fillText('DNF',    lbX + lbW - pad, ry);
                else if (auto.finito) ctx.fillText('✓ ARR.', lbX + lbW - pad, ry);
                else ctx.fillText(`G${auto.giri + 1}`, lbX + lbW - pad, ry);
            }
        });
    }

    // ── Recap griglia ─────────────────────────────────────────────────────────

    /**
     * Schermata tra qualifiche e gara.
     * Mostra la griglia di partenza DALL'ULTIMO AL PRIMO (come in F1/MotoGP):
     * l'ultimo qualificato è in cima, la pole è in fondo evidenziata in oro.
     */
    private disegnaRecap(ctx: CanvasRenderingContext2D, W: number, H: number): void {
        if (!this.statoServer) return;

        ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, W, H);

        ctx.textAlign = 'center';
        ctx.font = 'bold 38px Arial'; ctx.fillStyle = '#f1c40f';
        ctx.fillText('GRIGLIA DI PARTENZA', W / 2, 52);
        ctx.font = '17px Arial'; ctx.fillStyle = '#aaa';
        ctx.fillText('La gara inizia tra...', W / 2, 80);

        const cd = Math.ceil(this.tempoRecap);
        ctx.font = 'bold 50px Arial'; ctx.fillStyle = '#fff';
        ctx.fillText(String(cd), W / 2, 140);

        const progresso = 1 - this.tempoRecap / DURATA_RECAP;
        const barW = 260, barX = W / 2 - barW / 2;
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(barX, 150, barW, 7);
        ctx.fillStyle = '#f1c40f'; ctx.fillRect(barX, 150, barW * progresso, 7);

        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(W / 2 - 190, 168, 380, 1);

        const gridRev     = [...this.gridOrder].reverse();//aura
        const tempoLeader = this.gridOrder.length > 0
            ? (this.statoServer[this.gridOrder[0]]?.migliorGiro ?? -1)
            : -1;

        const rigaH = 44, startY = 178, listaW = 440;
        const listaX = W / 2 - listaW / 2;

        gridRev.forEach((id, idx) => {
            const auto = this.statoServer![id];
            if (!auto) return;

            const posGrig = this.gridOrder.length - idx; // 1 = pole (in fondo alla lista invertita)
            const isPole  = posGrig === 1;
            const sonoIo  = id === this.myId;
            const ry      = startY + idx * rigaH;

            // Sfondo rigaaaaaaaass
            ctx.fillStyle = isPole
                ? 'rgba(200,155,30,0.35)'
                : sonoIo
                    ? 'rgba(52,152,219,0.28)'
                    : idx % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.1)';
            ctx.fillRect(listaX, ry, listaW, rigaH - 2);

            // Posizione griglia (grande, a sinistra)
            ctx.font = `bold ${isPole ? 26 : 22}px Arial`; ctx.textAlign = 'left';
            ctx.fillStyle = isPole ? '#f1c40f' : sonoIo ? '#7ecfff' : '#888';
            ctx.fillText(`P${posGrig}`, listaX + 10, ry + rigaH * 0.68);

            // Pastiglia colore auto
            ctx.fillStyle = this.colori[id] ?? '#fff';
            ctx.fillRect(listaX + 58, ry + 12, 10, rigaH - 26);

            // Nome pilota
            ctx.font = sonoIo ? 'bold 15px Arial' : '14px Arial';
            ctx.fillStyle = sonoIo ? '#ffff88' : '#fff';
            ctx.fillText(auto.nome.substring(0, 14), listaX + 76, ry + rigaH * 0.66);

            // Etichetta pole
            if (isPole) {
                ctx.font = '11px Arial'; ctx.fillStyle = '#f1c40f';
                ctx.fillText('🏆 POLE', listaX + 76, ry + rigaH * 0.66 - 16);
            }

            // Tempo qualifiche (a destra)
            ctx.textAlign = 'right'; ctx.font = isPole ? 'bold 13px Arial' : '12px Arial';
            if (isPole && auto.migliorGiro > 0) {
                ctx.fillStyle = '#7fff7f';
                ctx.fillText(formatTempo(auto.migliorGiro), listaX + listaW - 10, ry + rigaH * 0.66);
            } else if (auto.migliorGiro > 0 && tempoLeader > 0) {
                ctx.fillStyle = '#ccc';
                ctx.fillText(`+${auto.migliorGiro - tempoLeader} ms`, listaX + listaW - 10, ry + rigaH * 0.66);
            } else {
                ctx.fillStyle = '#555';
                ctx.fillText('senza tempo', listaX + listaW - 10, ry + rigaH * 0.66);
            }
        });

        ctx.textAlign = 'center'; ctx.font = '12px Arial'; ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillText('Le macchine vengono riposizionate automaticamente', W / 2, startY + rigaH * gridRev.length + 20);
    }

    // ── Schermata fine garaa ───────────────────────────────────────────────────

    private disegnaFinale(ctx: CanvasRenderingContext2D, me: StatoAuto | undefined, W: number, H: number): void {
        ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, W, H);
        ctx.textAlign = 'center';
        ctx.font = 'bold 52px Arial'; ctx.fillStyle = '#f1c40f';
        ctx.fillText('GARA FINITA!', W / 2, H / 2 - 90);

        if (me?.finito) {
            ctx.font = 'bold 26px Arial'; ctx.fillStyle = '#fff';
            ctx.fillText(me.dnf ? 'DNF — non hai completato la gara in tempo' : `Hai concluso ${me.posizione}°!`, W / 2, H / 2 - 40);
        }

        if (this.statoServer) {
            const classificati = Object.values(this.statoServer)
                .filter(a => a.finito && !a.dnf)
                .sort((a, b) => a.posizione - b.posizione)
                .slice(0, 3);
            const medals = ['🥇', '🥈', '🥉'];
            classificati.forEach((a, i) => {
                ctx.font = `${i === 0 ? 'bold 26px' : '21px'} Arial`; ctx.fillStyle = '#fff';
                ctx.fillText(`${medals[i] ?? ''} ${a.nome}`, W / 2, H / 2 + 20 + i * 38);
                const draw = getCharacterDrawFunction(a.character);
                if (draw) draw(ctx, W / 2 - 80 + i * 80, H / 2 + 10 + i * 38, 14, 40);
            });
        }
    }

    // ── Canvas della pista (costruito una sola volta in init) ─────────────────

    private costruisciCanvas(): HTMLCanvasElement {
        const oc = document.createElement('canvas');
        oc.width = MONDO_W; oc.height = MONDO_H;
        const c = oc.getContext('2d')!;

        // Erba con righe alternate per profondità visiva
        c.fillStyle = '#2d6a35'; c.fillRect(0, 0, MONDO_W, MONDO_H);
        c.fillStyle = '#2a6130';
        for (let y = 0; y < MONDO_H; y += 60) c.fillRect(0, y, MONDO_W, 30);

        // Asfalto (linea spessa che segue i waypoint)
        c.strokeStyle = '#4a4a4a'; c.lineWidth = LARGHEZZA_PISTA;
        c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(WAYPOINTS[0].x, WAYPOINTS[0].y);
        for (let i = 1; i <= WAYPOINTS.length; i++)
            c.lineTo(WAYPOINTS[i % WAYPOINTS.length].x, WAYPOINTS[i % WAYPOINTS.length].y);
        c.stroke();

        // Linea tratteggiata centrale
        c.strokeStyle = 'rgba(255,255,255,0.20)'; c.lineWidth = 2; c.setLineDash([18, 14]);
        c.beginPath(); c.moveTo(WAYPOINTS[0].x, WAYPOINTS[0].y);
        for (let i = 1; i <= WAYPOINTS.length; i++)
            c.lineTo(WAYPOINTS[i % WAYPOINTS.length].x, WAYPOINTS[i % WAYPOINTS.length].y);
        c.stroke(); c.setLineDash([]);

        // Cordoli rossi/bianchi ai checkpoint
        for (const cp of CHECKPOINTS) {
            for (let j = -4; j <= 4; j++) {
                c.fillStyle = j % 2 === 0 ? '#cc0000' : '#ffffff';
                c.fillRect(cp.x - 4 + j * 3, cp.y - cp.r * 0.6, 3, cp.r * 1.2);
            }
        }

        // Traguardo a scacchi bianchi/neri
        const t = TRAGUARDO;
        for (let row = 0; row < 5; row++)
            for (let col = 0; col < 10; col++) {
                c.fillStyle = (row + col) % 2 === 0 ? '#ffffff' : '#000000';
                c.fillRect(t.x - 25 + col * 5, t.y - 25 + row * 5, 5, 5);
            }

        // Texture asfalto: puntini casuali per varietà visiva
        c.fillStyle = 'rgba(0,0,0,0.07)';
        for (let i = 0; i < 10000; i++) {
            const rx = Math.random() * MONDO_W;
            const ry = Math.random() * MONDO_H;
            if (sullaStrada(rx, ry)) c.fillRect(rx, ry, 2, 2);
        }

        // Numeri di curva accanto a ogni checkpoint
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.font = 'bold 22px Arial'; c.textAlign = 'center';
        CHECKPOINTS.forEach((cp, i) => c.fillText(String(i + 1), cp.x, cp.y + 8));

        return oc;
    }

    // ── Gestione tasti ────────────────────────────────────────────────────────

    private registraTasti(): void {
        const set = (e: KeyboardEvent, v: boolean) => {
            if (e.code === 'KeyW' || e.code === 'ArrowUp')         this.tasti.su    = v;
            if (e.code === 'KeyS' || e.code === 'ArrowDown')       this.tasti.giu   = v;
            if (e.code === 'Space') {
                if (v) {
                    if (!this.turboPremuto) this.tasti.turbo = true;
                    this.turboPremuto = true;
                    e.preventDefault();
                } else {
                    this.turboPremuto = false;
                }
            }
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
                if (v) {
                    if (!this.olioPremuto) this.tasti.olio = true;
                    this.olioPremuto = true;
                } else {
                    this.olioPremuto = false;
                }
            }
        };
        document.addEventListener('keydown', e => set(e, true));
        document.addEventListener('keyup',   e => set(e, false));
    }
}
