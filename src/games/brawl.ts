// importiamo le classi base del framework del professore
// GameServer e GameClient sono le classi da cui eredita il nostro gioco
import { GameClient, GameServer } from './game';
import { IncomingMsg, OutgoingMsg } from '../server';
import { UserInput } from '../client/user-input';

// ==========================================
// 1. COSTANTI
// ==========================================

// dimensioni "virtuali" del campo di gioco — il client le scala poi allo schermo reale
const VIRTUAL_W = 1000;
const VIRTUAL_H = 600;

// --- Fisica ---
const GRAVITY         = 1400;  // accelerazione verso il basso, in px/s²
const JUMP_FORCE      = 620;   // velocità verticale applicata ad ogni salto (negativa = su)
const MOVE_SPEED      = 360;   // velocità massima orizzontale a terra, in px/s
const MAX_FALL_SPEED  = 1200;  // limite alla velocità di caduta, per evitare che passi attraverso le piattaforme
const FRICTION_GROUND = 22;    // moltiplicatore frizione a terra — quasi stop istantaneo
const FRICTION_AIR    = 5;     // moltiplicatore frizione in aria — decelerazione lenta
const AIR_ACCEL       = 900;   // accelerazione laterale in aria, in px/s² — per il controllo aereo

// --- Limiti dell'arena ---
// se il player esce da questi bordi, muore
const MAP_LIMIT_LEFT   = -150;
const MAP_LIMIT_RIGHT  = 1150;
const MAP_LIMIT_TOP    = -500;
const MAP_LIMIT_BOTTOM = 800;

// --- Combattimento ---
const DAMAGE_PER_HIT   = 10;   // danno base per ogni colpo ricevuto
const BASE_KNOCKBACK_X = 540;  // sbalzo orizzontale base in px/s
const BASE_KNOCKBACK_Y = 130;  // sbalzo verticale base in px/s (poi moltiplicato)
const KNOCKBACK_SCALE  = 50;   // ogni 50% di danno accumulato il moltiplicatore sale di 1
const KNOCKBACK_CAP    = 100;  // tetto massimo del moltiplicatore knockback
const HITSTUN_DURATION = 0.18; // secondi di blocco controlli dopo aver ricevuto un colpo
const ATTACK_COOLDOWN  = 0.45; // secondi di pausa obbligatoria tra un attacco e il successivo

// --- Hitbox dell'attacco (la "lingua") ---
const ATTACK_W_BASE   = 48;   // larghezza base della hitbox
const ATTACK_H        = 14;   // altezza della hitbox
const ATTACK_Y_OFFSET = 22;   // quanto scende verticalmente rispetto alla cima del player

// --- Vite e rispawn ---
const MAX_LIVES         = 3;   // vite con cui si inizia la partita
const RESPAWN_TIME      = 2.0; // secondi di attesa prima di tornare in campo
const KILL_MSG_DURATION = 2.5; // secondi per cui rimane visibile il messaggio "KO"

// --- Power up ---
const POWERUP_SPAWN_INTERVAL = 8.0;  // ogni quanti secondi può spawnare un nuovo powerup
const POWERUP_MAX_ON_MAP     = 2;    // massimo di powerup presenti contemporaneamente in campo
const POWERUP_DURATION       = 20.0; // secondi di durata del powerup sul player
const POWERUP_RADIUS         = 36;   // distanza in px entro cui il player raccoglie un powerup

// --- Easter egg: Demone del 67 ---
const DEMON_SCALE    = 6;              // di quanto si ingrandisce il player che evoca il demone
const DEMON_DURATION = 20.0;          // secondi di durata della trasformazione
const DEMON_CODE     = "67676767676767"; // la sequenza di tasti da premere: "67" ripetuto 7 volte

// --- Effetti dei singoli powerup ---
const PU_ATTACK_BONUS_W  = 40;  // pixel extra di portata per il powerup attacco
const PU_HEAL_AMOUNT     = 25;  // punti di danno che vengono curati dal powerup cura
const PU_FORCE_DMG_BONUS = 10;  // danno extra per colpo con powerup forza
const PU_FORCE_KB_BONUS  = 80;  // px/s extra di knockback con powerup forza

// ==========================================
// INTERFACCE
// ==========================================

// descrive una piattaforma — isSolid=true significa che blocca anche dal basso
// le proprietà opzionali (speed, xMin, xMax, dir) servono solo per le piattaforme mobili
interface Platform {
    x: number;
    y: number;
    w: number;
    h: number;
    isSolid: boolean;
    speed?: number; // px/s di movimento orizzontale
    xMin?:  number; // limite sinistro dell'oscillazione
    xMax?:  number; // limite destro dell'oscillazione
    dir?:   number; // direzione attuale: 1 = destra, -1 = sinistra
}

// i tre tipi di powerup disponibili
type PowerUpType = "attack" | "heal" | "force";

// un powerup sulla mappa: posizione, tipo, e se è ancora raccoglibile
interface PowerUp {
    x:      number;
    y:      number;
    type:   PowerUpType;
    active: boolean; // diventa false quando viene raccolto
}

// lo stato completo di un player — viene sincronizzato dal server al client ogni tick
interface PlayerState {
    x: number; // posizione orizzontale (angolo in alto a sinistra del corpo)
    y: number; // posizione verticale
    w: number; // larghezza corrente (può variare con l'easter egg)
    h: number; // altezza corrente
    baseW: number; // larghezza originale — usata per ripristinare dopo il demone
    baseH: number; // altezza originale

    vx: number; // velocità orizzontale in px/s
    vy: number; // velocità verticale in px/s (positiva = scende)

    color: string; // colore hex del player

    facingRight:       boolean; // true se guarda a destra
    isOnGround:        boolean; // true se i piedi toccano una piattaforma
    jumpsLeft:         number;  // salti rimanenti (parte da 2, doppio salto)
    jumpKeyWasPressed: boolean; // serve per evitare che tenere W faccia saltare in loop

    isAttacking:    boolean; // true mentre SPACE è premuto e il cooldown era a 0
    hasHit:         boolean; // true se questo attacco ha già colpito qualcuno
    hitstun:        number;  // secondi rimasti di blocco controlli dopo un colpo
    attackCooldown: number;  // secondi rimasti prima di poter attaccare di nuovo

    damage:       number;  // percentuale di danno accumulata — più è alta, più si vola lontano
    lives:        number;  // vite rimaste — a 0 diventa spettatore
    isDead:       boolean; // true quando è in respawn oppure eliminato
    respawnTimer: number;  // secondi rimasti prima di tornare in campo
    spawnIndex:   number;  // indice della posizione di spawn (0=P1, 1=P2, 2=P3, 3=P4)

    activePowerUp: PowerUpType | null; // powerup attivo in questo momento, null se nessuno
    powerUpTimer:  number;             // secondi rimasti al powerup attivo
    demonTimer:    number;             // secondi rimasti alla trasformazione demone (0 = normale)
}

// ==========================================
// MAPPA
// ==========================================

