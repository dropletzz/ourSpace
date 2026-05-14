import { GameClient, GameServer } from './game';
import { IncomingMsg, OutgoingMsg } from '../server';
import { UserInput } from '../client/user-input';

// ==========================================
// 1. COSTANTI E MAPPA DI GIOCO
// ==========================================

// Dimensioni virtuali del canvas di gioco (coordinate server-side)
const VIRTUAL_W = 1000;
const VIRTUAL_H = 600;

// Fisica di base
const GRAVITY      = 1500; // px/s² - accelerazione verso il basso
const JUMP_FORCE   = 600;  // px/s  - velocità verticale applicata al salto
const MOVE_SPEED   = 360;  // px/s  - velocità massima orizzontale a terra

// Frizione: quanto velocemente il personaggio rallenta (moltiplicatore per dt)
// A terra la frizione è alta (stop quasi istantaneo), in aria è bassa (scivoloso)
const FRICTION_GROUND = 25;  // moltiplicatore per dt -> quasi istantaneo
const FRICTION_AIR    = 6;   // moltiplicatore per dt -> lento, da smash bros

// Limiti dell'arena: uscire da questi bordi causa la morte
const MAP_LIMIT_LEFT   = -120;
const MAP_LIMIT_RIGHT  = 1120;
const MAP_LIMIT_TOP    = -500;
const MAP_LIMIT_BOTTOM = 750;

// Combattimento
const DAMAGE_PER_HIT    = 10;   // danno base per colpo
const BASE_KNOCKBACK_X  = 380;  // sbalzo orizzontale base (px/s)
// Lo sbalzo verticale è calcolato come frazione di quello orizzontale finale.
// Così un colpo forte manda lontano in orizzontale E un po' in su,
// ma non vola prevalentemente verso l'alto come un razzo.
// Valore: 0 = nessuno sbalzo verticale, 1 = uguale all'orizzontale
const KNOCKBACK_Y_RATIO = 0.80; // componente verticale = 55% di quella orizzontale
const KNOCKBACK_SCALING = 45;   // più è alto, più il danno influenza lo sbalzo
const KNOCKBACK_CAP     = 10.0;  // cap del moltiplicatore: evita voli all'infinito

// Vite per giocatore - quando scendono a zero la partita finisce
const MAX_LIVES = 3;

// Tempo di respawn dopo la morte (in secondi)
const RESPAWN_TIME = 2.0;

// Durata del messaggio di kill sullo schermo (in secondi)
const KILL_MSG_DURATION = 2.5;

// Hitbox dell'attacco, relativa al bordo del personaggio
const ATTACK_W = 45;
const ATTACK_H = 24;
const ATTACK_Y_OFFSET = 8; // quanto scende dalla cima del personaggio

// ==========================================
// INTERFACCE
// ==========================================

interface Platform {
    x: number;
    y: number;
    w: number;
    h: number;
    isSolid: boolean; // true = blocca anche dal basso (piattaforma solida)
}

// Stato completo di un giocatore (server-side)
interface PlayerState {
    // Posizione e dimensioni
    x: number;
    y: number;
    w: number;
    h: number;

    // Velocità
    vx: number;
    vy: number;

    // Estetica
    color: string;

    // Direzione e stato movimento
    facingRight:       boolean;
    isOnGround:        boolean; // true se il piede tocca una piattaforma
    jumpsLeft:         number;  // salti rimanenti (2 = terra, 1 = in aria, 0 = esauriti)
    jumpKeyWasPressed: boolean;

    // Stato attacco
    isAttacking: boolean;
    hasHit:      boolean;    // true se l'attacco corrente ha già colpito

    // Combattimento e vite
    damage:          number;  // percentuale accumulata (come smash bros)
    lives:           number;  // vite rimanenti
    isDead:          boolean; // true = morto in questo momento (in respawn)
    respawnTimer:    number;  // secondi rimasti prima del respawn

    // Indice del giocatore (0 o 1) per posizionamento spawn
    spawnIndex: number;
}

// Layout delle piattaforme
const PLATFORMS: Platform[] = [
    // Pavimento principale, solido su tutti i lati
    { x: 150, y: 450, w: 700, h: 40, isSolid: true },
    // Piattaforme galleggianti (passabili dal basso)
    { x: 200, y: 300, w: 150, h: 15, isSolid: false },
    { x: 650, y: 300, w: 150, h: 15, isSolid: false },
    { x: 425, y: 180, w: 150, h: 15, isSolid: false }
];

