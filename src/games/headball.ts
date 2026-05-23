import { getCollisionSide } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer } from './game';
import { UserInput } from '../client/user-input';

/**
 * HEAD BALL — Logica di gioco completa
 *
 * Questo file è diviso in due grandi parti:
 *   1. SERVER  → gestisce la fisica, i punteggi e lo stato di gioco
 *   2. CLIENT  → gestisce il disegno sullo schermo e i tasti premuti
 *
 * Il server gira sul backend e manda ogni tick una "fotografia" dello stato
 * al client, che la usa per disegnare tutto.
 */

// ════════════════════════════════════════════════════════════════
//  MISURE DEL CAMPO (in pixel virtuali — il client le scala allo schermo reale)
// ════════════════════════════════════════════════════════════════

const LARGHEZZA_CAMPO  = 1000;
const ALTEZZA_CAMPO    = 500;
const SUOLO_Y          = 348;
const LARGHEZZA_PORTA  = 75;
const CIMA_PORTA_Y     = 72;
const SPESSORE_PALO    = 10;

const GIOCATORE_LARGHEZZA = 68;
const GIOCATORE_ALTEZZA   = 96;

// ════════════════════════════════════════════════════════════════
//  FISICA DELLA PALLA
// ════════════════════════════════════════════════════════════════

const PALLA_RAGGIO           = 22;
const PALLA_GRAVITA          = 1900;
const PALLA_ATTRITO_LATERALE = 0.88;
const PALLA_ATTRITO_TRAVERSA = 0.98;
const PALLA_ATTRITO_SUOLO    = 0.82;
const PALLA_ATTRITO_ROTOL    = 0.988;
const PALLA_SOGLIA_RIMBALZO  = 18;
const PALLA_CALCIO_VX        = 320;
const PALLA_CALCIO_VY        = -480;

// ════════════════════════════════════════════════════════════════
//  FISICA DEL GIOCATORE
// ════════════════════════════════════════════════════════════════

const VELOCITA_MOVIMENTO = 390;
const FORZA_SALTO        = -1180;
const GRAVITA_GIOCATORE  = 3600;

// ════════════════════════════════════════════════════════════════
//  DURATE DI GIOCO (in millisecondi)
// ════════════════════════════════════════════════════════════════

const DURATA_CONTO_ALLA_ROVESCIA = 3000;
const DURATA_PARTITA             = 90000;

// ── NUOVE costanti per goal e fine partita ────────────────────
// Durata del cooldown dopo ogni gol (giocatori fermi, palla al centro)
const DURATA_COOLDOWN_GOL    = 2000;
// Durata dell'animazione "GOAL!" mostrata sul client
const DURATA_ANIMAZIONE_GOL  = 1800;
// Quanto tempo il client mostra il risultato finale prima di tornare al menu
const DURATA_SCHERMATA_FINE  = 4000;

// ════════════════════════════════════════════════════════════════
//  TELEPORT
// ════════════════════════════════════════════════════════════════

const TELEPORT_DISTANZA  = 180;
const TELEPORT_COOLDOWN  = 10000;

// ════════════════════════════════════════════════════════════════
//  BOLLE SUPERPOTERE
// ════════════════════════════════════════════════════════════════

const BOLLA_INTERVALLO_SPAWN = 15000;
const BOLLA_RAGGIO           = 20;
const GHIACCIO_DURATA        = 3000;
const TESTA_GRANDE_DURATA    = 5000;
const TESTA_GRANDE_SCALA     = 1.6;

const PERSONAGGIO_DEFAULT = 'classic';

const PERSONAGGI = [
    { id: 'classic', nome: 'Classic', coloreAccento: '#00d8ff', coloreMaglia: '#006dff', coloreBordo: '#ffffff' },
    { id: 'wizard',  nome: 'Wizard',  coloreAccento: '#ffcf33', coloreMaglia: '#8b5cf6', coloreBordo: '#ffe680' },
    { id: 'ninja',   nome: 'Ninja',   coloreAccento: '#28ff88', coloreMaglia: '#00a84f', coloreBordo: '#edfff5' },
];
const ID_PERSONAGGI_VALIDI = new Set(PERSONAGGI.map(p => p.id));

// ════════════════════════════════════════════════════════════════
//  TIPI
// ════════════════════════════════════════════════════════════════

type Posto           = 0 | 1;
// ── NUOVA fase 'goal_cooldown': gioco bloccato 2s dopo ogni gol ──
type FasePartita     = 'selection' | 'countdown' | 'playing' | 'goal_cooldown' | 'finished';
type TipoSuperpotere = 'ice' | 'bighead';

interface InputGiocatore {
    direzioneX: number;
    salto:      boolean;
    teleport:   boolean;
}

interface SceltaPersonaggio {
    idPersonaggio: string;
    confermato:    boolean;
}

interface StatoPalla {
    x: number; y: number;
    vx: number; vy: number;
}

interface Bolla {
    x: number;
    y: number;
    tipo: TipoSuperpotere;
}

interface StatoGiocatore {
    posto:            Posto;
    idPersonaggio:    string;
    x: number; y: number;
    vx: number; vy: number;
    larghezza:        number;
    altezza:          number;
    direzione:        number;
    sulSuolo:         boolean;
    saltoTenuto:      boolean;
    doppiaSaltoUsato: boolean;
    teleportTenuto:   boolean;
    input:            InputGiocatore;
    cooldownTeleport: number;
    congelatoMs:      number;
    testaGrandeMs:    number;
}

// ════════════════════════════════════════════════════════════════
//  FUNZIONI DI SUPPORTO
// ════════════════════════════════════════════════════════════════

const blocca = (valore: number, minimo: number, massimo: number) =>
    Math.max(minimo, Math.min(massimo, valore));

const idPersonaggioValido = (id: unknown): string =>
    (typeof id === 'string' && ID_PERSONAGGI_VALIDI.has(id.trim())) ? id.trim() : PERSONAGGIO_DEFAULT;

function creaInputVuoto(): InputGiocatore {
    return { direzioneX: 0, salto: false, teleport: false };
}

function creaPalla(direzione = 0): StatoPalla {
    return {
        x:  LARGHEZZA_CAMPO / 2,
        y:  SUOLO_Y - 160,
        vx: PALLA_CALCIO_VX * direzione,
        vy: direzione !== 0 ? PALLA_CALCIO_VY : 0,
    };
}

/** Crea la palla FERMA al centro — usata durante il cooldown dopo il gol. */
function creaPallaFerma(): StatoPalla {
    return { x: LARGHEZZA_CAMPO / 2, y: SUOLO_Y - 160, vx: 0, vy: 0 };
}

function creaGiocatore(posto: Posto, idPersonaggio: string): StatoGiocatore {
    return {
        posto,
        idPersonaggio,
        x: posto === 0 ? 110 : LARGHEZZA_CAMPO - 110 - GIOCATORE_LARGHEZZA,
        y: SUOLO_Y - GIOCATORE_ALTEZZA,
        vx: 0, vy: 0,
        larghezza: GIOCATORE_LARGHEZZA,
        altezza:   GIOCATORE_ALTEZZA,
        direzione: posto === 0 ? 1 : -1,
        sulSuolo:  true,
        saltoTenuto: false, doppiaSaltoUsato: false, teleportTenuto: false,
        input: creaInputVuoto(),
        cooldownTeleport: 0, congelatoMs: 0, testaGrandeMs: 0,
    };
}

function creaBolla(): Bolla {
    const tipo: TipoSuperpotere = Math.random() < 0.5 ? 'ice' : 'bighead';
    const x = LARGHEZZA_PORTA + 100 + Math.random() * (LARGHEZZA_CAMPO - LARGHEZZA_PORTA * 2 - 200);
    const y = CIMA_PORTA_Y + 60  + Math.random() * (SUOLO_Y - CIMA_PORTA_Y - 120);
    return { x, y, tipo };
}

// ════════════════════════════════════════════════════════════════
//  GESTIONE COLLISIONI
// ════════════════════════════════════════════════════════════════

function rimbalzoPallaConRettangolo(
    palla: StatoPalla,
    rettangolo: { x: number; y: number; w: number; h: number }
): boolean {
    const pallaComeRettangolo = {
        x: palla.x - PALLA_RAGGIO,
        y: palla.y - PALLA_RAGGIO,
        w: PALLA_RAGGIO * 2,
        h: PALLA_RAGGIO * 2,
    };
    const lato = getCollisionSide(pallaComeRettangolo, rettangolo);
    if (lato === 'none') return false;

    if (lato === 'top')    { palla.y = rettangolo.y - PALLA_RAGGIO;                palla.vy = -Math.abs(palla.vy) * PALLA_ATTRITO_TRAVERSA; }
    if (lato === 'bottom') { palla.y = rettangolo.y + rettangolo.h + PALLA_RAGGIO; palla.vy =  Math.abs(palla.vy) * PALLA_ATTRITO_TRAVERSA; }
    if (lato === 'left')   { palla.x = rettangolo.x - PALLA_RAGGIO;                palla.vx = -Math.abs(palla.vx) * PALLA_ATTRITO_LATERALE; }
    if (lato === 'right')  { palla.x = rettangolo.x + rettangolo.w + PALLA_RAGGIO; palla.vx =  Math.abs(palla.vx) * PALLA_ATTRITO_LATERALE; }
    return true;
}