// lista di tutte le piattaforme — l'ultima è la mobile
const PLATFORMS: Platform[] = [
    { x: 100, y: 450, w: 800, h: 35, isSolid: true },   // pavimento principale, solido su tutti i lati
    { x: 60,  y: 340, w: 120, h: 15, isSolid: false },  // piattaforma laterale sinistra bassa
    { x: 820, y: 340, w: 120, h: 15, isSolid: false },  // piattaforma laterale destra bassa
    { x: 210, y: 290, w: 140, h: 15, isSolid: false },  // piattaforma media sinistra
    { x: 650, y: 290, w: 140, h: 15, isSolid: false },  // piattaforma media destra
    { x: 420, y: 170, w: 160, h: 15, isSolid: false },  // piattaforma centrale alta
    { x: 120, y: 200, w: 110, h: 15, isSolid: false },  // piattaforma alta sinistra
    { x: 770, y: 200, w: 110, h: 15, isSolid: false },  // piattaforma alta destra
    { x: 390, y: 330, w: 130, h: 15, isSolid: false, speed: 90, xMin: 280, xMax: 590, dir: 1 } // mobile
];

// posizioni valide dove possono spawnare i powerup, tutte sopra le piattaforme
const POWERUP_SPAWN_SLOTS = [
    { x: 170, y: 320 }, { x: 870, y: 320 },
    { x: 280, y: 270 }, { x: 720, y: 270 },
    { x: 500, y: 150 }, { x: 175, y: 180 },
    { x: 825, y: 180 }, { x: 500, y: 430 }
];

// posizioni di spawn dei player all'inizio della partita o dopo un rispawn
const SPAWN_POSITIONS = [
    { x: 220, y: 360 }, // P1 sinistra bassa
    { x: 680, y: 360 }, // P2 destra bassa
    { x: 235, y: 180 }, // P3 sinistra alta
    { x: 700, y: 180 }  // P4 destra alta
];

// ==========================================
// 2. FUNZIONI DI SUPPORTO
// ==========================================

// rimette un player alla sua posizione di spawn e azzera tutti gli stati di movimento
// non tocca vite e danno — quello lo fa chi chiama questa funzione
function spawnPlayer(p: PlayerState): void {
    const spawn        = SPAWN_POSITIONS[p.spawnIndex]; // prendo la spawn giusta in base all'indice
    p.x                = spawn.x;
    p.y                = spawn.y;
    p.vx               = 0;
    p.vy               = 0;
    p.isOnGround       = false;
    p.jumpsLeft        = 2;           // due salti disponibili (doppio salto)
    p.jumpKeyWasPressed = false;
    p.isAttacking      = false;
    p.hasHit           = false;
    p.hitstun          = 0;
    p.attackCooldown   = 0;
    p.isDead           = false;
    p.respawnTimer     = 0;
}

// traduce il codice colore hex nel nome leggibile del giocatore
function colorName(color: string): string {
    if (color === "#ff0000") { return "ROSSO"; }
    if (color === "#0000ff") { return "BLU"; }
    if (color === "#00cc44") { return "VERDE"; }
    return "GIALLO";
}

// sceglie casualmente uno dei tre tipi di powerup con probabilità uguale
function randomPowerUpType(): PowerUpType {
    const r = Math.random();
    if (r < 0.33) { return "attack"; }
    if (r < 0.66) { return "heal"; }
    return "force";
}

// restituisce il colore visivo associato a un tipo di powerup
function powerUpColor(type: PowerUpType): string {
    if (type === "attack") { return "#00ccff"; } // blu elettrico
    if (type === "heal")   { return "#44ff88"; } // verde
    return "#ff8800";                            // arancione
}

// restituisce il nome da mostrare nell'HUD quando il player ha un powerup attivo
function powerUpLabel(type: PowerUpType): string {
    if (type === "attack") { return "PORTATA"; }
    if (type === "heal")   { return "CURA"; }
    return "FORZA";
}

// icone brevi da mostrare sul cerchio del powerup in campo
const POWERUP_ICONS: Record<PowerUpType, string> = { attack: "+A", heal: "+H", force: "+F" };

// ==========================================
// 3. IL SERVER
// ==========================================

// BrawlServer gestisce tutta la fisica, il combattimento e lo stato del gioco
// gira solo lato server — il client non lo vede direttamente
export class BrawlServer extends GameServer {
    private players:       Record<string, PlayerState> = {}; // tutti i player indicizzati per id
    private winnerMessage: string  = ""; // messaggio finale quando qualcuno vince
    private gameOver:      boolean = false; // true quando la partita è finita
    private killMessage:   string  = ""; // messaggio temporaneo tipo "GIOCATORE ROSSO KO!"
    private killTimer:     number  = 0;  // secondi rimasti prima che killMessage scompaia
    private powerUps:      PowerUp[] = []; // powerup attualmente in campo
    private powerUpTimer:  number    = POWERUP_SPAWN_INTERVAL; // countdown al prossimo spawn
    private powerUpNextId: number    = 0; // contatore per id univoci (non usato nel payload)
    private finishTimer:   number    = 0;     // secondi rimasti prima di chiudere il gioco
    private shouldClose:   boolean   = false; // diventa true quando il timer è scaduto
    private demonUsed:     boolean   = false; // impedisce di evocare il demone due volte
    private demonMessage:  string    = ""; // scritta viola mostrata quando scatta l'easter egg
    private demonTimer:    number    = 0;  // secondi rimasti alla trasformazione demone
    private demonPlayerId: string    = ""; // id del player che ha evocato il demone

    // init viene chiamato una sola volta dal framework quando la partita inizia
    // players è il dizionario id → Player che arriva dalla lobby
    init(players: any): void {
        this.players = players;
        const colors = ["#ff0000", "#0000ff", "#00cc44", "#ffcc00"]; // un colore per player
        let i = 0;

        Object.keys(this.players).forEach(id => {
            const p = this.players[id] as PlayerState;

            // dimensioni del corpo
            p.w             = 38;
            p.h             = 42;
            p.baseW         = 38; // salvo le dimensioni base per ripristinarle dopo il demone
            p.baseH         = 42;
            p.color         = colors[i]; // ogni player ha un colore diverso
            p.spawnIndex    = i;
            p.lives         = MAX_LIVES;
            p.damage        = 0;
            p.isDead        = false;
            p.respawnTimer  = 0;
            p.activePowerUp = null;
            p.powerUpTimer  = 0;
            p.demonTimer    = 0;
            p.attackCooldown = 0;

            spawnPlayer(p); // posiziono il player alla sua spawn

            // P1 e P3 guardano a destra verso il centro, P2 e P4 a sinistra
            p.facingRight = (i === 0 || i === 2);
            i++;
        });
    }