// Posizioni di spawn per indice giocatore
const SPAWN_POSITIONS = [
    { x: 300, y: 350 },
    { x: 600, y: 350 }
];

// ==========================================
// 2. FUNZIONI DI SUPPORTO (PURE)
// ==========================================

// Applica lo spawn a un giocatore: riposiziona e azzera le velocità
// Non tocca vite e danno (quello è compito di chi chiama)
function spawnPlayer(p: PlayerState): void {
    const spawn = SPAWN_POSITIONS[p.spawnIndex];
    p.x = spawn.x;
    p.y = spawn.y;
    p.vx = 0;
    p.vy = 0;
    p.isOnGround       = false;
    p.jumpsLeft        = 2;    // al respawn si ripristinano entrambi i salti
    p.jumpKeyWasPressed = false;
    p.isAttacking      = false;
    p.hasHit           = false;
    p.isDead           = false;
    p.respawnTimer     = 0;
}

// Calcola il nome del colore leggibile per il messaggio di vittoria
function colorName(color: string): string {
    if (color === "#ff0000") {
        return "ROSSO";
    }
    return "BLU";
}

// ==========================================
// 3. IL SERVER (Fisica e Logica)
// ==========================================
export class BrawlServer extends GameServer {
    private players: Record<string, PlayerState> = {};

    // Messaggio finale mostrato quando la partita è conclusa
    private winnerMessage: string = "";

    // La partita è conclusa solo quando un giocatore ha esaurito le vite
    private gameOver: boolean = false;

    // Messaggio temporaneo mostrato quando qualcuno muore (kill)
    // killTimer conta i secondi rimasti prima che scompaia
    private killMessage: string = "";
    private killTimer: number = 0;

    // ----------------------------------------
    // INIT: chiamato una sola volta all'avvio
    // ----------------------------------------
    init(players: any): void {
        this.players = players;
        const colors = ["#ff0000", "#0000ff"];
        let i = 0;

        Object.keys(this.players).forEach(id => {
            const p = this.players[id] as PlayerState;

            // Dimensioni del personaggio
            p.w = 40;
            p.h = 40;

            // Colore e indice
            p.color      = colors[i % 2];
            p.spawnIndex = i;

            // Vite e danno iniziale
            p.lives  = MAX_LIVES;
            p.damage = 0;

            // Stato di morte iniziale
            p.isDead       = false;
            p.respawnTimer = 0;

            // Posizione e fisica iniziale tramite spawn
            spawnPlayer(p);
            // jumpsLeft viene già impostato a 2 dentro spawnPlayer

            // Il primo giocatore guarda a destra, il secondo a sinistra
            if (i === 0) {
                p.facingRight = true;
            } else {
                p.facingRight = false;
            }

            i++;
        });
    }