function rimbalzoPallaConGiocatore(palla: StatoPalla, giocatore: StatoGiocatore, raggioTesta: number): void {
    const centroPianoX = giocatore.x + giocatore.larghezza / 2;

    const centroTestaY  = giocatore.y + giocatore.altezza * 0.26;
    const deltaXTesta   = palla.x - centroPianoX;
    const deltaYTesta   = palla.y - centroTestaY;
    const distanzaTesta = Math.sqrt(deltaXTesta ** 2 + deltaYTesta ** 2);
    const colpisceTesta = distanzaTesta < raggioTesta + PALLA_RAGGIO;

    const raggioPiede   = giocatore.larghezza * 0.20;
    const centroPiedeY  = giocatore.y + giocatore.altezza * 0.88;
    const deltaXPiede   = palla.x - centroPianoX;
    const deltaYPiede   = palla.y - centroPiedeY;
    const distanzaPiede = Math.sqrt(deltaXPiede ** 2 + deltaYPiede ** 2);
    const colpiscePiede = !colpisceTesta && distanzaPiede < raggioPiede + PALLA_RAGGIO;

    if (!colpisceTesta && !colpiscePiede) return;

    const dirNaturale     = giocatore.posto === 0 ? 1 : -1;
    const velocitaAttuale = Math.sqrt(palla.vx ** 2 + palla.vy ** 2);

    if (colpisceTesta) {
        const distSicura  = Math.max(distanzaTesta, 0.001);
        const normX = deltaXTesta / distSicura;
        const normY = deltaYTesta / distSicura;
        const nuovaVelocita = blocca(Math.max(560, velocitaAttuale), 560, 880);
        palla.vx = blocca(normX * nuovaVelocita * 0.50 + dirNaturale * 0.18 * nuovaVelocita + giocatore.vx * 0.15, -700, 700);
        palla.vy = blocca(Math.min(normY * nuovaVelocita * 0.50 + (normY < -0.3 ? -920 : -800), -640), -1050, -640);
        palla.x += normX * (raggioTesta + PALLA_RAGGIO - distanzaTesta);
        palla.y += normY * (raggioTesta + PALLA_RAGGIO - distanzaTesta);
    } else {
        const distSicura  = Math.max(distanzaPiede, 0.001);
        const normX = deltaXPiede / distSicura;
        const normY = deltaYPiede / distSicura;
        const nuovaVelocita = blocca(Math.max(600, velocitaAttuale * 1.15), 600, 1000);
        palla.vx = blocca(normX * nuovaVelocita * 0.90 + dirNaturale * nuovaVelocita * 0.25 + giocatore.vx * 0.25, -1000, 1000);
        palla.vy = blocca(Math.min(normY * nuovaVelocita * 0.5 - 480, -350), -850, -350);
        palla.x += normX * (raggioPiede + PALLA_RAGGIO - distanzaPiede);
        palla.y += normY * (raggioPiede + PALLA_RAGGIO - distanzaPiede);
    }
}

function rimbalzoPallaConPorta(palla: StatoPalla, portaX: number, ePortaSinistra: boolean): void {
    const altezzaPorta = SUOLO_Y - CIMA_PORTA_Y;
    const xPaloFondo   = ePortaSinistra ? portaX : portaX + LARGHEZZA_PORTA - SPESSORE_PALO;
    rimbalzoPallaConRettangolo(palla, { x: xPaloFondo, y: CIMA_PORTA_Y, w: SPESSORE_PALO, h: altezzaPorta });
    rimbalzoPallaConRettangolo(palla, { x: portaX,     y: CIMA_PORTA_Y, w: LARGHEZZA_PORTA, h: SPESSORE_PALO });
}

// ════════════════════════════════════════════════════════════════
//  SERVER
// ════════════════════════════════════════════════════════════════

export class HeadBallServer extends GameServer {

    private fase: FasePartita = 'selection';
    private giocatori: Record<string, StatoGiocatore> = {};
    private ordine:    string[] = [];
    private scelte:    SceltaPersonaggio[] = [
        { idPersonaggio: PERSONAGGIO_DEFAULT, confermato: false },
        { idPersonaggio: PERSONAGGIO_DEFAULT, confermato: false },
    ];

    private palla:              StatoPalla = creaPalla();
    private punteggio           = { sinistra: 0, destra: 0 };
    private tempoRimastoMs      = DURATA_PARTITA;
    private contoAllaRovesciaMs = DURATA_CONTO_ALLA_ROVESCIA;
    private vincitore:  'left' | 'right' | 'draw' | null = null;

    private bollaAttuale:       Bolla | null = null;
    private tempoProssimaBolla: number = BOLLA_INTERVALLO_SPAWN;

    // ── NUOVI campi per cooldown post-gol e fine partita ──────────

    /**
     * Timer del cooldown dopo un gol (ms rimanenti).
     * Mentre è > 0 siamo in fase 'goal_cooldown': tutto fermo.
     */
    private cooldownDopolGolMs: number = 0;

    /**
     * Quale posto ha appena segnato — serve per sapere verso dove
     * lanciare la palla una volta terminato il cooldown.
     */
    private postoCheSegnato: Posto | null = null;

    /**
     * Timer di attesa nella fase 'finished' prima di tornare al menu.
     * Quando scade il server si dichiara terminato → il framework
     * smonta la partita e torna alla lobby/menu.
     */
    private timerFinePartitaMs: number = 0;

    // ── Lifecycle ─────────────────────────────────────────────────

    init(giocatoriConnessi: Record<string, any>): void {
        this.ordine    = Object.keys(giocatoriConnessi);
        this.fase      = 'selection';
        this.punteggio = { sinistra: 0, destra: 0 };
        this.vincitore = null;
        this.scelte    = [
            { idPersonaggio: PERSONAGGIO_DEFAULT, confermato: false },
            { idPersonaggio: PERSONAGGIO_DEFAULT, confermato: false },
        ];
        this.ordine.forEach((id, i) => {
            this.giocatori[id] = creaGiocatore(i as Posto, PERSONAGGIO_DEFAULT);
        });
        this.palla               = creaPalla();
        this.bollaAttuale        = null;
        this.tempoProssimaBolla  = BOLLA_INTERVALLO_SPAWN;
        this.cooldownDopolGolMs  = 0;
        this.postoCheSegnato     = null;
        this.timerFinePartitaMs  = 0;
    }

    tick(messaggi: IncomingMsg[], deltaT: number): OutgoingMsg[] {
        this.elaboraMessaggi(messaggi);
        this.aggiornаFase(deltaT);
        return [{ payload: this.costruisciFotografia() }];
    }

    /**
     * Il server si dichiara finito SOLO dopo che il timer di fine partita
     * è scaduto — così il client ha il tempo di mostrare il risultato
     * prima che il framework smontasse tutto.
     */
    isFinished(): boolean {
        return this.fase === 'finished' && this.timerFinePartitaMs <= 0;
    }

    // ── Messaggi in arrivo ────────────────────────────────────────

    private elaboraMessaggi(messaggi: IncomingMsg[]): void {
        for (const msg of messaggi) {
            const giocatore = this.giocatori[msg.clientId];
            if (!giocatore) continue;
            const dati  = msg.payload;
            const posto = giocatore.posto;

            // L'input viene accettato solo durante il gioco vero e proprio
            if (dati.kind === 'input' && this.fase === 'playing') {
                giocatore.input = {
                    direzioneX: typeof dati.moveX    === 'number'  ? blocca(dati.moveX, -1, 1) : giocatore.input.direzioneX,
                    salto:      typeof dati.jump     === 'boolean' ? dati.jump     : giocatore.input.salto,
                    teleport:   typeof dati.teleport === 'boolean' ? dati.teleport : giocatore.input.teleport,
                };
            }

            if (dati.kind === 'selection:update' && this.fase === 'selection' && !this.scelte[posto].confermato) {
                this.scelte[posto].idPersonaggio = idPersonaggioValido(dati.characterId);
            }

            if (dati.kind === 'selection:confirm' && this.fase === 'selection' && !this.scelte[posto].confermato) {
                this.scelte[posto].idPersonaggio = idPersonaggioValido(dati.characterId ?? this.scelte[posto].idPersonaggio);
                this.scelte[posto].confermato    = true;
                if (this.scelte[0].confermato && this.scelte[1].confermato) this.iniziaContoAllaRovescia();
            }
        }
    }

    // ── Cambio di fase ────────────────────────────────────────────

    private aggiornаFase(deltaT: number): void {
        const dtMs = deltaT * 1000;

        if (this.fase === 'countdown') {
            this.contoAllaRovesciaMs -= dtMs;
            if (this.contoAllaRovesciaMs <= 0) this.iniziaPartita();
        }

        if (this.fase === 'playing') {
            this.tempoRimastoMs -= dtMs;
            if (this.tempoRimastoMs <= 0) {
                this.terminaPartita();
            } else {
                this.aggiornаFisica(deltaT);
            }
        }

        // ── NUOVA fase: cooldown post-gol ─────────────────────────
        // Tutto fermo per DURATA_COOLDOWN_GOL ms, poi il gioco riparte.
        if (this.fase === 'goal_cooldown') {
            this.cooldownDopolGolMs -= dtMs;
            if (this.cooldownDopolGolMs <= 0) {
                this.ripartitaDopolCooldown();
            }
        }

        // ── NUOVA fase: attesa prima di tornare al menu ───────────
        // Il server aspetta DURATA_SCHERMATA_FINE ms prima di segnalarsi
        // come terminato (così il client mostra il risultato per un po').
        if (this.fase === 'finished') {
            if (this.timerFinePartitaMs > 0) {
                this.timerFinePartitaMs -= dtMs;
            }
        }
    }