    // tick viene chiamato dal framework ogni frame
    // incomingMessages = input dei player arrivati in questo frame
    // dt = tempo passato dall'ultimo tick in secondi
    // ritorna i messaggi da mandare ai client (lo stato aggiornato)
    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {

        // --- aggiorno la posizione delle piattaforme mobili ---
        PLATFORMS.forEach(plat => {
            if (plat.speed === undefined) { return; } // salto le piattaforme statiche

            // sposto la piattaforma nella direzione corrente
            plat.x = plat.x + (plat.speed * plat.dir! * dt);

            // quando tocca un limite, inverto la direzione
            if (plat.x >= plat.xMax!) { plat.x = plat.xMax!; plat.dir = -1; }
            if (plat.x <= plat.xMin!) { plat.x = plat.xMin!; plat.dir = 1;  }
        });

        // --- conto il tempo rimasto al messaggio "KO" ---
        if (this.killTimer > 0) {
            this.killTimer = this.killTimer - dt;
            // quando scade azzero anche il testo
            if (this.killTimer <= 0) { this.killMessage = ""; this.killTimer = 0; }
        }

        // --- gestisco il timer della trasformazione demone ---
        if (this.demonTimer > 0) {
            this.demonTimer = this.demonTimer - dt;
            if (this.demonTimer <= 0) {
                // timer scaduto: ripristino le dimensioni originali del player
                this.demonTimer   = 0;
                this.demonMessage = "";
                const demon = this.players[this.demonPlayerId];
                if (demon) {
                    const oldBottom  = demon.y + demon.h; // salvo la posizione dei piedi
                    demon.w          = demon.baseW;        // ripristino larghezza originale
                    demon.h          = demon.baseH;        // ripristino altezza originale
                    demon.y          = oldBottom - demon.h; // i piedi restano fermi
                    demon.demonTimer = 0;
                }
            }
        }

        // --- spawn powerup ---
        // conto quanti powerup sono ancora attivi in campo
        const onMap = this.powerUps.filter(pu => pu.active).length;

        if (onMap < POWERUP_MAX_ON_MAP) {
            this.powerUpTimer = this.powerUpTimer - dt;
            if (this.powerUpTimer <= 0) {
                // ricarico il timer e spawno un nuovo powerup in uno slot casuale
                this.powerUpTimer = POWERUP_SPAWN_INTERVAL;
                const slot = POWERUP_SPAWN_SLOTS[Math.floor(Math.random() * POWERUP_SPAWN_SLOTS.length)];
                this.powerUps.push({ x: slot.x, y: slot.y, type: randomPowerUpType(), active: true });
            }
        }

        // rimuovo i powerup già raccolti dalla lista
        this.powerUps = this.powerUps.filter(pu => pu.active);

        // ==============================
        // A. LETTURA INPUT DAI CLIENT
        // ==============================
        incomingMessages.forEach(msg => {
            const p    = this.players[msg.clientId]; // player che ha mandato questo messaggio
            const keys = msg.payload.keys;           // tasti premuti in questo frame

            // --- easter egg: Demone del 67 ---
            // il client manda demonCode=true quando ha digitato la sequenza giusta
            // lo evochiamo solo se non è già stato evocato e il player è vivo
            if (msg.payload.demonCode && !this.demonUsed && p && !p.isDead) {
                this.demonUsed     = true;
                this.demonMessage  = "AVETE EVOCATO IL DEMONE DEL 67, SCAPPATE";
                this.demonTimer    = DEMON_DURATION;
                this.demonPlayerId = msg.clientId;

                // ingrandisco il player mantenendo i piedi fermi
                const oldBottom = p.y + p.h;
                p.w          = p.baseW * DEMON_SCALE;
                p.h          = p.baseH * DEMON_SCALE;
                p.y          = oldBottom - p.h; // i piedi restano dove erano
                p.demonTimer = DEMON_DURATION;
            }

            // se il player non esiste, è morto o in hitstun, ignoro il suo input
            if (!p || p.isDead || p.hitstun > 0) { return; }

            // --- movimento orizzontale ---
            if (keys.A) {
                p.facingRight = false;
                if (p.isOnGround) {
                    p.vx = -MOVE_SPEED; // a terra: velocità istantanea
                } else {
                    // in aria: accelero gradualmente, ma non supero MOVE_SPEED
                    p.vx = p.vx - (AIR_ACCEL * dt);
                    if (p.vx < -MOVE_SPEED) { p.vx = -MOVE_SPEED; }
                }
            } else if (keys.D) {
                p.facingRight = true;
                if (p.isOnGround) {
                    p.vx = MOVE_SPEED;
                } else {
                    p.vx = p.vx + (AIR_ACCEL * dt);
                    if (p.vx > MOVE_SPEED) { p.vx = MOVE_SPEED; }
                }
            }

            // --- salto doppio ---
            // jumpKeyWasPressed evita che tenere W premuto faccia saltare in loop
            if (keys.W) {
                if (!p.jumpKeyWasPressed && p.jumpsLeft > 0) {
                    p.vy         = -JUMP_FORCE; // velocità verso l'alto
                    p.jumpsLeft  = p.jumpsLeft - 1; // scala i salti disponibili
                    p.isOnGround = false;
                }
                p.jumpKeyWasPressed = true;
            } else {
                p.jumpKeyWasPressed = false; // resetto quando il tasto viene rilasciato
            }

            // --- attacco con cooldown ---
            if (keys.SPACE) {
                // attacco solo se il cooldown è finito e non stavo già attaccando
                if (p.attackCooldown <= 0 && !p.isAttacking) {
                    p.hasHit      = false; // permetto di colpire di nuovo
                    p.isAttacking = true;
                }
            } else {
                // quando rilascio SPACE, avvio il cooldown se stavo attaccando
                if (p.isAttacking) { p.attackCooldown = ATTACK_COOLDOWN; }
                p.isAttacking = false;
            }
        });

        // ==============================
        // B. FISICA E COLLISIONI
        // ==============================
        Object.keys(this.players).forEach(id => {
            const p = this.players[id];

            // --- gestione rispawn o modalità spettatore ---
            if (p.isDead) {
                if (p.lives <= 0) { return; } // senza vite rimane spettatore, non rispawna

                // conto il tempo di attesa
                p.respawnTimer = p.respawnTimer - dt;
                if (p.respawnTimer <= 0) {
                    // timer finito: riporto il player in campo
                    spawnPlayer(p);
                    p.damage        = 0;    // al rispawn il danno riparte da zero
                    p.activePowerUp = null; // il powerup si perde
                    p.powerUpTimer  = 0;
                }
                return; // non applico la fisica mentre è morto
            }

            // --- aggiorno i timer del player ---
            if (p.hitstun > 0)        { p.hitstun        = Math.max(0, p.hitstun - dt); }
            if (p.attackCooldown > 0) { p.attackCooldown = Math.max(0, p.attackCooldown - dt); }
            if (p.activePowerUp !== null) {
                p.powerUpTimer = p.powerUpTimer - dt;
                // quando scade il powerup lo rimuovo
                if (p.powerUpTimer <= 0) { p.activePowerUp = null; p.powerUpTimer = 0; }
            }

            // --- gravità con cap sulla velocità di caduta ---
            p.vy = p.vy + (GRAVITY * dt);
            if (p.vy > MAX_FALL_SPEED) { p.vy = MAX_FALL_SPEED; }

            // --- frizione orizzontale ---
            // la frizione è più alta a terra per uno stop quasi istantaneo
            // in aria è bassa così lo sbalzo si sente davvero
            const fr = p.isOnGround ? FRICTION_GROUND : FRICTION_AIR;
            if (p.vx > 0) { p.vx = p.vx - (p.vx * fr * dt); if (p.vx < 1)  { p.vx = 0; } }
            if (p.vx < 0) { p.vx = p.vx - (p.vx * fr * dt); if (p.vx > -1) { p.vx = 0; } }

            // salvo la y precedente per il controllo collisioni
            const oldY = p.y;

            // applico le velocità alla posizione
            p.x = p.x + (p.vx * dt);
            p.y = p.y + (p.vy * dt);
            p.isOnGround = false; // lo rimetto a true solo se atterro su qualcosa

            // --- collisioni con le piattaforme ---
            PLATFORMS.forEach(plat => {
                // prima di tutto verifico la sovrapposizione orizzontale
                if (p.x + p.w <= plat.x || p.x >= plat.x + plat.w) { return; }

                // atterraggio dall'alto: stavo scendendo (vy >= 0),
                // il frame scorso i piedi erano sopra la piattaforma,
                // ora sono sotto il bordo superiore
                if (p.vy >= 0 && (oldY + p.h) <= (plat.y + 1) && (p.y + p.h) >= plat.y) {
                    p.y          = plat.y - p.h; // attacco i piedi alla piattaforma
                    p.vy         = 0;
                    p.jumpsLeft  = 2;             // atterrato: ripristino i due salti
                    p.isOnGround = true;

                    // se la piattaforma è mobile, trascino il player con lei
                    if (plat.speed !== undefined) { p.x = p.x + (plat.speed * plat.dir! * dt); }
                }

                // collisione col soffitto (solo piattaforme solide):
                // stavo salendo (vy < 0) e ho toccato il fondo della piattaforma
                if (plat.isSolid && p.vy < 0 && oldY >= (plat.y + plat.h - 1) && p.y <= (plat.y + plat.h)) {
                    p.y  = plat.y + plat.h; // la testa viene spinta giù
                    p.vy = 0;
                }
            });

            // --- raccolta powerup ---
            // uso il centro del player come punto di riferimento
            const px = p.x + p.w / 2;
            const py = p.y + p.h / 2;

            this.powerUps.forEach(pu => {
                if (!pu.active) { return; }

                // distanza tra il centro del player e il centro del powerup
                const dx = px - pu.x;
                const dy = py - pu.y;
                if (Math.sqrt(dx * dx + dy * dy) > POWERUP_RADIUS) { return; }

                pu.active = false; // disattivo il powerup così non può essere raccolto di nuovo

                if (pu.type === "heal") {
                    // la cura è immediata: riduce il danno accumulato
                    p.damage = Math.max(0, p.damage - PU_HEAL_AMOUNT);
                } else {
                    // gli altri due tipi si attivano come stato sul player
                    p.activePowerUp = pu.type;
                    p.powerUpTimer  = POWERUP_DURATION;
                }
            });

            // --- morte per uscita dall'arena ---
            if (p.x < MAP_LIMIT_LEFT || p.x > MAP_LIMIT_RIGHT || p.y < MAP_LIMIT_TOP || p.y > MAP_LIMIT_BOTTOM) {
                p.lives        = p.lives - 1;
                p.isDead       = true;
                p.respawnTimer = RESPAWN_TIME;

                // mostro il messaggio "KO" per qualche secondo
                this.killMessage = "GIOCATORE " + colorName(p.color) + " KO!";
                this.killTimer   = KILL_MSG_DURATION;

                if (!this.gameOver) {
                    // controllo se è rimasto un solo player con vite > 0
                    // conto tutti, incluso quello appena morto (che adesso ha già le vite aggiornate)
                    const alive = Object.keys(this.players).filter(otherId => this.players[otherId].lives > 0);
                    if (alive.length === 1) {
                        this.gameOver      = true;
                        this.winnerMessage = "GIOCATORE " + colorName(this.players[alive[0]].color) + " VINCE!";
                        this.finishTimer   = 8.0; // do 8 secondi per leggere la schermata finale
                    }
                }
            }
        });

        // ==============================
        // C. COMBATTIMENTO
        // ==============================
        Object.keys(this.players).forEach(id => {
            const p = this.players[id];

            // salto i player morti, quelli che non stanno attaccando, e chi ha già colpito
            if (p.isDead || !p.isAttacking || p.hasHit) { return; }

            // fattori di scala per adattare la hitbox alle dimensioni correnti del player
            // (serve soprattutto per il demone, che è 6x più grande)
            const sw = p.w / 38;
            const sh = p.h / 42;

            // calcolo la hitbox dell'attacco (la "lingua") in coordinate mondo
            const currentAttackW = (ATTACK_W_BASE + (p.activePowerUp === "attack" ? PU_ATTACK_BONUS_W : 0)) * sw;
            const currentAttackH = ATTACK_H * sh;
            const attackY        = p.y + ATTACK_Y_OFFSET * sh;
            // la hitbox parte dal bordo destro o sinistro del player in base alla direzione
            const attackX        = p.facingRight ? p.x + p.w : p.x - currentAttackW;

            Object.keys(this.players).forEach(victimId => {
                const victim = this.players[victimId];

                // non colpisco me stesso né player già morti
                if (victimId === id || victim.isDead) { return; }

                // AABB: verifico sovrapposizione rettangolare tra hitbox e corpo della vittima
                const hitX = attackX < victim.x + victim.w && attackX + currentAttackW > victim.x;
                const hitY = attackY < victim.y + victim.h && attackY + currentAttackH > victim.y;

                if (!hitX || !hitY) { return; } // nessun contatto

                // colpito!
                p.hasHit = true; // segno che questo attacco ha già colpito, non può farlo di nuovo

                // calcolo il danno — base + eventuale bonus forza
                const hitDamage = DAMAGE_PER_HIT + (p.activePowerUp === "force" ? PU_FORCE_DMG_BONUS : 0);
                victim.damage   = victim.damage + hitDamage;

                // il moltiplicatore knockback cresce con il danno accumulato dalla vittima
                // più ha preso botte, più vola lontano
                const mult    = Math.min(1 + victim.damage / KNOCKBACK_SCALE, KNOCKBACK_CAP);
                const finalVx = BASE_KNOCKBACK_X * mult + (p.activePowerUp === "force" ? PU_FORCE_KB_BONUS : 0);

                // applico lo sbalzo nella direzione in cui guarda chi ha colpito
                victim.vx         = p.facingRight ? finalVx : -finalVx;
                victim.vy         = -(BASE_KNOCKBACK_Y * mult); // sempre verso l'alto
                victim.hitstun    = HITSTUN_DURATION; // blocco i controlli per un attimo
                victim.isOnGround = false;
                victim.jumpsLeft  = 0; // deve atterrare prima di poter saltare
            });
        });

        // --- countdown finale ---
        // dopo il game over aspetto qualche secondo prima di chiudere il gioco server-side
        // questo dà tempo ai client di vedere la schermata finale
        if (this.gameOver && this.finishTimer > 0) {
            this.finishTimer = this.finishTimer - dt;
            if (this.finishTimer <= 0) {
                this.shouldClose = true; // il server può spegnersi
            }
        }

        // mando lo stato aggiornato a tutti i client
        return [{ payload: {
            players:       this.players,
            winnerMessage: this.winnerMessage,
            killMessage:   this.killMessage,
            demonMessage:  this.demonMessage,
            demonUsed:     this.demonUsed,
            platforms:     PLATFORMS,    // mandato anche per aggiornare la piattaforma mobile
            powerUps:      this.powerUps
        }}];
    }