    // ----------------------------------------
    // TICK: chiamato ogni frame
    // ----------------------------------------
    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {

        // --- Aggiornamento timer kill message ---
        // Il messaggio scompare dopo KILL_MSG_DURATION secondi
        if (this.killTimer > 0) {
            this.killTimer = this.killTimer - dt;
            if (this.killTimer <= 0) {
                this.killMessage = "";
                this.killTimer   = 0;
            }
        }

        // --- A. LETTURA INPUT ---
        // Processa solo i giocatori vivi. I morti aspettano il respawn timer.
        incomingMessages.forEach(msg => {
            const p = this.players[msg.clientId];
            const keys = msg.payload.keys;

            // Sicurezza: il giocatore potrebbe non esistere
            if (p === undefined) {
                return;
            }

            // I morti non ricevono input
            if (p.isDead === true) {
                return;
            }

            // --- Movimento orizzontale ---
            // L'input sovrascrive la velocità solo se siamo a terra.
            // In aria l'input modifica la velocità più debolmente (controllo aereo).
            if (keys.A === true) {
                p.facingRight = false;
                if (p.isOnGround === true) {
                    // Movimento a terra: velocità istantanea
                    p.vx = -MOVE_SPEED;
                } else {
                    // Controllo aereo: spingo verso sinistra ma non blocco lo sbalzo
                    // Clamp per non superare MOVE_SPEED in aria
                    p.vx = p.vx - (MOVE_SPEED * 3 * dt);
                    if (p.vx < -MOVE_SPEED) {
                        p.vx = -MOVE_SPEED;
                    }
                }
            } else if (keys.D === true) {
                p.facingRight = true;
                if (p.isOnGround === true) {
                    p.vx = MOVE_SPEED;
                } else {
                    p.vx = p.vx + (MOVE_SPEED * 3 * dt);
                    if (p.vx > MOVE_SPEED) {
                        p.vx = MOVE_SPEED;
                    }
                }
            }

            // --- Salto doppio ---
            // Entrambi i salti usano la stessa forza JUMP_FORCE.
            // Con JUMP_FORCE=600 e GRAVITY=1500 ogni salto copre h = 600²/3000 = 120px.
            // Due salti = 240px totale, uguale al vecchio salto singolo da 850px/s.
            // jumpKeyWasPressed evita l'autofire: il salto scatta solo al momento della pressione.
            if (keys.W === true) {
                if (p.jumpKeyWasPressed === false) {
                    if (p.jumpsLeft > 0) {
                        if (p.jumpsLeft === 2) {
                            // Primo salto da terra
                            p.vy = -JUMP_FORCE;
                        } else {
                            // Secondo salto in aria (doppio salto)
                            p.vy = -JUMP_FORCE;
                        }
                        p.jumpsLeft  = p.jumpsLeft - 1;
                        p.isOnGround = false;
                    }
                }
                p.jumpKeyWasPressed = true;
            } else {
                p.jumpKeyWasPressed = false;
            }

            // --- Attacco ---
            // Quando si preme SPACE si attiva isAttacking.
            // hasHit viene resettato solo quando il tasto viene premuto DA ZERO,
            // così ogni "press" è un nuovo attacco e si può colpire una volta per press.
            if (keys.SPACE === true) {
                if (p.isAttacking === false) {
                    // Nuovo press: reset del flag per permettere un nuovo colpo
                    p.hasHit = false;
                }
                p.isAttacking = true;
            } else {
                p.isAttacking = false;
            }
        });

        // --- B. FISICA, COLLISIONI E MORTE ---
        Object.keys(this.players).forEach(id => {
            const p = this.players[id];

            // --- Gestione timer di respawn ---
            // Se il giocatore è morto, contiamo il timer e poi lo rispawniamo
            if (p.isDead === true) {
                p.respawnTimer = p.respawnTimer - dt;
                if (p.respawnTimer <= 0) {
                    spawnPlayer(p);
                    // Il danno si azzera al respawn (come in brawlhalla)
                    p.damage = 0;
                }
                // Non processiamo altro per questo giocatore
                return;
            }

            // --- Integrazione della gravità ---
            p.vy = p.vy + (GRAVITY * dt);

            // --- Frizione orizzontale ---
            // Applicata SOLO quando non c'è input (gestito sopra).
            // La frizione differisce tra terra e aria.
            // Attenzione: non vogliamo invertire il segno, quindi usiamo un clamp a 0.
            const friction = p.isOnGround === true ? FRICTION_GROUND : FRICTION_AIR;

            // Frizione applicata solo se non c'è input direzionale in questa direzione.
            // Questo si fa qui nel tick perché l'input è già stato processato sopra.
            // Se vx è positivo, lo diminuiamo; se è negativo, lo aumentiamo verso 0.
            if (p.vx > 0) {
                p.vx = p.vx - (p.vx * friction * dt);
                if (p.vx < 1) {
                    p.vx = 0;
                }
            } else if (p.vx < 0) {
                p.vx = p.vx - (p.vx * friction * dt);
                if (p.vx > -1) {
                    p.vx = 0;
                }
            }

            // Memorizziamo la posizione del frame precedente per il CCD (continuous collision)
            const oldX = p.x;
            const oldY = p.y;

            // --- Spostamento ---
            p.x = p.x + (p.vx * dt);
            p.y = p.y + (p.vy * dt);

            // Resettiamo lo stato "a terra" prima di controllare le collisioni
            p.isOnGround = false;

            // --- Collisioni con le piattaforme ---
            PLATFORMS.forEach(plat => {
                // Controllo AABB orizzontale (il giocatore sovrappone la piattaforma in X)
                const overlapX = (p.x + p.w > plat.x) && (p.x < plat.x + plat.w);

                if (overlapX === false) {
                    return;
                }

                // --- Collisione dall'alto (atterraggio) ---
                // Condizioni:
                // 1. Il giocatore scende (vy >= 0)
                // 2. Nel frame precedente il piede era sopra (o al livello di) la piattaforma
                // 3. Ora il piede è sotto il bordo superiore della piattaforma
                const wasFeetAbove = (oldY + p.h) <= (plat.y + 1);
                const nowFeetBelow = (p.y + p.h) >= plat.y;

                if (p.vy >= 0) {
                    if (wasFeetAbove === true) {
                        if (nowFeetBelow === true) {
                            p.y          = plat.y - p.h;
                            p.vy         = 0;
                            p.jumpsLeft  = 2;    // atterrato: ripristina entrambi i salti
                            p.isOnGround = true;
                        }
                    }
                }

                // --- Collisione dal basso (testa contro soffitto) ---
                // Solo per piattaforme solide.
                // Condizioni:
                // 1. Il giocatore sale (vy < 0)
                // 2. Nel frame precedente la testa era sotto (o al livello del) il fondo della piattaforma
                // 3. Ora la testa è sopra il fondo della piattaforma
                if (plat.isSolid === true) {
                    const wasHeadBelow  = oldY >= (plat.y + plat.h - 1);
                    const nowHeadAbove  = p.y <= (plat.y + plat.h);

                    if (p.vy < 0) {
                        if (wasHeadBelow === true) {
                            if (nowHeadAbove === true) {
                                p.y  = plat.y + plat.h;
                                p.vy = 0;
                            }
                        }
                    }
                }
            });

            // --- Controllo uscita dall'arena (MORTE) ---
            // Controlliamo DOPO le piattaforme così una piattaforma edge non causa morte ingiusta.
            const isOutOfBounds =
                p.x < MAP_LIMIT_LEFT   ||
                p.x > MAP_LIMIT_RIGHT  ||
                p.y < MAP_LIMIT_TOP    ||
                p.y > MAP_LIMIT_BOTTOM;

            if (isOutOfBounds === true) {
                // Scala la vita e avvia il timer di respawn
                p.lives = p.lives - 1;
                p.isDead = true;
                p.respawnTimer = RESPAWN_TIME;

                // Mostra il messaggio di kill per KILL_MSG_DURATION secondi
                this.killMessage = "GIOCATORE " + colorName(p.color) + " KO!";
                this.killTimer   = KILL_MSG_DURATION;

                // Controlla se la partita è finita (vite a zero)
                if (p.lives <= 0) {
                    if (this.gameOver === false) {
                        this.gameOver = true;
                        // Troviamo l'avversario per dichiararlo vincitore
                        Object.keys(this.players).forEach(otherId => {
                            if (otherId !== id) {
                                const winner = this.players[otherId];
                                this.winnerMessage = "GIOCATORE " + colorName(winner.color) + " VINCE!";
                            }
                        });
                    }
                }
            }
        });

        // --- C. LOGICA COMBATTIMENTO ---
        // Separato dalla fisica per chiarezza.
        // Solo i giocatori vivi possono attaccare.
        Object.keys(this.players).forEach(id => {
            const p = this.players[id];

            if (p.isDead === true) {
                return;
            }

            if (p.isAttacking === false) {
                return;
            }

            // Se ha già colpito in questo press, non colpisce di nuovo
            if (p.hasHit === true) {
                return;
            }

            // Calcola la hitbox dell'attacco
            const attackY = p.y + ATTACK_Y_OFFSET;
            let attackX   = 0;

            if (p.facingRight === true) {
                attackX = p.x + p.w;
            } else {
                attackX = p.x - ATTACK_W;
            }

            // Controlla collisione con tutti gli altri giocatori
            Object.keys(this.players).forEach(victimId => {
                const victim = this.players[victimId];

                if (victimId === id) {
                    return;
                }

                if (victim.isDead === true) {
                    return;
                }

                // AABB tra hitbox attacco e corpo vittima
                const hitX = (attackX < victim.x + victim.w) && (attackX + ATTACK_W > victim.x);
                const hitY = (attackY < victim.y + victim.h) && (attackY + ATTACK_H > victim.y);

                if (hitX === false) {
                    return;
                }

                if (hitY === false) {
                    return;
                }

                // --- Colpito! ---
                p.hasHit = true;

                // Incrementa il danno della vittima
                victim.damage = victim.damage + DAMAGE_PER_HIT;

                // Calcola il moltiplicatore dello sbalzo basato sul danno accumulato.
                // Formula: più danno hai, più voli lontano. Cap per evitare valori assurdi.
                let multiplier = 1 + (victim.damage / KNOCKBACK_SCALING);
                if (multiplier > KNOCKBACK_CAP) {
                    multiplier = KNOCKBACK_CAP;
                }

                // Sbalzo orizzontale: direzione determinata da dove guarda l'attaccante
                let finalVx = BASE_KNOCKBACK_X * multiplier;

                if (p.facingRight === true) {
                    victim.vx = finalVx;
                } else {
                    victim.vx = -finalVx;
                }

                // Sbalzo verticale: proporzionale a quello orizzontale, sempre verso l'alto.
                // Così il colpo manda principalmente di lato, con una componente verticale
                // che cresce insieme allo sbalzo orizzontale ma non lo supera mai.
                victim.vy = -(finalVx * KNOCKBACK_Y_RATIO);

                // La vittima perde il contatto col suolo e i salti rimanenti
                victim.isOnGround = false;
                victim.jumpsLeft  = 0;
            });
        });

        // Inviamo lo stato aggiornato a tutti i client
        return [{ payload: { players: this.players, winnerMessage: this.winnerMessage, killMessage: this.killMessage } }];
    }