    private iniziaContoAllaRovescia(): void {
        this.fase                = 'countdown';
        this.contoAllaRovesciaMs = DURATA_CONTO_ALLA_ROVESCIA;
        this.punteggio           = { sinistra: 0, destra: 0 };
        this.vincitore           = null;
        this.palla               = creaPalla();
        this.bollaAttuale        = null;
        this.tempoProssimaBolla  = BOLLA_INTERVALLO_SPAWN;
        this.cooldownDopolGolMs  = 0;
        this.postoCheSegnato     = null;
        this.ordine.forEach((id, i) => {
            this.giocatori[id] = creaGiocatore(i as Posto, this.scelte[i].idPersonaggio);
        });
    }

    private iniziaPartita(): void {
        this.fase           = 'playing';
        this.tempoRimastoMs = DURATA_PARTITA;
        this.palla          = creaPalla(Math.random() < 0.5 ? -1 : 1);
        this.ordine.forEach((id, i) => {
            this.giocatori[id] = creaGiocatore(i as Posto, this.scelte[i].idPersonaggio);
        });
    }

    /**
     * Chiamata subito dopo un gol:
     * - aggiorna il punteggio
     * - mette la palla ferma al centro
     * - blocca i giocatori nelle posizioni iniziali
     * - entra in fase 'goal_cooldown' per 2 secondi
     */
    private iniziaCooldownDopolGol(postoCheSegnato: Posto): void {
        this.fase               = 'goal_cooldown';
        this.cooldownDopolGolMs = DURATA_COOLDOWN_GOL;
        this.postoCheSegnato    = postoCheSegnato;
        // Palla ferma al centro durante il cooldown
        this.palla = creaPallaFerma();
        // Riposiziona i giocatori (cooldown teleport preservato)
        this.ordine.forEach((id, i) => {
            const cooldownSalvato = this.giocatori[this.ordine[i]]?.cooldownTeleport ?? 0;
            this.giocatori[this.ordine[i]] = creaGiocatore(i as Posto, this.scelte[i].idPersonaggio);
            this.giocatori[this.ordine[i]].cooldownTeleport = cooldownSalvato;
        });
        // Rimuovi la bolla: si rispawna dopo
        this.bollaAttuale       = null;
        this.tempoProssimaBolla = BOLLA_INTERVALLO_SPAWN;
    }

    /**
     * Chiamata quando il cooldown post-gol è terminato:
     * lancia la palla verso il lato di chi ha subito il gol e
     * riprende il gioco normale.
     */
    private ripartitaDopolCooldown(): void {
        this.fase = 'playing';
        // La palla va verso chi ha subito il gol (per riequilibrare)
        const direzione = this.postoCheSegnato === 0 ? -1 : 1;
        this.palla = creaPalla(direzione);
        this.postoCheSegnato = null;
    }

    private terminaPartita(): void {
        this.fase               = 'finished';
        this.timerFinePartitaMs = DURATA_SCHERMATA_FINE;
        this.vincitore = this.punteggio.sinistra > this.punteggio.destra ? 'left'
                       : this.punteggio.destra > this.punteggio.sinistra ? 'right'
                       : 'draw';
    }

    // ── Motore fisico ─────────────────────────────────────────────

    private aggiornаFisica(deltaT: number): void {
        const deltaTms = deltaT * 1000;

        ([0, 1] as Posto[]).forEach(posto => {
            const g = this.giocatori[this.ordine[posto]];
            if (!g) return;

            g.cooldownTeleport = Math.max(0, g.cooldownTeleport - deltaTms);
            g.congelatoMs      = Math.max(0, g.congelatoMs      - deltaTms);
            g.testaGrandeMs    = Math.max(0, g.testaGrandeMs    - deltaTms);

            if (g.congelatoMs > 0) {
                g.vx  = 0;
                g.vy += GRAVITA_GIOCATORE * deltaT;
                g.y  += g.vy * deltaT;
                if (g.y >= SUOLO_Y - g.altezza) { g.y = SUOLO_Y - g.altezza; g.vy = 0; }
                return;
            }

            this.applicaInput(g, deltaT);

            g.vy += GRAVITA_GIOCATORE * deltaT;
            g.x  += g.vx * deltaT;
            g.y  += g.vy * deltaT;

            if (g.y >= SUOLO_Y - g.altezza) {
                g.y = SUOLO_Y - g.altezza; g.vy = 0; g.sulSuolo = true; g.doppiaSaltoUsato = false;
            } else {
                g.sulSuolo = false;
            }
            if (g.y < 0) { g.y = 0; if (g.vy < 0) g.vy = 0; }
            if (g.x < LARGHEZZA_PORTA)                                 { g.x = LARGHEZZA_PORTA;                          g.vx = 0; }
            if (g.x > LARGHEZZA_CAMPO - LARGHEZZA_PORTA - g.larghezza) { g.x = LARGHEZZA_CAMPO - LARGHEZZA_PORTA - g.larghezza; g.vx = 0; }
        });

        this.aggiornaPalla(deltaT);
        this.aggiornaBolla(deltaT);
    }

    private applicaInput(g: StatoGiocatore, deltaT: number): void {
        const inp = g.input;

        g.vx = inp.direzioneX * VELOCITA_MOVIMENTO;
        if (inp.direzioneX !== 0) g.direzione = inp.direzioneX > 0 ? 1 : -1;

        if (inp.salto && !g.saltoTenuto) {
            if (g.sulSuolo) {
                g.vy = FORZA_SALTO;
                g.sulSuolo        = false;
                g.doppiaSaltoUsato = false;
            } else if (!g.doppiaSaltoUsato) {
                g.vy              = FORZA_SALTO;
                g.doppiaSaltoUsato = true;
            }
        }
        g.saltoTenuto = inp.salto;

        if (inp.teleport && !g.teleportTenuto && g.cooldownTeleport <= 0) {
            const margine       = PALLA_RAGGIO + g.larghezza / 2 + 8;
            const destinazioneX = g.posto === 0
                ? this.palla.x - margine - g.larghezza / 2
                : this.palla.x + margine - g.larghezza / 2;
            g.x             = blocca(destinazioneX, LARGHEZZA_PORTA, LARGHEZZA_CAMPO - LARGHEZZA_PORTA - g.larghezza);
            g.y             = blocca(this.palla.y - g.altezza / 2, 0, SUOLO_Y - g.altezza);
            g.vx            = 0;
            g.vy            = 0;
            g.cooldownTeleport = TELEPORT_COOLDOWN;
        }
        g.teleportTenuto = inp.teleport;
    }

    // ── Aggiornamento palla ───────────────────────────────────────

    private aggiornaPalla(deltaT: number): void {
        const p = this.palla;

        p.vy += PALLA_GRAVITA * deltaT;
        p.x  += p.vx * deltaT;
        p.y  += p.vy * deltaT;

        const pallaNellaZonaPorta = p.y > CIMA_PORTA_Y + SPESSORE_PALO && p.y < SUOLO_Y;

        // ── GOL: invece di ripristinare subito, avvia il cooldown ──
        if (p.x < LARGHEZZA_PORTA && pallaNellaZonaPorta) {
            this.punteggio.destra += 1;
            this.iniziaCooldownDopolGol(1); // ha segnato P2 (posto 1)
            return;
        }
        if (p.x > LARGHEZZA_CAMPO - LARGHEZZA_PORTA && pallaNellaZonaPorta) {
            this.punteggio.sinistra += 1;
            this.iniziaCooldownDopolGol(0); // ha segnato P1 (posto 0)
            return;
        }

        if (p.x - PALLA_RAGGIO <= 0 && !pallaNellaZonaPorta)              { p.x = PALLA_RAGGIO;                    p.vx =  Math.abs(p.vx) * PALLA_ATTRITO_LATERALE; }
        if (p.x + PALLA_RAGGIO >= LARGHEZZA_CAMPO && !pallaNellaZonaPorta) { p.x = LARGHEZZA_CAMPO - PALLA_RAGGIO; p.vx = -Math.abs(p.vx) * PALLA_ATTRITO_LATERALE; }
        if (p.y - PALLA_RAGGIO <= 0)  { p.y = PALLA_RAGGIO;       p.vy = Math.abs(p.vy) * PALLA_ATTRITO_TRAVERSA; }
        if (p.y + PALLA_RAGGIO >= SUOLO_Y) {
            p.y   = SUOLO_Y - PALLA_RAGGIO;
            p.vy *= -PALLA_ATTRITO_SUOLO;
            if (Math.abs(p.vy) < PALLA_SOGLIA_RIMBALZO) p.vy = 0;
            p.vx *= Math.pow(PALLA_ATTRITO_ROTOL, deltaT * 60);
        }

        ([0, 1] as Posto[]).forEach(posto => {
            const g = this.giocatori[this.ordine[posto]];
            if (!g) return;
            const raggioTesta = g.larghezza * 0.48 * (g.testaGrandeMs > 0 ? TESTA_GRANDE_SCALA : 1);
            rimbalzoPallaConGiocatore(p, g, raggioTesta);
        });

        if (!pallaNellaZonaPorta) {
            rimbalzoPallaConPorta(p, 0, true);
            rimbalzoPallaConPorta(p, LARGHEZZA_CAMPO - LARGHEZZA_PORTA, false);
        }
    }

    // ── Bolle superpotere ─────────────────────────────────────────

    private aggiornaBolla(deltaT: number): void {
        const dtMs = deltaT * 1000;

        if (this.bollaAttuale === null) {
            this.tempoProssimaBolla -= dtMs;
            if (this.tempoProssimaBolla <= 0) {
                this.bollaAttuale = creaBolla();
            }
            return;
        }

        const bolla = this.bollaAttuale;
        for (const posto of [0, 1] as Posto[]) {
            const g = this.giocatori[this.ordine[posto]];
            if (!g) continue;

            const puntoVicinoX = blocca(bolla.x, g.x, g.x + g.larghezza);
            const puntoVicinoY = blocca(bolla.y, g.y, g.y + g.altezza);
            const dx = bolla.x - puntoVicinoX;
            const dy = bolla.y - puntoVicinoY;

            if (dx * dx + dy * dy < BOLLA_RAGGIO * BOLLA_RAGGIO) {
                this.applicaEffettoBolla(g, posto, bolla.tipo);
                this.bollaAttuale       = null;
                this.tempoProssimaBolla = BOLLA_INTERVALLO_SPAWN;
                break;
            }
        }
    }