    // il framework chiama questa funzione ogni tick per sapere se il gioco è finito
    // torniamo true solo quando shouldClose è true (dopo l'8 secondi dal game over)
    isFinished(): boolean {
        return this.shouldClose;
    }
}

// ==========================================
// 4. IL CLIENT
// ==========================================

// BrawlClient gestisce il rendering e l'input — gira nel browser di ogni giocatore
export class BrawlClient extends GameClient {
    private players:       any     = null;  // stato dei player ricevuto dal server
    private winnerMessage: string  = "";
    private killMessage:   string  = "";
    private demonMessage:  string  = "";    // scritta viola dell'easter egg
    private demonUsed:     boolean = false; // usato per smettere di ascoltare i tasti 6/7
    private platforms:     any[]   = PLATFORMS; // aggiornate ogni tick (per la mobile)
    private powerUps:      any[]   = [];
    private gameOver:      boolean = false; // diventa true quando si clicca "Torna alla lobby"
    private time:          number  = 0;     // accumulatore tempo, usato per le animazioni

    // tasti attualmente premuti
    private keys: Record<string, boolean> = { A: false, D: false, W: false, SPACE: false };

    // per l'easter egg: teniamo un buffer degli ultimi tasti numerici premuti
    private digitBuffer:      string  = "";    // accumula "6" e "7" man mano che vengono premuti
    private demonCodePending: boolean = false; // true = devo mandare demonCode al server