    isFinished(): boolean {
        return this.gameOver;
    }
}

// ==========================================
// 4. IL CLIENT (Grafica e Input)
// ==========================================
export class BrawlClient extends GameClient {
    private players: any = null;
    private winnerMessage: string = "";
    private killMessage: string = "";

    // Stato corrente dei tasti premuti
    private keys: Record<string, boolean> = {
        A:     false,
        D:     false,
        W:     false,
        SPACE: false
    };

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);

        // Registriamo i listener una sola volta nel costruttore
        window.addEventListener('keydown', (e) => {
            if (e.code === 'KeyA')   { this.keys.A     = true; }
            if (e.code === 'KeyD')   { this.keys.D     = true; }
            if (e.code === 'KeyW')   { this.keys.W     = true; }
            if (e.code === 'Space')  { this.keys.SPACE = true; }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'KeyA')   { this.keys.A     = false; }
            if (e.code === 'KeyD')   { this.keys.D     = false; }
            if (e.code === 'KeyW')   { this.keys.W     = false; }
            if (e.code === 'Space')  { this.keys.SPACE = false; }
        });
    }

    async init(players: any): Promise<void> {
        return Promise.resolve();
    }

    // Ricezione dei dati dal server
    handleMessage(message: any): void {
        // Il framework potrebbe wrappare i dati dentro "payload" oppure no.
        // Gestiamo entrambi i casi.
        if (message.payload !== undefined) {
            if (message.payload.players !== undefined) {
                this.players = message.payload.players;
            }
            if (message.payload.winnerMessage !== undefined) {
                this.winnerMessage = message.payload.winnerMessage;
            }
            if (message.payload.killMessage !== undefined) {
                this.killMessage = message.payload.killMessage;
            }
        } else {
            if (message.players !== undefined) {
                this.players = message.players;
            }
            if (message.winnerMessage !== undefined) {
                this.winnerMessage = message.winnerMessage;
            }
            if (message.killMessage !== undefined) {
                this.killMessage = message.killMessage;
            }
        }
    }

    // Invia l'input del giocatore al server ogni frame
    flushMessages(): any[] {
        return [{
            kind: 'input',
            keys: {
                A:     this.keys.A,
                D:     this.keys.D,
                W:     this.keys.W,
                SPACE: this.keys.SPACE
            }
        }];
    }

    // ----------------------------------------
    // DRAW: rendering di tutto il frame
    // ----------------------------------------
    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        // Se non abbiamo ancora ricevuto dati dal server, non disegniamo nulla
        if (this.players === null) {
            return;
        }

        const { screenW, screenH } = this.userInput;

        // --- Sfondo ---
        ctx.fillStyle = "#87CEEB";
        ctx.fillRect(0, 0, screenW, screenH);

        // --- Trasformazione camera ---
        // Scala e centra il mondo virtuale sullo schermo reale.
        ctx.save();
        const scaleX  = screenW / VIRTUAL_W;
        const scaleY  = screenH / VIRTUAL_H;
        const scale   = Math.min(scaleX, scaleY);
        const offsetX = (screenW - VIRTUAL_W * scale) / 2;
        const offsetY = (screenH - VIRTUAL_H * scale) / 2;
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        // --- Piattaforme ---
        PLATFORMS.forEach(plat => {
            if (plat.isSolid === true) {
                ctx.fillStyle = "#5a5a5a";
            } else {
                ctx.fillStyle = "#2E8B57";
            }
            ctx.fillRect(plat.x, plat.y, plat.w, plat.h);

            ctx.strokeStyle = "#000000";
            ctx.lineWidth   = 2;
            ctx.strokeRect(plat.x, plat.y, plat.w, plat.h);
        });

        // --- Giocatori ---
        Object.keys(this.players).forEach(id => {
            const p = this.players[id];

            // I giocatori morti non si disegnano (sono in respawn)
            if (p.isDead === true) {
                return;
            }

            // Corpo del personaggio
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, p.w, p.h);

            // Contorno per visibilità
            ctx.strokeStyle = "rgba(0,0,0,0.6)";
            ctx.lineWidth   = 2;
            ctx.strokeRect(p.x, p.y, p.w, p.h);

            // Percentuale danno sopra il personaggio
            ctx.fillStyle   = "white";
            ctx.font        = "bold 16px Arial";
            ctx.textAlign   = "center";
            ctx.fillText(p.damage + "%", p.x + (p.w / 2), p.y - 8);

            // Hitbox attacco visiva (quadrato giallo)
            if (p.isAttacking === true) {
                ctx.fillStyle = "rgba(255, 220, 0, 0.85)";

                if (p.facingRight === true) {
                    ctx.fillRect(p.x + p.w, p.y + ATTACK_Y_OFFSET, ATTACK_W, ATTACK_H);
                } else {
                    ctx.fillRect(p.x - ATTACK_W, p.y + ATTACK_Y_OFFSET, ATTACK_W, ATTACK_H);
                }
            }
        });

        // Ripristina la trasformazione camera prima di disegnare l'HUD
        ctx.restore();

        // --- HUD in alto ---
        // Disegnato in coordinate schermo (fuori dalla camera scalata)
        this.drawHUD(ctx, screenW, screenH);

        // --- Messaggio di kill temporaneo ---
        // Appare al centro-alto quando qualcuno esce dall'arena, poi scompare
        if (this.killMessage !== "") {
            ctx.fillStyle = "#FF4400";
            ctx.font      = "bold 22px Arial";
            ctx.textAlign = "center";
            ctx.fillText(this.killMessage, screenW / 2, screenH / 2 - 20);
        }

        // --- Messaggio di vittoria finale ---
        // Senza sfondo: testo semplice sopra tutto
        if (this.winnerMessage !== "") {
            ctx.fillStyle = "#FFD700";
            ctx.font      = "bold 40px Arial";
            ctx.textAlign = "center";
            ctx.fillText(this.winnerMessage, screenW / 2, screenH / 2);
        }
    }

    // ----------------------------------------
    // DRAW HUD: pannelli in alto con vite e danno
    // ----------------------------------------
    private drawHUD(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        const playerIds = Object.keys(this.players);

        playerIds.forEach((id, index) => {
            const p = this.players[id];

            // Pannello sinistro per il giocatore 0, destro per il giocatore 1
            let hudX = 20;
            if (index === 1) {
                hudX = screenW - 160;
            }
            const hudY = 10;

            // Sfondo pannello
            ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
            ctx.fillRect(hudX, hudY, 140, 55);

            // Bordo colorato del giocatore
            ctx.strokeStyle = p.color;
            ctx.lineWidth   = 3;
            ctx.strokeRect(hudX, hudY, 140, 55);

            // Riga 1: nome colore e stato
            ctx.fillStyle = "white";
            ctx.font      = "bold 13px Arial";
            ctx.textAlign = "left";

            if (p.isDead === true) {
                ctx.fillStyle = "#aaaaaa";
                ctx.fillText("RESPAWN...", hudX + 8, hudY + 19);
            } else {
                ctx.fillStyle = "white";
                ctx.fillText("DANNO: " + p.damage + "%", hudX + 8, hudY + 19);
            }

            // Riga 2: vite rimanenti come numero
            ctx.fillStyle = p.color;
            ctx.font      = "bold 13px Arial";
            ctx.fillText("VITE: " + p.lives + " / " + MAX_LIVES, hudX + 8, hudY + 41);
        });
    }

    isFinished(): boolean {
        return false;
    }
}