    private applicaEffettoBolla(g: StatoGiocatore, posto: Posto, tipo: TipoSuperpotere): void {
        if (tipo === 'ice') {
            const idAvversario = this.ordine[1 - posto as Posto];
            if (idAvversario && this.giocatori[idAvversario]) {
                this.giocatori[idAvversario].congelatoMs = GHIACCIO_DURATA;
            }
        } else {
            g.testaGrandeMs = TESTA_GRANDE_DURATA;
        }
    }

    // ── Fotografia dello stato ────────────────────────────────────

    private costruisciFotografia(): object {
        const giocoAttivo = this.fase === 'playing' || this.fase === 'finished' || this.fase === 'goal_cooldown';
        return {
            phase:   this.fase,
            score:   { left: this.punteggio.sinistra, right: this.punteggio.destra },
            timeMs:  Math.max(0, Math.round(
                this.fase === 'countdown' ? this.contoAllaRovesciaMs : this.tempoRimastoMs
            )),
            ball:    giocoAttivo ? { ...this.palla } : null,
            players: this.ordine.map(id => {
                const g = this.giocatori[id];
                return {
                    seat: g.posto, characterId: g.idPersonaggio,
                    x: g.x, y: g.y, w: g.larghezza, h: g.altezza, dir: g.direzione,
                    tpCdMs:    g.cooldownTeleport,
                    frozenMs:  g.congelatoMs,
                    bigHeadMs: g.testaGrandeMs,
                };
            }),
            bubble:            this.bollaAttuale ? { ...this.bollaAttuale } : null,
            bubbleSpawnMs:     this.bollaAttuale ? 0 : Math.max(0, Math.round(this.tempoProssimaBolla)),
            sels:              this.scelte.map(s => ({ characterId: s.idPersonaggio, confirmed: s.confermato })),
            winner:            this.vincitore,
            // ── NUOVI campi per il client ──────────────────────────
            // cooldownGolMs: quanto manca alla fine del freeze post-gol
            cooldownGolMs:     this.fase === 'goal_cooldown' ? Math.max(0, Math.round(this.cooldownDopolGolMs)) : 0,
            // postoSegnante: chi ha appena segnato (per l'animazione GOAL sul lato giusto)
            postoSegnante:     this.postoCheSegnato,
        };
    }
}

// ════════════════════════════════════════════════════════════════
//  CLIENT
// ════════════════════════════════════════════════════════════════

export class HeadBallClient extends GameClient {

    // ── Stato ricevuto dal server ─────────────────────────────────
    private fase          = 'selection';
    private giocatoriRicevuti: any[]     = [];
    private palla:         any           = null;
    private punteggio      = { left: 0, right: 0 };
    private tempoMs        = DURATA_PARTITA;
    private scelte:        any[]         = [];
    private vincitore:     string | null = null;
    private mioPosto       = -1;
    private bollaRicevuta: any           = null;
    private tempoProssimaBollaMs         = BOLLA_INTERVALLO_SPAWN;

    // ── NUOVI stati ricevuti dal server ───────────────────────────
    private cooldownGolMs:  number       = 0;  // ms rimasti nel freeze post-gol
    private postoSegnante:  number | null = null; // 0 o 1 = chi ha segnato l'ultimo gol

    // ── Animazione GOAL (gestita solo dal client) ─────────────────
    // goalAnimMs > 0 → l'animazione è attiva; decrementa ogni frame
    private goalAnimMs:     number = 0;
    // Salviamo il punteggio precedente per capire quando è stato segnato un gol
    private punteggioPrecedente = { left: 0, right: 0 };

    // ── Timer ritorno al menu (gestito solo dal client) ───────────
    // Quando la fase diventa 'finished' il client aspetta DURATA_SCHERMATA_FINE
    // prima di segnalarsi come finito e tornare al menu.
    private timerRitornoMenuMs: number = 0;
    private giaInFaseFinale:    boolean = false;

    // ── Particelle dell'animazione GOAL ──────────────────────────
    private particelle: Particella[] = [];

    // ── Selezione personaggio ─────────────────────────────────────
    private indicePersonaggio = 0;
    private hoConfermato      = false;

    private inputPrecedente   = { moveX: 0, jump: false, teleport: false };
    private selXPrecedente    = 0;
    private confermaPrecedente = false;

    private tastiPremuti: Record<string, boolean> = {};
    private mostraManuale = true;

    private orologio = 0;
    private messaggiDaInviare: any[] = [];

    private scala   = 1;
    private offsetX = 0;
    private offsetY = 0;

    constructor(ui: UserInput, myId: string) {
        super(ui, myId);
        this.registraTasti();
        this.registraClickManuale(ui);
    }

    private registraTasti(): void {
        document.addEventListener('keydown', (e) => { if (!e.repeat) this.tastiPremuti[e.code] = true;  });
        document.addEventListener('keyup',   (e) => { this.tastiPremuti[e.code] = false; });
        window.addEventListener('blur',      ()  => {
            Object.keys(this.tastiPremuti).forEach(k => { this.tastiPremuti[k] = false; });
        });
    }

    private registraClickManuale(ui: UserInput): void {
        ui.canvas.addEventListener('click', (e) => {
            if (!this.mostraManuale) return;
            const rettangolo = ui.canvas.getBoundingClientRect();
            const pixelX = (e.clientX - rettangolo.left) * (ui.canvas.width  / rettangolo.width);
            const pixelY = (e.clientY - rettangolo.top)  * (ui.canvas.height / rettangolo.height);
            const vx = (pixelX - this.offsetX) / this.scala;
            const vy = (pixelY - this.offsetY) / this.scala;
            const larghPulsante = 180, altPulsante = 48;
            const xPulsante = LARGHEZZA_CAMPO / 2 - larghPulsante / 2;
            const yPulsante = ALTEZZA_CAMPO * 0.78;
            if (vx >= xPulsante && vx <= xPulsante + larghPulsante && vy >= yPulsante && vy <= yPulsante + altPulsante) {
                this.mostraManuale = false;
            }
        });
    }

    async init(giocatori: Record<string, any>): Promise<void> {
        this.mioPosto = Object.keys(giocatori).indexOf(this.myId);
        return Promise.resolve();
    }

    // ── Ciclo principale ──────────────────────────────────────────

    draw(ctx: CanvasRenderingContext2D, deltaT: number): void {
        const { screenW, screenH } = this.userInput;

        this.scala   = Math.min(screenW / LARGHEZZA_CAMPO, screenH / ALTEZZA_CAMPO);
        this.offsetX = (screenW - LARGHEZZA_CAMPO * this.scala) / 2;
        this.offsetY = (screenH - ALTEZZA_CAMPO   * this.scala) / 2;
        this.orologio += deltaT;

        // ── Aggiorna timer client-side ────────────────────────────

        // Animazione GOAL: decrementa il timer ogni frame
        if (this.goalAnimMs > 0) {
            this.goalAnimMs = Math.max(0, this.goalAnimMs - deltaT * 1000);
        }

        // Aggiorna le particelle
        this.aggiornaParticelle(deltaT);

        // Timer per tornare al menu dopo la schermata finale
        if (this.fase === 'finished') {
            if (!this.giaInFaseFinale) {
                // Prima volta che vediamo 'finished': avvia il timer
                this.giaInFaseFinale    = true;
                this.timerRitornoMenuMs = DURATA_SCHERMATA_FINE;
            }
            this.timerRitornoMenuMs = Math.max(0, this.timerRitornoMenuMs - deltaT * 1000);
        }

        if (!this.mostraManuale) this.leggiInput();

        ctx.fillStyle = '#07111c';
        ctx.fillRect(0, 0, screenW, screenH);

        ctx.save();
        ctx.translate(this.offsetX, this.offsetY);
        ctx.scale(this.scala, this.scala);
        ctx.beginPath(); ctx.rect(0, 0, LARGHEZZA_CAMPO, ALTEZZA_CAMPO); ctx.clip();

        this.disegnasSfondo(ctx);
        this.disegnaCampo(ctx);

        if (this.fase !== 'waiting' && this.fase !== 'selection') {
            this.giocatoriRicevuti.forEach(g => this.disegnaGiocatore(ctx, g));
            if (this.palla)         this.disegnaPalla(ctx, this.palla);
            if (this.bollaRicevuta) this.disegnaBolla(ctx, this.bollaRicevuta);
        }

        if (this.fase === 'countdown')     this.disegnaContoAllaRovescia(ctx);
        this.disegnaHUD(ctx);

        // ── Overlay cooldown post-gol ─────────────────────────────
        if (this.fase === 'goal_cooldown') this.disegnaCooldownGol(ctx);

        if (this.fase === 'selection' || this.fase === 'waiting') this.disegnaSelezione(ctx);
        if (this.fase === 'finished')                              this.disegnaRisultato(ctx);

        // ── Animazione GOAL sopra tutto il resto ──────────────────
        if (this.goalAnimMs > 0) this.disegnaAnimazioneGoal(ctx);

        if (this.mostraManuale) this.disegnaManuale(ctx);

        ctx.restore();
    }