    // il costruttore riceve userInput (mouse, tastiera, dimensioni schermo) e myId (il nostro id)
    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);

        // --- listener tastiera ---
        window.addEventListener('keydown', (e) => {
            if (e.code === 'KeyA')  { this.keys.A     = true; }
            if (e.code === 'KeyD')  { this.keys.D     = true; }
            if (e.code === 'KeyW')  { this.keys.W     = true; }
            if (e.code === 'Space') { this.keys.SPACE = true; }

            // --- easter egg: sequenza "67" premuta 7 volte ---
            // accumulo i tasti 6 e 7 in un buffer e verifico se corrisponde al codice
            if (!this.demonUsed && (e.key === '6' || e.key === '7')) {
                this.digitBuffer = this.digitBuffer + e.key;
                // tengo solo gli ultimi N caratteri (lunghezza del codice)
                if (this.digitBuffer.length > DEMON_CODE.length) {
                    this.digitBuffer = this.digitBuffer.slice(-DEMON_CODE.length);
                }
                // se il buffer corrisponde al codice segreto, segnalo al server
                if (this.digitBuffer === DEMON_CODE) {
                    this.demonCodePending = true;
                    this.digitBuffer      = ""; // svuoto il buffer
                }
            } else if (e.key !== '6' && e.key !== '7') {
                // se si preme un altro tasto, la sequenza si interrompe
                this.digitBuffer = "";
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'KeyA')  { this.keys.A     = false; }
            if (e.code === 'KeyD')  { this.keys.D     = false; }
            if (e.code === 'KeyW')  { this.keys.W     = false; }
            if (e.code === 'Space') { this.keys.SPACE = false; }
        });

        // --- click sul pulsante "Torna alla lobby" ---
        // le coordinate del pulsante devono essere identiche a quelle in drawEndScreen
        window.addEventListener('click', (e) => {
            if (!this.winnerMessage) { return; } // il pulsante esiste solo a fine partita

            const { screenW, screenH } = this.userInput;
            const btnW = 200;
            const btnH = 48;
            const btnX = screenW / 2 - btnW / 2;
            const btnY = screenH / 2 + 60;

            // verifico se il click è dentro l'area del pulsante
            if (e.clientX >= btnX && e.clientX <= btnX + btnW && e.clientY >= btnY && e.clientY <= btnY + btnH) {
                this.gameOver = true; // segnala a isFinished() di restituire true
            }
        });

        // --- cursore pointer quando si passa sopra il pulsante ---
        window.addEventListener('mousemove', (e) => {
            if (!this.winnerMessage) { document.body.style.cursor = "default"; return; }

            const { screenW, screenH } = this.userInput;
            const btnW = 200;
            const btnH = 48;
            const btnX = screenW / 2 - btnW / 2;
            const btnY = screenH / 2 + 60;

            const over = e.clientX >= btnX && e.clientX <= btnX + btnW && e.clientY >= btnY && e.clientY <= btnY + btnH;
            document.body.style.cursor = over ? "pointer" : "default";
        });
    }

    // init viene chiamato dal framework prima che la partita inizi
    // non abbiamo bisogno di fare nulla qui, ma la firma deve corrispondere alla classe base
    async init(players: any): Promise<void> {
        return Promise.resolve();
    }

    // handleMessage riceve i dati mandati dal server ogni tick e aggiorna lo stato locale
    handleMessage(message: any): void {
        // il framework a volte wrappa il payload, a volte no — gestisco entrambi i casi
        const data = message.payload ?? message;

        if (data.players       !== undefined) { this.players       = data.players; }
        if (data.winnerMessage !== undefined) { this.winnerMessage = data.winnerMessage; }
        if (data.killMessage   !== undefined) { this.killMessage   = data.killMessage; }
        if (data.demonMessage  !== undefined) { this.demonMessage  = data.demonMessage; }
        if (data.demonUsed     !== undefined) { this.demonUsed     = data.demonUsed; } // smetto di ascoltare i tasti
        if (data.platforms     !== undefined) { this.platforms     = data.platforms; } // aggiorno la mobile
        if (data.powerUps      !== undefined) { this.powerUps      = data.powerUps; }
        // gameOver NON arriva dal server — lo gestisce solo il click sul pulsante
    }

    // flushMessages viene chiamato dal framework ogni frame per raccogliere i messaggi da mandare al server
    flushMessages(): any[] {
        const msg: any = { kind: 'input', keys: { A: this.keys.A, D: this.keys.D, W: this.keys.W, SPACE: this.keys.SPACE } };

        // se ho appena completato il codice demone, lo aggiungo al messaggio
        if (this.demonCodePending) {
            msg.demonCode         = true;
            this.demonCodePending = false; // mando il flag una volta sola
        }

        return [msg];
    }

    // draw viene chiamato dal framework ogni frame per disegnare tutto
    draw(ctx: CanvasRenderingContext2D, dt: number): void {
        if (!this.players) { return; } // aspetto di ricevere il primo stato dal server

        this.time = this.time + dt; // aggiorno il contatore per le animazioni

        const { screenW, screenH } = this.userInput;

        // --- sfondo con gradiente verticale scuro ---
        const grad = ctx.createLinearGradient(0, 0, 0, screenH);
        grad.addColorStop(0,   "#1a1a2e");
        grad.addColorStop(0.6, "#16213e");
        grad.addColorStop(1,   "#0f3460");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, screenW, screenH);

        // --- trasformazione camera ---
        // scala il mondo virtuale (1000x600) alle dimensioni reali dello schermo
        // mantenendo le proporzioni e centrando il campo di gioco
        ctx.save();
        const scale   = Math.min(screenW / VIRTUAL_W, screenH / VIRTUAL_H);
        const offsetX = (screenW - VIRTUAL_W * scale) / 2;
        const offsetY = (screenH - VIRTUAL_H * scale) / 2;
        ctx.translate(offsetX, offsetY); // sposto l'origine al centro
        ctx.scale(scale, scale);         // scalo tutto di conseguenza

        // disegno il mondo (piattaforme, powerup, player) nello spazio virtuale
        this.drawPlatforms(ctx);
        this.drawPowerUps(ctx);
        this.drawPlayers(ctx);

        ctx.restore(); // torno alle coordinate schermo reale per l'HUD

        // disegno l'HUD e i messaggi sopra tutto il resto
        this.drawHUD(ctx, screenW, screenH);
        this.drawMessages(ctx, screenW, screenH);
    }

    // ----------------------------------------
    // disegna tutte le piattaforme della mappa
    // ----------------------------------------
    private drawPlatforms(ctx: CanvasRenderingContext2D): void {
        this.platforms.forEach((plat: any) => {
            // ombra leggera spostata in basso a destra
            ctx.fillStyle = "rgba(0,0,0,0.3)";
            ctx.fillRect(plat.x + 4, plat.y + 6, plat.w, plat.h);

            if (plat.isSolid) {
                // pavimento: grigio scuro con bordo superiore più chiaro
                ctx.fillStyle = "#4a4a5a";
                ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
                ctx.fillStyle = "#6a6a7a";
                ctx.fillRect(plat.x, plat.y, plat.w, 6); // striscia chiara in cima
            } else if (plat.speed !== undefined) {
                // piattaforma mobile: marrone/arancione per distinguerla visivamente
                ctx.fillStyle = "#7a4a2a";
                ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
                ctx.fillStyle = "#c07840";
                ctx.fillRect(plat.x, plat.y, plat.w, 5);
            } else {
                // piattaforma normale: verde con bordo superiore brillante
                ctx.fillStyle = "#2a5a38";
                ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
                ctx.fillStyle = "#48a060";
                ctx.fillRect(plat.x, plat.y, plat.w, 5);
            }
        });
    }

    // ----------------------------------------
    // disegna i powerup presenti in campo con un effetto glow pulsante
    // ----------------------------------------
    private drawPowerUps(ctx: CanvasRenderingContext2D): void {
        this.powerUps.forEach((pu: any) => {
            if (!pu.active) { return; } // salto quelli già raccolti

            const color    = powerUpColor(pu.type as PowerUpType);
            // il glow pulsa usando il seno del tempo — dà un effetto di respirazione
            const glowSize = 22 + Math.sin(this.time * 4) * 4;
            const alpha    = Math.sin(this.time * 4) * 0.2 + 0.3;

            // alone esterno semitrasparente che pulsa
            ctx.globalAlpha = alpha;
            ctx.fillStyle   = color;
            ctx.beginPath();
            ctx.arc(pu.x, pu.y, glowSize, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1; // ripristino l'opacità piena

            // cerchio principale colorato
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(pu.x, pu.y, 14, 0, Math.PI * 2);
            ctx.fill();

            // bordo bianco per staccarlo dallo sfondo
            ctx.strokeStyle = "rgba(255,255,255,0.8)";
            ctx.lineWidth   = 2;
            ctx.beginPath();
            ctx.arc(pu.x, pu.y, 14, 0, Math.PI * 2);
            ctx.stroke();

            // icona testuale al centro (+A, +H, +F)
            ctx.fillStyle = "#fff";
            ctx.font      = "bold 11px Arial";
            ctx.textAlign = "center";
            ctx.fillText(POWERUP_ICONS[pu.type as PowerUpType], pu.x, pu.y + 4);
        });
    }

    // ----------------------------------------
    // disegna tutti i player con sprite, occhi, fascetta e lingua
    // ----------------------------------------
    private drawPlayers(ctx: CanvasRenderingContext2D): void {
        Object.keys(this.players).forEach(id => {
            const p = this.players[id];
            if (p.isDead) { return; } // i player morti (inclusi spettatori) non vengono disegnati

            const cx = p.x + p.w / 2; // centro orizzontale del player

            // fattori di scala — necessari perché il demone cambia le dimensioni del player
            // sw e sh ci permettono di scalare tutti gli offset grafici coerentemente
            const sw = p.w / 38; // quanto è più largo del normale
            const sh = p.h / 42; // quanto è più alto del normale

            // ombra ellittica sul pavimento, sempre alla stessa altezza
            ctx.fillStyle = "rgba(0,0,0,0.2)";
            ctx.beginPath();
            ctx.ellipse(cx, 455, p.w / 2, 5, 0, 0, Math.PI * 2);
            ctx.fill();

            // glow colorato attorno al player quando ha un powerup attivo
            if (p.activePowerUp !== null) {
                ctx.globalAlpha = Math.sin(this.time * 6) * 0.25 + 0.4; // pulsa
                ctx.fillStyle   = powerUpColor(p.activePowerUp as PowerUpType);
                ctx.fillRect(p.x - 5 * sw, p.y - 5 * sh, p.w + 10 * sw, p.h + 10 * sh);
                ctx.globalAlpha = 1;
            }

            // corpo principale
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, p.w, p.h);

            // highlight bianco nella parte alta per simulare il volume
            ctx.fillStyle = "rgba(255,255,255,0.20)";
            ctx.fillRect(p.x + 2 * sw, p.y + 2 * sh, p.w - 4 * sw, p.h * 0.28);

            // contorno scuro del corpo
            ctx.strokeStyle = "rgba(0,0,0,0.7)";
            ctx.lineWidth   = 2;
            ctx.strokeRect(p.x, p.y, p.w, p.h);

            // --- fascetta sportiva in testa ---
            const bandH = 8 * sh;
            ctx.fillStyle = "white";
            ctx.fillRect(p.x, p.y, p.w, bandH);         // fascia bianca
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y + 2 * sh, p.w, 4 * sh); // striscia colorata al centro
            ctx.strokeStyle = "rgba(0,0,0,0.4)";
            ctx.lineWidth   = 1;
            ctx.strokeRect(p.x, p.y, p.w, bandH);        // contorno

            // --- occhi ---
            // gli occhi stanno sul lato della faccia (dove guarda il player)
            const eyeR     = 4 * sw;  // raggio del bianco dell'occhio
            const pupilR   = 2 * sw;  // raggio della pupilla
            const eyeY     = p.y + 16 * sh;
            // l'occhio "vicino" è al bordo della faccia, quello "lontano" è più interno
            const eyeNearX = p.facingRight ? p.x + p.w - 9 * sw  : p.x + 9 * sw;
            const eyeFarX  = p.facingRight ? p.x + p.w - 22 * sw : p.x + 22 * sw;
            const pupilOff = p.facingRight ? sw : -sw; // la pupilla è spostata nella direzione di sguardo

            // bianchi degli occhi
            ctx.fillStyle = "white";
            ctx.beginPath(); ctx.arc(eyeFarX,  eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(eyeNearX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();

            // pupille
            ctx.fillStyle = "#111";
            ctx.beginPath(); ctx.arc(eyeFarX  + pupilOff, eyeY, pupilR, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(eyeNearX + pupilOff, eyeY, pupilR, 0, Math.PI * 2); ctx.fill();

            // contorno degli occhi
            ctx.strokeStyle = "rgba(0,0,0,0.35)";
            ctx.lineWidth   = 1;
            ctx.beginPath(); ctx.arc(eyeFarX,  eyeY, eyeR, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(eyeNearX, eyeY, eyeR, 0, Math.PI * 2); ctx.stroke();

            // --- lingua / attacco ---
            // compare solo quando il player sta attaccando
            if (p.isAttacking) {
                // calcolo la larghezza della lingua scalata, più eventuale bonus portata
                const currentAttackW = (ATTACK_W_BASE + (p.activePowerUp === "attack" ? PU_ATTACK_BONUS_W : 0)) * sw;
                const tongueY        = p.y + (ATTACK_Y_OFFSET + 4) * sh; // parte dalla "bocca"
                const tongueH        = ATTACK_H * sh;

                // alone rosato attorno alla lingua
                ctx.fillStyle = "rgba(255,100,100,0.25)";
                if (p.facingRight) {
                    ctx.fillRect(p.x + p.w - 2 * sw, tongueY - 3 * sh, currentAttackW + 6 * sw, tongueH + 6 * sh);
                } else {
                    ctx.fillRect(p.x - currentAttackW - 4 * sw, tongueY - 3 * sh, currentAttackW + 6 * sw, tongueH + 6 * sh);
                }

                // corpo della lingua
                ctx.fillStyle = "#ff5577";
                if (p.facingRight) {
                    ctx.fillRect(p.x + p.w, tongueY, currentAttackW, tongueH);
                } else {
                    ctx.fillRect(p.x - currentAttackW, tongueY, currentAttackW, tongueH);
                }

                // punta arrotondata della lingua usando un semicerchio
                ctx.beginPath();
                if (p.facingRight) {
                    ctx.arc(p.x + p.w + currentAttackW, tongueY + tongueH / 2, tongueH / 2, -Math.PI / 2, Math.PI / 2);
                } else {
                    ctx.arc(p.x - currentAttackW, tongueY + tongueH / 2, tongueH / 2, Math.PI / 2, -Math.PI / 2);
                }
                ctx.fill();
            }

            // --- rotellina del cooldown ---
            // appare di fianco al player quando l'attacco è in cooldown
            // si riempie man mano che il cooldown scende verso zero
            if (p.attackCooldown > 0) {
                const wheelX   = p.facingRight ? p.x + p.w + 10 * sw : p.x - 10 * sw;
                const wheelY   = p.y + p.h / 2;
                const progress = p.attackCooldown / ATTACK_COOLDOWN; // 1 = appena iniziato, 0 = quasi pronto
                // l'arco parte dall'alto (-π/2) e si estende in senso orario
                const endAngle = -Math.PI / 2 + (1 - progress) * Math.PI * 2;
                const wheelR   = 7 * sw;

                // cerchio grigio scuro di sfondo
                ctx.strokeStyle = "rgba(0,0,0,0.5)";
                ctx.lineWidth   = 3 * sw;
                ctx.beginPath(); ctx.arc(wheelX, wheelY, wheelR, 0, Math.PI * 2); ctx.stroke();

                // arco giallo che si riempie man mano che il cooldown finisce
                ctx.strokeStyle = "#ffcc00";
                ctx.beginPath(); ctx.arc(wheelX, wheelY, wheelR, -Math.PI / 2, endAngle); ctx.stroke();
            }

            // --- freccia "sei tu" ---
            // un triangolo giallo sopra il player che si controlla,
            // così si capisce subito quale personaggio giocare
            if (id === this.myId) {
                const arrowX = cx;
                const arrowY = p.y - 22 * sh;

                ctx.fillStyle = "#FFD700";
                ctx.beginPath();
                ctx.moveTo(arrowX,          arrowY);         // punta in basso
                ctx.lineTo(arrowX - 8 * sw, arrowY - 12 * sh); // angolo sinistro
                ctx.lineTo(arrowX + 8 * sw, arrowY - 12 * sh); // angolo destro
                ctx.closePath();
                ctx.fill();

                // contorno scuro per leggibilità su qualsiasi sfondo
                ctx.strokeStyle = "rgba(0,0,0,0.6)";
                ctx.lineWidth   = 1.5;
                ctx.stroke();
            }

            // --- percentuale danno sopra il player ---
            // il colore vira dal giallo-bianco verso il rosso man mano che il danno sale
            const dmgRatio = Math.min(p.damage / 150, 1);
            ctx.fillStyle  = "rgb(" + Math.round(200 + dmgRatio * 55) + ", " + Math.round(200 - dmgRatio * 180) + ", 80)";
            ctx.font       = "bold " + Math.round(14 * sw) + "px Arial";
            ctx.textAlign  = "center";
            ctx.fillText(p.damage + "%", cx, p.y - 6 * sh);
        });
    }

    // ----------------------------------------
    // HUD: 4 pannelli agli angoli + barra comandi in basso al centro
    // ----------------------------------------
    private drawHUD(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        const hudW   = 190;
        const hudH   = 72;  // altezza base — si allunga di 18px se c'è un powerup attivo
        const margin = 12;

        // un pannello per ogni angolo dello schermo: top-left, top-right, bottom-left, bottom-right
        const hudPositions = [
            { x: margin,                  y: margin },
            { x: screenW - hudW - margin, y: margin },
            { x: margin,                  y: screenH - hudH - margin - 30 },
            { x: screenW - hudW - margin, y: screenH - hudH - margin - 30 }
        ];

        const playerIds = Object.keys(this.players);

        playerIds.forEach((id, index) => {
            if (index >= 4) { return; } // massimo 4 pannelli

            const p      = this.players[id];
            const hudX   = hudPositions[index].x;
            const hudY   = hudPositions[index].y;
            const height = p.activePowerUp !== null ? hudH + 18 : hudH; // si allunga con powerup
            const isLeft = index === 0 || index === 2; // pannelli sinistri

            // sfondo scuro semitrasparente
            ctx.fillStyle = "rgba(10,10,20,0.82)";
            ctx.fillRect(hudX, hudY, hudW, height);

            // striscia colorata sul bordo interno (verso il centro schermo)
            // aiuta a distinguere i pannelli a colpo d'occhio
            ctx.fillStyle = p.color;
            ctx.fillRect(isLeft ? hudX + hudW - 3 : hudX, hudY, 3, height);

            // nome del giocatore con il suo colore
            ctx.font      = "bold 11px Arial";
            ctx.textAlign = "left";
            ctx.fillStyle = p.color;
            ctx.fillText("GIOCATORE " + colorName(p.color), hudX + 10, hudY + 16);

            // danno o stato attuale del player
            if (p.lives <= 0) {
                // niente vite rimaste: spettatore
                ctx.fillStyle = "#444";
                ctx.font      = "bold 12px Arial";
                ctx.fillText("ELIMINATO", hudX + 10, hudY + 38);
            } else if (p.isDead) {
                // morto ma con vite rimaste: sta aspettando il rispawn
                ctx.fillStyle = "#666";
                ctx.font      = "bold 12px Arial";
                ctx.fillText("RESPAWN...", hudX + 10, hudY + 38);
            } else {
                // in vita: mostro la percentuale danno con colore dinamico
                const dmgRatio = Math.min(p.damage / 150, 1);
                ctx.fillStyle  = "rgb(" + Math.round(200 + dmgRatio * 55) + ", " + Math.round(200 - dmgRatio * 180) + ", 80)";
                ctx.font       = "bold 22px Arial";
                ctx.fillText(p.damage + "%", hudX + 10, hudY + 40);
            }

            // vite rimaste come quadratini: pieni = vita, semitrasparenti = persa
            let dotX = hudX + 10;
            for (let i = 0; i < MAX_LIVES; i++) {
                ctx.fillStyle = i < p.lives ? p.color : "rgba(255,255,255,0.15)";
                ctx.fillRect(dotX, hudY + 54, 10, 10);
                dotX = dotX + 15;
            }

            // riga extra per il powerup attivo (tipo + secondi rimasti)
            if (p.activePowerUp !== null) {
                ctx.fillStyle = powerUpColor(p.activePowerUp as PowerUpType);
                ctx.font      = "bold 11px Arial";
                ctx.fillText(powerUpLabel(p.activePowerUp as PowerUpType) + "  " + Math.ceil(p.powerUpTimer) + "s", hudX + 10, hudY + 82);
            }
        });

        // la barra comandi è disegnata da una funzione separata per chiarezza
        this.drawControlsBar(ctx, screenW, screenH);
    }

    // barra in basso al centro con i comandi e la legenda dei powerup
    private drawControlsBar(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        const barW  = 420;
        const barH  = 52;
        const barX  = screenW / 2 - barW / 2; // centrata orizzontalmente
        const barY  = screenH - barH - 12;    // attaccata al fondo dello schermo

        // sfondo uguale ai pannelli HUD per coerenza visiva
        ctx.fillStyle = "rgba(10,10,20,0.82)";
        ctx.fillRect(barX, barY, barW, barH);

        // prima riga: tasti di controllo
        ctx.fillStyle   = "rgba(255,255,255,0.75)";
        ctx.font        = "bold 11px Arial";
        ctx.textAlign   = "center";
        ctx.fillText("A/D muovi   W salta (2x)   SPACE attacca", screenW / 2, barY + 16);

        // seconda riga: legenda powerup con pallino colorato + descrizione
        const puStartX = barX + 20;
        const puY      = barY + 36;
        const items: { color: string; label: string }[] = [
            { color: "#00ccff", label: "+A portata" },
            { color: "#44ff88", label: "+H cura" },
            { color: "#ff8800", label: "+F forza" }
        ];

        let dotX = puStartX;
        items.forEach(item => {
            // pallino colorato
            ctx.fillStyle = item.color;
            ctx.beginPath();
            ctx.arc(dotX + 5, puY, 5, 0, Math.PI * 2);
            ctx.fill();

            // testo descrittivo accanto al pallino
            ctx.fillStyle = "rgba(255,255,255,0.65)";
            ctx.font      = "11px Arial";
            ctx.textAlign = "left";
            ctx.fillText(item.label, dotX + 14, puY + 4);

            dotX = dotX + 130; // vado al prossimo item
        });
    }

    // ----------------------------------------
    // messaggi sovraimpressi durante il match e schermata finale
    // ----------------------------------------
    private drawMessages(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        // messaggio "KO" in arancione — visibile solo durante il match, non sulla schermata finale
        if (this.killMessage && !this.winnerMessage) {
            ctx.font      = "bold 18px Arial";
            ctx.textAlign = "center";
            // ombra scura per leggibilità su qualsiasi sfondo
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.fillText(this.killMessage, screenW / 2 + 1, 63);
            ctx.fillStyle = "#ff7733";
            ctx.fillText(this.killMessage, screenW / 2, 62);
        }

        // messaggio del demone in viola — compare quando scatta l'easter egg
        if (this.demonMessage && !this.winnerMessage) {
            ctx.font      = "bold 16px Arial";
            ctx.textAlign = "center";
            ctx.fillStyle = "rgba(0,0,0,0.7)";
            ctx.fillText(this.demonMessage, screenW / 2 + 1, 91);
            ctx.fillStyle = "#cc00ff";
            ctx.fillText(this.demonMessage, screenW / 2, 90);
        }

        // schermata finale — sovrasta tutto il resto
        if (this.winnerMessage) {
            this.drawEndScreen(ctx, screenW, screenH);
        }
    }

    // schermata di fine partita: overlay scuro, testo vittoria e pulsante per tornare alla lobby
    private drawEndScreen(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        const cx = screenW / 2;
        const cy = screenH / 2;

        // overlay semitrasparente — abbastanza scuro da leggere, abbastanza chiaro da vedere il campo
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, screenW, screenH);

        // ombra del testo vittoria
        ctx.font      = "bold 36px Arial";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillText(this.winnerMessage, cx + 2, cy - 28);
        // testo dorato sopra l'ombra
        ctx.fillStyle = "#FFD700";
        ctx.fillText(this.winnerMessage, cx, cy - 30);

        // sottotitolo
        ctx.font      = "14px Arial";
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.fillText("La partita è terminata", cx, cy - 4);

        // pulsante "Torna alla lobby"
        // IMPORTANTE: le coordinate devono essere identiche al click listener nel costruttore
        const btnW = 200;
        const btnH = 48;
        const btnX = cx - btnW / 2;
        const btnY = cy + 60;

        // sfondo blu del pulsante
        ctx.fillStyle   = "rgba(30,80,200,0.90)";
        ctx.fillRect(btnX, btnY, btnW, btnH);

        // bordo azzurro
        ctx.strokeStyle = "rgba(120,160,255,0.9)";
        ctx.lineWidth   = 1.5;
        ctx.strokeRect(btnX, btnY, btnW, btnH);

        // highlight bianco nella metà superiore per simulare il rilievo
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.fillRect(btnX, btnY, btnW, btnH / 2);

        // testo del pulsante
        ctx.fillStyle = "white";
        ctx.font      = "bold 15px Arial";
        ctx.fillText("TORNA ALLA LOBBY", cx, btnY + 30);
    }

    // il framework chiama isFinished() ogni frame per sapere se il client vuole uscire
    // diventa true quando l'utente clicca il pulsante nella schermata finale
    isFinished(): boolean {
        return this.gameOver;
    }
}