    handleMessage(msg: any): void {
        if (!msg) return;

        // ── Rileva un gol confrontando il punteggio precedente ────
        if ('score' in msg) {
            const nuovoPunteggio = msg.score;
            const golSegnato = nuovoPunteggio.left  !== this.punteggioPrecedente.left ||
                               nuovoPunteggio.right !== this.punteggioPrecedente.right;
            if (golSegnato && this.goalAnimMs <= 0) {
                // Avvia l'animazione e crea le particelle
                this.goalAnimMs = DURATA_ANIMAZIONE_GOL;
                this.creaParticelleGoal();
            }
            this.punteggioPrecedente = { ...nuovoPunteggio };
        }

        if ('phase'         in msg) this.fase                 = msg.phase;
        if ('score'         in msg) this.punteggio            = msg.score;
        if ('timeMs'        in msg) this.tempoMs              = msg.timeMs;
        if ('ball'          in msg) this.palla                = msg.ball;
        if ('players'       in msg) this.giocatoriRicevuti    = msg.players;
        if ('sels'          in msg) this.scelte               = msg.sels;
        if ('winner'        in msg) this.vincitore            = msg.winner;
        if ('bubble'        in msg) this.bollaRicevuta        = msg.bubble;
        if ('bubbleSpawnMs' in msg) this.tempoProssimaBollaMs = msg.bubbleSpawnMs;
        if ('cooldownGolMs' in msg) this.cooldownGolMs        = msg.cooldownGolMs;
        if ('postoSegnante' in msg) this.postoSegnante        = msg.postoSegnante;

        // Reset stato fine partita se si torna indietro (nuova partita)
        if (msg.phase !== 'finished') {
            this.giaInFaseFinale    = false;
            this.timerRitornoMenuMs = 0;
        }
    }

    flushMessages(): any[] {
        const out = [...this.messaggiDaInviare];
        this.messaggiDaInviare = [];
        return out;
    }

    /**
     * Il client si dichiara finito quando il timer di ritorno al menu
     * è scaduto — solo a quel punto il framework torna alla lobby.
     */
    isFinished(): boolean {
        return this.fase === 'finished' && this.giaInFaseFinale && this.timerRitornoMenuMs <= 0;
    }

    // ── Lettura input ─────────────────────────────────────────────

    private leggiInput(): void {
        const ui = this.userInput;
        const t  = this.tastiPremuti;

        const direzioneX = ui.moveDirectionX !== 0 ? ui.moveDirectionX
                         : t['ArrowLeft']  ? -1
                         : t['ArrowRight'] ?  1 : 0;

        const salto     = ui.moveDirectionY < 0 || t['ArrowUp']   === true;
        const giuTenuto = ui.moveDirectionY > 0 || t['ArrowDown'] === true;
        const conferma  = giuTenuto || t['Enter'] === true;

        if (this.fase === 'selection' && !this.hoConfermato) {
            if (direzioneX !== this.selXPrecedente) {
                if (direzioneX > 0) {
                    this.indicePersonaggio = (this.indicePersonaggio + 1) % PERSONAGGI.length;
                    this.messaggiDaInviare.push({ kind: 'selection:update', characterId: PERSONAGGI[this.indicePersonaggio].id });
                } else if (direzioneX < 0) {
                    this.indicePersonaggio = (this.indicePersonaggio - 1 + PERSONAGGI.length) % PERSONAGGI.length;
                    this.messaggiDaInviare.push({ kind: 'selection:update', characterId: PERSONAGGI[this.indicePersonaggio].id });
                }
                this.selXPrecedente = direzioneX;
            }
            if (conferma && !this.confermaPrecedente) {
                this.hoConfermato = true;
                this.messaggiDaInviare.push({ kind: 'selection:confirm', characterId: PERSONAGGI[this.indicePersonaggio].id });
            }
            this.confermaPrecedente = conferma;
            return;
        }

        if (this.fase === 'playing') {
            const inputCorrente = {
                moveX:    direzioneX,
                jump:     salto,
                teleport: t['KeyF'] === true,
            };
            const cambiato = (Object.keys(inputCorrente) as (keyof typeof inputCorrente)[])
                .some(chiave => inputCorrente[chiave] !== this.inputPrecedente[chiave]);
            if (cambiato) {
                this.messaggiDaInviare.push({ kind: 'input', ...inputCorrente });
                this.inputPrecedente = { ...inputCorrente };
            }
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  PARTICELLE
    // ════════════════════════════════════════════════════════════════

    /** Crea una pioggia di particelle colorate al centro del campo. */
    private creaParticelleGoal(): void {
        this.particelle = [];
        const cx = LARGHEZZA_CAMPO / 2;
        const cy = ALTEZZA_CAMPO  / 2;
        const colori = ['#ffd700','#ff4466','#44ddff','#88ff44','#ffffff','#ff8800'];
        for (let i = 0; i < 60; i++) {
            const angolo   = Math.random() * Math.PI * 2;
            const velocita = 200 + Math.random() * 400;
            this.particelle.push({
                x:  cx, y: cy,
                vx: Math.cos(angolo) * velocita,
                vy: Math.sin(angolo) * velocita - 200, // leggero impulso verso l'alto
                vita:     DURATA_ANIMAZIONE_GOL,
                vitaMax:  DURATA_ANIMAZIONE_GOL,
                raggio:   3 + Math.random() * 5,
                colore:   colori[Math.floor(Math.random() * colori.length)],
            });
        }
    }

    /** Aggiorna posizione e vita di ogni particella. */
    private aggiornaParticelle(deltaT: number): void {
        const gravita = 800; // px/s²
        this.particelle = this.particelle.filter(p => p.vita > 0);
        this.particelle.forEach(p => {
            p.vy  += gravita * deltaT;
            p.x   += p.vx * deltaT;
            p.y   += p.vy * deltaT;
            p.vita -= deltaT * 1000;
        });
    }

    // ════════════════════════════════════════════════════════════════
    //  GRAFICA
    // ════════════════════════════════════════════════════════════════

    private disegnasSfondo(ctx: CanvasRenderingContext2D): void {
        ctx.fillStyle = '#68c8ff'; ctx.fillRect(0, 0, LARGHEZZA_CAMPO, SUOLO_Y);
        ctx.fillStyle = '#239c3d'; ctx.fillRect(0, SUOLO_Y, LARGHEZZA_CAMPO, ALTEZZA_CAMPO - SUOLO_Y);
        ctx.fillStyle = '#126d2b'; ctx.fillRect(0, SUOLO_Y, LARGHEZZA_CAMPO, 7);

        ctx.save();
        const nuvole = [
            { x: 140, y: 60,  scala: 1.00, velocita: 0.22 },
            { x: 390, y: 48,  scala: 1.18, velocita: 0.18 },
            { x: 760, y: 62,  scala: 0.95, velocita: 0.15 },
        ];
        nuvole.forEach(n => {
            const x = ((n.x + this.orologio * n.velocita * 18) % (LARGHEZZA_CAMPO + 100)) - 50;
            ctx.globalAlpha = 0.30; ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.ellipse(x,            n.y,           46*n.scala, 18*n.scala, 0, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(x+28*n.scala, n.y-8*n.scala, 32*n.scala, 14*n.scala, 0, 0, Math.PI*2); ctx.fill();
        });
        ctx.restore();
    }

    private disegnaCampo(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(LARGHEZZA_CAMPO/2, CIMA_PORTA_Y);
        ctx.lineTo(LARGHEZZA_CAMPO/2, SUOLO_Y);
        ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
        this.disegnaPorta(ctx, 0,                                true);
        this.disegnaPorta(ctx, LARGHEZZA_CAMPO - LARGHEZZA_PORTA, false);
    }

    private disegnaPorta(ctx: CanvasRenderingContext2D, xPorta: number, eSinistra: boolean): void {
        const altPorta    = SUOLO_Y - CIMA_PORTA_Y;
        const T           = SPESSORE_PALO;
        const xPaloFronte = eSinistra ? xPorta + LARGHEZZA_PORTA - T : xPorta;
        const xPaloFondo  = eSinistra ? xPorta                       : xPorta + LARGHEZZA_PORTA - T;
        const xRete       = eSinistra ? xPaloFondo + T               : xPaloFronte + T;
        const largRete    = LARGHEZZA_PORTA - T * 2;

        ctx.fillStyle = 'rgba(160,200,240,0.10)';
        ctx.fillRect(xRete, CIMA_PORTA_Y + T, largRete, altPorta - T);
        ctx.save();
        ctx.beginPath(); ctx.rect(xRete, CIMA_PORTA_Y+T, largRete, altPorta-T); ctx.clip();
        ctx.strokeStyle = 'rgba(210,235,255,0.35)'; ctx.lineWidth = 0.8;
        for (let x = xRete+8; x < xRete+largRete; x += 8) {
            ctx.beginPath(); ctx.moveTo(x, CIMA_PORTA_Y+T); ctx.lineTo(x, SUOLO_Y); ctx.stroke();
        }
        for (let y = CIMA_PORTA_Y+T+8; y < SUOLO_Y; y += 8) {
            ctx.beginPath(); ctx.moveTo(xRete, y); ctx.lineTo(xRete+largRete, y); ctx.stroke();
        }
        ctx.restore();

        ctx.fillStyle = '#c0ccd8'; ctx.fillRect(xPaloFronte, CIMA_PORTA_Y, T, altPorta);
        ctx.globalAlpha = 0.55; ctx.fillStyle = '#7f8b96';
        ctx.fillRect(xPaloFondo, CIMA_PORTA_Y+T, T, altPorta-T);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#c0ccd8'; ctx.fillRect(xPorta, CIMA_PORTA_Y, LARGHEZZA_PORTA, T);
    }

    private disegnaGiocatore(ctx: CanvasRenderingContext2D, g: any): void {
        if (!g) return;
        const personaggio   = PERSONAGGI.find(p => p.id === g.characterId) ?? PERSONAGGI[0];
        const centroX       = g.x + g.w / 2;
        const eCongelato    = g.frozenMs  > 0;
        const haTestaGrande = g.bigHeadMs > 0;

        const raggioTestaBase = g.w * 0.48;
        const raggioTesta     = raggioTestaBase * (haTestaGrande ? TESTA_GRANDE_SCALA : 1);
        const centroCY        = g.y + g.h * 0.35;
        const busto_y  = g.y + g.h * 0.70;
        const busto_rx = g.w * 0.26;
        const busto_ry = g.h * 0.18;

        ctx.save();

        ctx.globalAlpha = 0.20; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(centroX, SUOLO_Y-2, g.w*0.40, 6, 0, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;

        ctx.fillStyle = personaggio.coloreMaglia;
        ctx.beginPath(); ctx.ellipse(centroX, busto_y, busto_rx, busto_ry, 0, 0, Math.PI*2); ctx.fill();

        const raggioPiede  = g.w * 0.15;
        const piedeCentroY = g.y + g.h * 0.90;
        const distanzaPiedi = g.w * 0.22;
        const dir = g.dir ?? 1;
        [-1, 1].forEach(lato => {
            const avanzamento = lato === dir ? 4 : -1;
            const px = centroX + lato * distanzaPiedi + avanzamento;
            ctx.fillStyle = '#1a1a2e';
            ctx.beginPath(); ctx.ellipse(px, piedeCentroY, raggioPiede, raggioPiede*0.65, 0, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = personaggio.coloreBordo;
            ctx.beginPath(); ctx.ellipse(px, piedeCentroY-raggioPiede*0.18, raggioPiede*0.85, raggioPiede*0.30, 0, 0, Math.PI*2); ctx.fill();
        });

        const gradienteTesta = ctx.createRadialGradient(
            centroX - raggioTesta*0.3, centroCY - raggioTesta*0.3, raggioTesta*0.05,
            centroX, centroCY, raggioTesta
        );
        gradienteTesta.addColorStop(0,    '#ffe8cc');
        gradienteTesta.addColorStop(0.65, '#f5c09a');
        gradienteTesta.addColorStop(1,    '#d4895a');
        ctx.beginPath(); ctx.arc(centroX, centroCY, raggioTesta, 0, Math.PI*2);
        ctx.fillStyle = gradienteTesta; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1.5; ctx.stroke();

        ctx.fillStyle = personaggio.coloreMaglia;
        ctx.beginPath(); ctx.ellipse(centroX, centroCY-raggioTesta*0.72, raggioTesta*0.85, raggioTesta*0.30, 0, 0, Math.PI*2); ctx.fill();

        const occhio_ox = raggioTesta*0.32, occhio_y = centroCY - raggioTesta*0.05;
        const occhio_rx = raggioTesta*0.20, occhio_ry = raggioTesta*0.24;
        ctx.fillStyle = '#fff';
        [centroX-occhio_ox, centroX+occhio_ox].forEach(ox => {
            ctx.beginPath(); ctx.ellipse(ox, occhio_y, occhio_rx, occhio_ry, 0, 0, Math.PI*2); ctx.fill();
        });
        ctx.fillStyle = '#1a0800';
        [centroX-occhio_ox, centroX+occhio_ox].forEach(ox => {
            ctx.beginPath(); ctx.arc(ox + dir*occhio_rx*0.35, occhio_y+occhio_ry*0.10, occhio_rx*0.55, 0, Math.PI*2); ctx.fill();
        });
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        [centroX-occhio_ox, centroX+occhio_ox].forEach(ox => {
            ctx.beginPath(); ctx.arc(ox + dir*occhio_rx*0.35 - occhio_rx*0.2, occhio_y-occhio_ry*0.25, occhio_rx*0.20, 0, Math.PI*2); ctx.fill();
        });

        if (eCongelato) {
            ctx.globalAlpha = 0.42; ctx.fillStyle = '#a0e8ff';
            ctx.beginPath(); ctx.arc(centroX, centroCY, raggioTesta, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(centroX, busto_y, busto_rx, busto_ry, 0, 0, Math.PI*2); ctx.fill();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#c8f0ff'; ctx.lineWidth = 1.5;
            [[0,-1],[0.866,0.5],[-0.866,0.5]].forEach(([ex, ey]) => {
                ctx.beginPath(); ctx.moveTo(centroX, centroCY);
                ctx.lineTo(centroX + ex*raggioTesta*0.85, centroCY + ey*raggioTesta*0.85); ctx.stroke();
            });
        }

        ctx.fillStyle = g.seat === 0 ? '#4ac7ff' : '#ff7272';
        ctx.font = `bold ${Math.round(raggioTesta*0.42)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(g.seat === 0 ? 'P1' : 'P2', centroX, centroCY - raggioTesta*1.42);

        this.disegnaBarra_Teleport(ctx, g);
        ctx.restore();
    }

    private disegnaBarra_Teleport(ctx: CanvasRenderingContext2D, g: any): void {
        const larghBarra = g.w, altBarra = 5;
        const xBarra = g.x, yBarra = g.y - 14;
        const percentuale = g.tpCdMs > 0 ? 1 - g.tpCdMs / TELEPORT_COOLDOWN : 1;

        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(xBarra, yBarra, larghBarra, altBarra);
        ctx.fillStyle = percentuale < 1 ? '#ffc66e' : '#68d68d';
        ctx.fillRect(xBarra, yBarra, larghBarra * percentuale, altBarra);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `bold ${Math.round(altBarra * 1.8)}px sans-serif`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('TP', xBarra, yBarra + altBarra / 2);
    }

    private disegnaPalla(ctx: CanvasRenderingContext2D, p: any): void {
        const { x, y } = p;
        ctx.save();
        ctx.globalAlpha = 0.18; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(x, SUOLO_Y-3, PALLA_RAGGIO*0.9, PALLA_RAGGIO*0.28, 0, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;

        const gradiente = ctx.createRadialGradient(x-PALLA_RAGGIO*0.35, y-PALLA_RAGGIO*0.35, PALLA_RAGGIO*0.05, x, y, PALLA_RAGGIO);
        gradiente.addColorStop(0, '#fff'); gradiente.addColorStop(0.4, '#f0f0f0'); gradiente.addColorStop(1, '#8888a0');
        ctx.beginPath(); ctx.arc(x, y, PALLA_RAGGIO, 0, Math.PI*2);
        ctx.fillStyle = gradiente; ctx.fill();
        ctx.strokeStyle = '#666'; ctx.lineWidth = 1.5; ctx.stroke();

        ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
        const vertici = [[0,-1],[0.951,-0.309],[0.588,0.809],[-0.588,0.809],[-0.951,-0.309]];
        ctx.beginPath();
        vertici.forEach(([vx, vy], i) => {
            const px = x + vx*PALLA_RAGGIO*0.48, py = y + vy*PALLA_RAGGIO*0.48;
            i === 0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py);
        });
        ctx.closePath(); ctx.stroke();
        ctx.restore();
    }

    private disegnaBolla(ctx: CanvasRenderingContext2D, bolla: any): void {
        const pulsazione = 1 + 0.12 * Math.sin(this.orologio * 4);
        const raggio = BOLLA_RAGGIO * pulsazione;
        const colore = bolla.type === 'ice' ? '#7df0ff' : '#a0ff80';
        const icona  = bolla.type === 'ice' ? '❄'       : '💪';

        ctx.save();
        ctx.globalAlpha = 0.25; ctx.fillStyle = colore;
        ctx.beginPath(); ctx.arc(bolla.x, bolla.y, raggio * 1.5, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = colore;
        ctx.beginPath(); ctx.arc(bolla.x, bolla.y, raggio, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#07111c';
        ctx.font = `${Math.round(raggio * 1.1)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(icona, bolla.x, bolla.y);
        ctx.restore();
    }

    private disegnaHUD(ctx: CanvasRenderingContext2D): void {
        const secondiTotali = Math.ceil(Math.max(0, this.tempoMs) / 1000);
        const minuti  = String(Math.floor(secondiTotali / 60)).padStart(2, '0');
        const secondi = String(secondiTotali % 60).padStart(2, '0');
        const testoTempo = this.fase === 'countdown'
            ? String(Math.max(0, Math.ceil(this.tempoMs / 1000)))
            : `${minuti}:${secondi}`;

        ctx.save();
        ctx.font = `bold ${Math.round(LARGHEZZA_CAMPO*0.028)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText(String(this.punteggio.left),  LARGHEZZA_CAMPO*0.16+1, 13);
        ctx.fillText(testoTempo,                   LARGHEZZA_CAMPO/2+1,    13);
        ctx.fillText(String(this.punteggio.right), LARGHEZZA_CAMPO*0.84+1, 13);
        ctx.fillStyle = '#4ac7ff'; ctx.fillText(String(this.punteggio.left),  LARGHEZZA_CAMPO*0.16, 12);
        ctx.fillStyle = '#ffffff'; ctx.fillText(testoTempo,                   LARGHEZZA_CAMPO/2,    12);
        ctx.fillStyle = '#ff7272'; ctx.fillText(String(this.punteggio.right), LARGHEZZA_CAMPO*0.84, 12);

        if (!this.bollaRicevuta && this.fase === 'playing') {
            const percentuale = 1 - this.tempoProssimaBollaMs / BOLLA_INTERVALLO_SPAWN;
            const larghBarra = 140, altBarra = 6;
            const xBarra = LARGHEZZA_CAMPO/2 - larghBarra/2, yBarra = 44;
            ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(xBarra, yBarra, larghBarra, altBarra);
            ctx.fillStyle = '#ffd700';          ctx.fillRect(xBarra, yBarra, larghBarra*percentuale, altBarra);
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = `${Math.round(ALTEZZA_CAMPO*0.022)}px sans-serif`;
            ctx.fillText('⚡ prossima bolla', LARGHEZZA_CAMPO/2, yBarra + 14);
        }
        ctx.restore();
    }

    private disegnaContoAllaRovescia(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.fillStyle = 'rgba(7,12,20,0.55)'; ctx.fillRect(0, 0, LARGHEZZA_CAMPO, ALTEZZA_CAMPO);
        const numero = Math.max(0, Math.ceil(this.tempoMs / 1000));
        ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(ALTEZZA_CAMPO*0.20)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(numero > 0 ? String(numero) : 'Via!', LARGHEZZA_CAMPO/2, ALTEZZA_CAMPO/2-16);
        ctx.font = `600 ${Math.round(ALTEZZA_CAMPO*0.038)}px sans-serif`;
        ctx.fillStyle = 'rgba(228,238,255,0.8)';
        ctx.fillText('Pronti?', LARGHEZZA_CAMPO/2, ALTEZZA_CAMPO/2+50);
        ctx.restore();
    }

    /**
     * Overlay semi-trasparente durante i 2 secondi di freeze post-gol.
     * Mostra una barra di progresso e il punteggio attuale.
     */
    private disegnaCooldownGol(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        // Sfondo scuro leggero
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        ctx.fillRect(0, 0, LARGHEZZA_CAMPO, ALTEZZA_CAMPO);

        // Barra di avanzamento (si svuota in 2 secondi)
        const pct       = this.cooldownGolMs / DURATA_COOLDOWN_GOL; // da 1 a 0
        const barW      = LARGHEZZA_CAMPO * 0.40;
        const barH      = 10;
        const barX      = (LARGHEZZA_CAMPO - barW) / 2;
        const barY      = ALTEZZA_CAMPO * 0.68;
        ctx.fillStyle   = 'rgba(255,255,255,0.15)'; ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle   = '#ffd700';                ctx.fillRect(barX, barY, barW * pct, barH);

        ctx.restore();
    }

    /**
     * Animazione "GOAL!" con:
     *  - Flash bianco iniziale che svanisce
     *  - Testo con zoom (parte grande e si riduce)
     *  - Particelle colorate
     *  - Sottotitolo con chi ha segnato
     */
    private disegnaAnimazioneGoal(ctx: CanvasRenderingContext2D): void {
        // progresso: da 1 (inizio) a 0 (fine animazione)
        const progresso = this.goalAnimMs / DURATA_ANIMAZIONE_GOL;

        ctx.save();

        // ── Flash bianco iniziale ─────────────────────────────────
        // Nei primi 20% dell'animazione c'è un lampo bianco che svanisce
        if (progresso > 0.80) {
            const intensita = (progresso - 0.80) / 0.20; // da 1 a 0
            ctx.fillStyle   = `rgba(255,255,255,${intensita * 0.55})`;
            ctx.fillRect(0, 0, LARGHEZZA_CAMPO, ALTEZZA_CAMPO);
        }

        // ── Particelle ───────────────────────────────────────────
        this.particelle.forEach(p => {
            const alpha = p.vita / p.vitaMax;
            ctx.globalAlpha = alpha;
            ctx.fillStyle   = p.colore;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.raggio, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalAlpha = 1;

        // ── Testo GOAL! con zoom ──────────────────────────────────
        // Il testo parte grande (scala 1.8) e arriva a 1.0
        // con un effetto "rimbalzo" (easeOutBounce semplificato)
        const scalaBase  = 1.0 + 0.8 * Math.max(0, progresso - 0.2);
        const cx         = LARGHEZZA_CAMPO / 2;
        const cy         = ALTEZZA_CAMPO   * 0.42;
        const fontSize   = Math.round(ALTEZZA_CAMPO * 0.16 * scalaBase);

        // Ombra
        ctx.font      = `900 ${fontSize}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillText('GOAL!', cx + 5, cy + 5);

        // Testo principale (colore alternato tra bianco e oro)
        const oscillazione = Math.sin(this.orologio * 12) * 0.5 + 0.5;
        const r = Math.round(255);
        const g2 = Math.round(200 + 55 * oscillazione);
        const b2 = Math.round(0   + 80 * (1 - oscillazione));
        ctx.fillStyle = `rgb(${r},${g2},${b2})`;
        ctx.fillText('GOAL!', cx, cy);

        // Bordo bianco
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 3;
        ctx.strokeText('GOAL!', cx, cy);

        // ── Sottotitolo chi ha segnato ────────────────────────────
        if (this.postoSegnante !== null) {
            const nomeGiocatore = this.postoSegnante === 0 ? 'P1' : 'P2';
            const colore        = this.postoSegnante === 0 ? '#4ac7ff' : '#ff7272';
            ctx.font      = `bold ${Math.round(ALTEZZA_CAMPO * 0.042)}px sans-serif`;
            ctx.fillStyle = colore;
            ctx.fillText(`⚽  ${nomeGiocatore} segna!`, cx, cy + fontSize * 0.65);
        }

        ctx.restore();
    }

    private disegnaSelezione(ctx: CanvasRenderingContext2D): void {
        const largPannello = LARGHEZZA_CAMPO*0.44, altPannello = ALTEZZA_CAMPO*0.70;
        const xPannello = (LARGHEZZA_CAMPO-largPannello)/2, yPannello = (ALTEZZA_CAMPO-altPannello)/2;

        ctx.save();
        ctx.fillStyle = 'rgba(9,18,32,0.93)'; this.rettangoloArrotondato(ctx,xPannello,yPannello,largPannello,altPannello,24); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5; this.rettangoloArrotondato(ctx,xPannello,yPannello,largPannello,altPannello,24); ctx.stroke();

        const personaggio = PERSONAGGI[this.indicePersonaggio];
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(238,245,255,0.55)'; ctx.font = `${Math.round(ALTEZZA_CAMPO*0.022)}px sans-serif`;
        ctx.fillText('HEAD BALL', LARGHEZZA_CAMPO/2, yPannello+18);
        ctx.fillStyle = '#eef5ff'; ctx.font = `bold ${Math.round(ALTEZZA_CAMPO*0.042)}px sans-serif`;
        ctx.fillText(
            this.hoConfermato        ? 'Pronto! In attesa avversario...' :
            this.fase === 'waiting'  ? 'In attesa di avversario...'      :
                                       'Scegli il tuo personaggio',
            LARGHEZZA_CAMPO/2, yPannello+42
        );

        const cx = LARGHEZZA_CAMPO/2, cy = yPannello+altPannello*0.42;
        const rOrb = Math.round(largPannello*0.115);
        const gradOrb = ctx.createRadialGradient(cx-rOrb*0.35,cy-rOrb*0.35,rOrb*0.05,cx,cy,rOrb);
        gradOrb.addColorStop(0,'#fff'); gradOrb.addColorStop(0.5,personaggio.coloreAccento); gradOrb.addColorStop(1,personaggio.coloreMaglia);
        ctx.beginPath(); ctx.arc(cx,cy,rOrb,0,Math.PI*2); ctx.fillStyle=gradOrb; ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=2; ctx.stroke();
        ctx.fillStyle='#eef5ff'; ctx.font=`bold ${Math.round(ALTEZZA_CAMPO*0.036)}px sans-serif`;
        ctx.fillText(personaggio.nome, LARGHEZZA_CAMPO/2, cy+rOrb+10);

        if (!this.hoConfermato && this.fase === 'selection') {
            ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font=`${Math.round(ALTEZZA_CAMPO*0.048)}px sans-serif`;
            ctx.textBaseline='middle';
            ctx.fillText('◀', cx-rOrb*1.8, cy); ctx.fillText('▶', cx+rOrb*1.8, cy);
            ctx.textBaseline='top';
            ctx.fillStyle='rgba(238,245,255,0.6)'; ctx.font=`${Math.round(ALTEZZA_CAMPO*0.026)}px sans-serif`;
            ctx.fillText('A / ←  ·  D / →   cambia', LARGHEZZA_CAMPO/2, yPannello+altPannello*0.75);
            ctx.fillStyle='rgba(104,214,141,0.9)'; ctx.font=`bold ${Math.round(ALTEZZA_CAMPO*0.028)}px sans-serif`;
            ctx.fillText('S / Enter   conferma', LARGHEZZA_CAMPO/2, yPannello+altPannello*0.84);
        } else if (this.hoConfermato) {
            ctx.fillStyle='#68d68d'; ctx.font=`bold ${Math.round(ALTEZZA_CAMPO*0.030)}px sans-serif`;
            ctx.fillText('✓ Confermato!', LARGHEZZA_CAMPO/2, yPannello+altPannello*0.80);
        }

        const sceltaAvversario = this.scelte[this.mioPosto === 0 ? 1 : 0];
        if (sceltaAvversario) {
            const nomeAvversario = PERSONAGGI.find(p => p.id === sceltaAvversario.characterId)?.nome ?? '?';
            ctx.fillStyle='rgba(238,245,255,0.40)'; ctx.font=`${Math.round(ALTEZZA_CAMPO*0.024)}px sans-serif`;
            ctx.fillText(
                sceltaAvversario.confirmed ? `Avversario pronto (${nomeAvversario})` : 'Avversario sta scegliendo...',
                LARGHEZZA_CAMPO/2, yPannello+altPannello-20
            );
        }
        ctx.restore();
    }

    private disegnaRisultato(ctx: CanvasRenderingContext2D): void {
        const largP = LARGHEZZA_CAMPO*0.50, altP = ALTEZZA_CAMPO*0.46;
        const xP = (LARGHEZZA_CAMPO-largP)/2, yP = (ALTEZZA_CAMPO-altP)/2;
        ctx.save();

        // Oscuramento sfondo
        ctx.fillStyle='rgba(5,10,20,0.78)'; ctx.fillRect(0, 0, LARGHEZZA_CAMPO, ALTEZZA_CAMPO);

        ctx.fillStyle='rgba(9,18,32,0.97)'; this.rettangoloArrotondato(ctx,xP,yP,largP,altP,28); ctx.fill();
        ctx.strokeStyle='rgba(255,215,0,0.40)'; ctx.lineWidth=2; this.rettangoloArrotondato(ctx,xP,yP,largP,altP,28); ctx.stroke();

        ctx.textAlign='center'; ctx.textBaseline='middle';

        // Titolo risultato
        ctx.fillStyle='#ffd700'; ctx.font=`bold ${Math.round(ALTEZZA_CAMPO*0.072)}px sans-serif`;
        ctx.fillText(
            this.vincitore==='draw'  ? '🤝 Pareggio!'     :
            this.vincitore==='left'  ? '🏆 Vince P1!'     : '🏆 Vince P2!',
            LARGHEZZA_CAMPO/2, yP+altP*0.28
        );

        // Punteggio finale grande
        ctx.fillStyle='#eef5ff'; ctx.font=`bold ${Math.round(ALTEZZA_CAMPO*0.070)}px sans-serif`;
        ctx.fillText(`${this.punteggio.left}  –  ${this.punteggio.right}`, LARGHEZZA_CAMPO/2, yP+altP*0.55);

        // Barra di conto alla rovescia per il ritorno al menu
        const pctRitorno = this.timerRitornoMenuMs / DURATA_SCHERMATA_FINE;
        const barW = largP * 0.70, barH = 7;
        const barX = xP + (largP - barW) / 2, barY = yP + altP * 0.78;
        ctx.fillStyle='rgba(255,255,255,0.12)'; ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle='#68d68d';                ctx.fillRect(barX, barY, barW * pctRitorno, barH);

        ctx.fillStyle='rgba(238,245,255,0.45)'; ctx.font=`${Math.round(ALTEZZA_CAMPO*0.026)}px sans-serif`;
        ctx.fillText('Ritorno al menu...', LARGHEZZA_CAMPO/2, yP+altP*0.90);

        ctx.restore();
    }

    private disegnaManuale(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.fillStyle = 'rgba(5,12,24,0.82)'; ctx.fillRect(0, 0, LARGHEZZA_CAMPO, ALTEZZA_CAMPO);

        const largP = LARGHEZZA_CAMPO*0.62, altP = ALTEZZA_CAMPO*0.88;
        const xP = (LARGHEZZA_CAMPO-largP)/2, yP = (ALTEZZA_CAMPO-altP)/2;
        ctx.fillStyle='rgba(10,20,38,0.97)'; this.rettangoloArrotondato(ctx,xP,yP,largP,altP,28); ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=1.5; this.rettangoloArrotondato(ctx,xP,yP,largP,altP,28); ctx.stroke();

        const cx = LARGHEZZA_CAMPO/2;
        ctx.textAlign='center'; ctx.textBaseline='top';
        ctx.fillStyle='#eef5ff'; ctx.font=`800 ${Math.round(ALTEZZA_CAMPO*0.058)}px sans-serif`;
        ctx.fillText('⚽ HEAD BALL', cx, yP+20);
        ctx.fillStyle='rgba(238,245,255,0.55)'; ctx.font=`${Math.round(ALTEZZA_CAMPO*0.026)}px sans-serif`;
        ctx.fillText('Manuale di gioco', cx, yP+72);

        const altRiga  = ALTEZZA_CAMPO*0.068;
        const colIcona = xP + largP*0.08;
        const colTasto = xP + largP*0.22;
        let yRiga = yP + 108;

        const righeControlli = [
            { icona: '←→', tasto: 'A / ←  D / →',  descrizione: 'Muovi il personaggio'                            },
            { icona: '↑',  tasto: 'W / ↑',           descrizione: 'Salta  (di nuovo in aria = doppio salto)'        },
            { icona: '⚡', tasto: 'F',                descrizione: `Teleport — scatta avanti  (cooldown ${TELEPORT_COOLDOWN/1000}s)` },
        ];
        righeControlli.forEach(riga => {
            ctx.textAlign='left'; ctx.textBaseline='middle';
            ctx.fillStyle='rgba(255,255,255,0.12)'; this.rettangoloArrotondato(ctx, xP+largP*0.04, yRiga-altRiga*0.42, largP*0.92, altRiga*0.84, 10); ctx.fill();
            ctx.fillStyle='#ffd966'; ctx.font=`bold ${Math.round(ALTEZZA_CAMPO*0.038)}px sans-serif`; ctx.fillText(riga.icona, colIcona+16, yRiga);
            ctx.fillStyle='#4ac7ff'; ctx.font=`bold ${Math.round(ALTEZZA_CAMPO*0.028)}px sans-serif`; ctx.fillText(riga.tasto, colTasto, yRiga);
            ctx.fillStyle='#eef5ff'; ctx.font=`${Math.round(ALTEZZA_CAMPO*0.026)}px sans-serif`;      ctx.fillText(riga.descrizione, colTasto+largP*0.28, yRiga);
            yRiga += altRiga;
        });

        yRiga += altRiga*0.3;
        ctx.textAlign='center'; ctx.textBaseline='top';
        ctx.fillStyle='rgba(255,255,255,0.45)'; ctx.font=`${Math.round(ALTEZZA_CAMPO*0.024)}px sans-serif`;
        ctx.fillText('── Superpoteri Bolla ──', cx, yRiga);
        yRiga += altRiga*0.65;

        const righeBolla = [
            { icona: '❄', colore: '#7df0ff', descrizione: `ICE — Congela l'avversario per ${GHIACCIO_DURATA/1000}s` },
            { icona: '💪', colore: '#a0ff80', descrizione: `BIG HEAD — Testa enorme per ${TESTA_GRANDE_DURATA/1000}s  (hitbox più grande!)` },
        ];
        righeBolla.forEach(riga => {
            ctx.textAlign='left'; ctx.textBaseline='middle';
            ctx.fillStyle='rgba(255,255,255,0.12)'; this.rettangoloArrotondato(ctx, xP+largP*0.04, yRiga-altRiga*0.42, largP*0.92, altRiga*0.84, 10); ctx.fill();
            ctx.font=`${Math.round(ALTEZZA_CAMPO*0.038)}px sans-serif`; ctx.fillText(riga.icona, colIcona+14, yRiga);
            ctx.fillStyle=riga.colore; ctx.font=`${Math.round(ALTEZZA_CAMPO*0.026)}px sans-serif`; ctx.fillText(riga.descrizione, colTasto, yRiga);
            yRiga += altRiga;
        });

        yRiga += altRiga*0.2;
        ctx.textAlign='center'; ctx.textBaseline='top';
        ctx.fillStyle='rgba(238,245,255,0.40)'; ctx.font=`${Math.round(ALTEZZA_CAMPO*0.022)}px sans-serif`;
        ctx.fillText(`Le bolle appaiono ogni ${BOLLA_INTERVALLO_SPAWN/1000}s — cammina sopra per raccoglierle!`, cx, yRiga);

        const largBtn=180, altBtn=48, xBtn=cx-largBtn/2, yBtn=ALTEZZA_CAMPO*0.78;
        const gradBtn = ctx.createLinearGradient(xBtn, yBtn, xBtn, yBtn+altBtn);
        gradBtn.addColorStop(0,'#68d68d'); gradBtn.addColorStop(1,'#2f9360');
        ctx.fillStyle=gradBtn; this.rettangoloArrotondato(ctx,xBtn,yBtn,largBtn,altBtn,14); ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1; this.rettangoloArrotondato(ctx,xBtn,yBtn,largBtn,altBtn,14); ctx.stroke();
        ctx.fillStyle='#07111c'; ctx.font=`800 ${Math.round(altBtn*0.50)}px sans-serif`;
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText('🎮  GIOCA!', cx, yBtn+altBtn/2);
        ctx.restore();
    }

    private rettangoloArrotondato(ctx: CanvasRenderingContext2D, x: number, y: number, largh: number, alt: number, raggio: number): void {
        ctx.beginPath();
        ctx.moveTo(x+raggio, y); ctx.lineTo(x+largh-raggio, y); ctx.arcTo(x+largh, y,      x+largh, y+raggio,      raggio);
        ctx.lineTo(x+largh, y+alt-raggio);                       ctx.arcTo(x+largh, y+alt,  x+largh-raggio, y+alt,  raggio);
        ctx.lineTo(x+raggio, y+alt);                             ctx.arcTo(x,       y+alt,  x,       y+alt-raggio,  raggio);
        ctx.lineTo(x,        y+raggio);                          ctx.arcTo(x,       y,      x+raggio, y,            raggio);
        ctx.closePath();
    }
}

// ════════════════════════════════════════════════════════════════
//  TIPO AUSILIARIO (usato solo dal client per le particelle)
// ════════════════════════════════════════════════════════════════

interface Particella {
    x: number; y: number;
    vx: number; vy: number;
    vita:    number;  // ms rimanenti
    vitaMax: number;  // ms totali (per calcolare l'alpha)
    raggio:  number;
    colore:  string;
}