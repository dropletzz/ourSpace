/**
 * ============================================================
 * SISTEMA PERSONAGGI E ABILITÀ - ourSpace
 * ============================================================
 * Questo file contiene la logica per gestire i personaggi
 * e le loro abilità nel gioco multiplayer.
 * 
 * Il sistema è progettato per essere:
 * - Semplice da capire (codice lineare)
 * - Facile da mantenere (nessuna astrazione eccessiva)
 * - Stabile (no memory leak, no loop infiniti)
 * 
 * Ogni classe e funzione è commentata per spiegare
 * esattamente cosa fa e perché è stata scritta.
 * ============================================================
 */

// ============================================================
// PARTE 1: INTERFACCE DI BASE
// ============================================================

/**
 * Tipo che rappresenta il tipo di personaggio.
 * Ogni personaggio ha un ruolo specifico nel gioco.
 */
export type CharacterType = 
    | "brawler"    // Tank, corpo a corpo
    | "sniper"    // DPS, distanza
    | "healer"     // Supporto, cure
    | "controller"; // Area d'effetto, blocca nemici

/**
 * Interfaccia per una singola abilità.
 * Ogni abilità può essere attiva o passiva.
 */
export interface Ability {
    /** Nome dell'abilità */
    name: string;
    
    /** Descrizione breve per il giocatore */
    description: string;
    
    /** Indica se l'abilità è passiva (sempre attiva) o attiva (richiede attivazione) */
    isPassive: boolean;
    
    /** Tempo di ricarica in secondi (solo per abilità attive) */
    cooldown: number;
    
    /** Tempo rimanente prima che l'abilità possa essere usata di nuovo */
    currentCooldown: number;
    
    /** Indica se l'abilità è attualmente disponibile */
    isReady(): boolean;
    
    /** Resetta il cooldown dell'abilità */
    resetCooldown(): void;
    
    /** Diminuisce il cooldown di un certo delta (chiamato ogni tick) */
    tick(dt: number): void;
}

/**
 * Interfaccia per un personaggio completo.
 * Include statistiche, abilità e stato della ultimate.
 */
export interface Character {
    /** ID univoco del personaggio */
    id: string;
    
    /** Nome del personaggio (es. "Brawler", "Sniper", ecc.) */
    name: string;
    
    /** Tipo di personaggio */
    type: CharacterType;
    
    /** Punti vita massimi */
    maxHealth: number;
    
    /** Punti vita attuali */
    currentHealth: number;
    
    /** Danno base inflitto agli attacchi normali */
    baseDamage: number;
    
    /** Velocità di movimento (unità al secondo) */
    moveSpeed: number;
    
    /** Dimensione del personaggio (per collisioni) */
    width: number;
    height: number;
    
    /** Array delle 3 abilità attive + 1 passiva */
    abilities: Ability[];
    
    /** Percentuale di caricamento della ultimate (0-100) */
    ultimateCharge: number;
    
    /** Indica se la ultimate è pronta per essere usata */
    isUltimateReady(): boolean;
    
    /** Aggiunge caricamento alla ultimate */
    addUltimateCharge(amount: number): void;
    
    /** Resetta la ultimate (dopo averla usata) */
    resetUltimate(): void;
    
    /** Applica danno al personaggio e restituisce il danno effettivo */
    takeDamage(amount: number): number;
    
    /** Cura il personaggio e restituisce la quantità curata */
    heal(amount: number): number;
    
    /** Aggiorna tutti i cooldown delle abilità */
    tick(dt: number): void;
}

// ============================================================
// PARTE 2: IMPLEMENTAZIONE DELLE INTERFACCE
// ============================================================

/**
 * Classe che implementa un'abilità attiva o passiva.
 * Gestisce automaticamente il cooldown e lo stato di prontezza.
 * 
 * @param name - Nome dell'abilità
 * @param description - Descrizione per il giocatore
 * @param cooldown - Tempo di ricarica in secondi (0 per passive)
 * @param isPassive - Se true, l'abilità è sempre attiva
 */
export class BaseAbility implements Ability {
    name: string;
    description: string;
    isPassive: boolean;
    cooldown: number;
    currentCooldown: number;

    constructor(
        name: string,
        description: string,
        cooldown: number,
        isPassive: boolean = false
    ) {
        this.name = name;
        this.description = description;
        this.cooldown = cooldown;
        this.isPassive = isPassive;
        // Per le abilità passive, il cooldown è 0 e sono sempre pronte
        this.currentCooldown = isPassive ? 0 : 0;
    }

    /**
     * Controlla se l'abilità è pronta per essere usata.
     * Per le abilità passive, ritorna sempre true.
     * Per le attive, solo se currentCooldown è 0.
     */
    isReady(): boolean {
        if (this.isPassive) {
            return true; // Le abilità passive sono sempre pronte
        }
        return this.currentCooldown <= 0;
    }

    /**
     * Resetta il cooldown, permettendo di usare l'abilità.
     * Chiamato quando l'abilità viene usata.
     */
    resetCooldown(): void {
        this.currentCooldown = this.cooldown;
    }

    /**
     * Diminuisce il cooldown rimanente.
     * Chiamato ogni tick del gioco.
     * 
     * @param dt - Delta time in secondi (es. 0.05 per 20 tick/sec)
     */
    tick(dt: number): void {
        // Non diminuiamo il cooldown delle abilità passive
        if (this.isPassive) {
            return;
        }
        
        // Diminuiamo il cooldown rimanente
        this.currentCooldown -= dt;
        
        // Non permettiamo valori negativi
        if (this.currentCooldown < 0) {
            this.currentCooldown = 0;
        }
    }
}

/**
 * Classe base per un personaggio completo.
 * Implementa tutta la logica comune a tutti i personaggi.
 */
export abstract class BaseCharacter implements Character {
    id: string;
    name: string;
    type: CharacterType;
    maxHealth: number;
    currentHealth: number;
    baseDamage: number;
    moveSpeed: number;
    width: number;
    height: number;
    abilities: Ability[] = [];
    ultimateCharge: number = 0;

    constructor(
        id: string,
        name: string,
        type: CharacterType,
        maxHealth: number,
        baseDamage: number,
        moveSpeed: number,
        width: number,
        height: number
    ) {
        this.id = id;
        this.name = name;
        this.type = type;
        this.maxHealth = maxHealth;
        this.currentHealth = maxHealth;
        this.baseDamage = baseDamage;
        this.moveSpeed = moveSpeed;
        this.width = width;
        this.height = height;
    }

    /**
     * Controlla se la ultimate è carica al 100%.
     */
    isUltimateReady(): boolean {
        return this.ultimateCharge >= 100;
    }

    /**
     * Aggiunge caricamento alla ultimate.
     * Il caricamento è basato sui danni inflitti ai nemici.
     * 
     * @param amount - Quantità di caricamento da aggiungere (0-100)
     */
    addUltimateCharge(amount: number): void {
        this.ultimateCharge += amount;
        
        // Non superiamo il 100%
        if (this.ultimateCharge > 100) {
            this.ultimateCharge = 100;
        }
    }

    /**
     * Resetta la ultimate dopo l'uso.
     * Chiamato quando il giocatore usa la super.
     */
    resetUltimate(): void {
        this.ultimateCharge = 0;
    }

    /**
     * Applica danno al personaggio.
     * 
     * @param amount - Quantità di danno da applicare
     * @returns Il danno effettivo subito
     */
    takeDamage(amount: number): number {
        // Non permettiamo salute negativa
        const actualDamage = Math.min(amount, this.currentHealth);
        this.currentHealth -= actualDamage;
        return actualDamage;
    }

    /**
     * Cura il personaggio.
     * 
     * @param amount - Quantità di cure da applicare
     * @returns La quantità effettiva curata
     */
    heal(amount: number): number {
        // Non superiamo la salute massima
        const actualHeal = Math.min(amount, this.maxHealth - this.currentHealth);
        this.currentHealth += actualHeal;
        return actualHeal;
    }

    /**
     * Aggiorna tutti i cooldown delle abilità.
     * Chiamato ogni tick del gioco.
     * 
     * @param dt - Delta time in secondi
     */
    tick(dt: number): void {
        // Aggiorniamo il cooldown di ogni abilità
        for (const ability of this.abilities) {
            ability.tick(dt);
        }
    }

    /**
     * Metodo astratto che ogni personaggio deve implementare
     * per definire le proprie abilità specifiche.
     */
    abstract initAbilities(): void;
}

// ============================================================
// PARTE 3: COSTRUTTORE DI PERSONAGGI
// ============================================================

/**
 * Factory per creare personaggi dal tipo.
 * Permette di creare nuovi personaggi in modo centralizzato.
 * 
 * @param type - Tipo di personaggio da creare
 * @param id - ID univoco per il personaggio
 * @returns Il personaggio creato
 */
export function createCharacter(type: CharacterType, id: string): Character {
    switch (type) {
        case "brawler":
            return new BrawlerCharacter(id);
        case "sniper":
            return new SniperCharacter(id);
        case "healer":
            return new HealerCharacter(id);
        case "controller":
            return new ControllerCharacter(id);
        default:
            // Se il tipo non è riconosciuto, creiamo un Brawler di default
            return new BrawlerCharacter(id);
    }
}

// ============================================================
// PARTE 4: IMPLEMENTAZIONE DEI PERSONAGGI
// ============================================================

/**
 * BRIAR (Brawler) - Il Tank corpo a corpo
 * 
 * Caratteristiche:
 * - Alta salute (tank)
 * - Basso danno per colpo
 * - Buona difesa
 * - Abilità per stare vicino ai nemici
 * 
 * Ruolo nel team: Prima linea, absorbsione danni
 */
export class BrawlerCharacter extends BaseCharacter {
    constructor(id: string) {
        // Creiamo il Brawler con:
        // - Alta salute (500)
        // - Danno medio (15)
        // - Velocità media (150)
        // - Dimensioni grandi (50x50)
        super(
            id,
            "Briar",
            "brawler",
            500,    // maxHealth: 500 punti vita
            15,     // baseDamage: 15 danno per attacco
            150,    // moveSpeed: 150 unità/sec
            50,     // width: 50 pixel
            50      // height: 50 pixel
        );
        
        // Inizializziamo le abilità specifiche del Brawler
        this.initAbilities();
    }

    /**
     * Inizializza le 4 abilità del Brawler:
     * 1 passiva + 3 attive
     */
    initAbilities(): void {
        // --- ABILITÀ PASSIVA ---
        // "Pelle Dura": Riduce il danno ricevuto del 10%
        this.abilities.push(new BaseAbility(
            "Pelle Dura",
            "Riduce il danno ricevuto del 10%",
            0,  // Nessun cooldown per le abilità passive
            true // isPassive = true
        ));

        // --- ABILITÀ ATTIVA 1 ---
        // "Colpo Devastante": Danno alto a singolo bersaglio
        this.abilities.push(new BaseAbility(
            "Colpo Devastante",
            "Infligge 50 danno a un singolo bersaglio",
            3,  // cooldown: 3 secondi
            false // isPassive = false
        ));

        // --- ABILITÀ ATTIVA 2 ---
        // "Scudo Temporaneo": Assorbe danni per 2 secondi
        this.abilities.push(new BaseAbility(
            "Scudo Temporaneo",
            "Crea uno scudo che assorbe 100 danno per 2 secondi",
            8,  // cooldown: 8 secondi
            false // isPassive = false
        ));

        // --- ABILITÀ ATTIVA 3 ---
        // "Carica": Si lancia contro i nemici
        this.abilities.push(new BaseAbility(
            "Carica",
            "Si lancia in avanti, stordendo i nemici colpiti",
            6,  // cooldown: 6 secondi
            false // isPassive = false
        ));
    }

    /**
     * Override del metodo takeDamage per applicare la passiva.
     * La passiva "Pelle Dura" riduce il danno del 10%.
     */
    takeDamage(amount: number): number {
        // Controlliamo se la prima abilità (passiva) è attiva
        const passiveAbility = this.abilities[0];
        
        if (passiveAbility.isReady()) {
            // Appliciamo la riduzione del 10%
            amount = amount * 0.9;
        }
        
        return super.takeDamage(amount);
    }
}

/**
 * MIRA (Sniper) - Il DPS a distanza
 * 
 * Caratteristiche:
 * - Bassa salute (250) - fragile, deve evitare i danni
 * - Alto danno a distanza (25) - grande potenza di fuoco
 * - Bassa velocità (120) - non può scappare facilmente
 * - Abilità per colpire da lontano e manipolare il campo di battaglia
 * 
 * Ruolo nel team: DPS, eliminazione nemici a distanza
 */
export class SniperCharacter extends BaseCharacter {
    // Variabile per tracciare se il prossimo colpo è critico
    private nextShotCritical: boolean = false;

    constructor(id: string) {
        // Creiamo lo Sniper con:
        // - Bassa salute (250) - è fragile
        // - Alto danno (25) - compensa con danno elevato
        // - Bassa velocità (120) - lento per bilanciare
        // - Dimensioni piccole (30x30) - bersaglio difficile
        super(
            id,
            "Mira",
            "sniper",
            250,    // maxHealth: 250 punti vita (fragile)
            25,     // baseDamage: 25 danno (alto)
            120,    // moveSpeed: 120 unità/sec (lento)
            30,     // width: 30 pixel
            30      // height: 30 pixel
        );
        
        // Inizializziamo le abilità specifiche dello Sniper
        this.initAbilities();
    }

    /**
     * Inizializza le 4 abilità dello Sniper:
     * 1 passiva + 3 attive
     */
    initAbilities(): void {
        // --- ABILITÀ PASSIVA ---
        // "Occhio d'Aquila": Aumenta il danno critico del 20%
        // Lo Sniper ha una probabilità base del 10% di colpo critico
        // Questa passiva aumenta la probabilità al 30%
        this.abilities.push(new BaseAbility(
            "Occhio d'Aquila",
            "Aumenta la probabilità di colpo critico dal 10% al 30%",
            0,  // Nessun cooldown per le abilità passive
            true // isPassive = true
        ));

        // --- ABILITÀ ATTIVA 1 ---
        // "Tiro Preciso": Colpo critico garantito
        // Il prossimo attacco sarà sicuro un colpo critico
        this.abilities.push(new BaseAbility(
            "Tiro Preciso",
            "Il prossimo attacco sarà un colpo critico garantito",
            4,  // cooldown: 4 secondi
            false // isPassive = false
        ));

        // --- ABILITÀ ATTIVA 2 ---
        // "Distrazione": Riduce il danno del nemico
        // Abbassa la potenza di fuoco nemica temporaneamente
        this.abilities.push(new BaseAbility(
            "Distrazione",
            "Riduce il danno del nemico del 30% per 3 secondi",
            10,  // cooldown: 10 secondi
            false // isPassive = false
        ));

        // --- ABILITÀ ATTIVA 3 ---
        // "Bomba Fumogena": Creazione nebbia
        // Permette di scappare o reposizionarsi
        this.abilities.push(new BaseAbility(
            "Bomba Fumogena",
            "Crea una zona di nebbia per 4 secondi",
            12,  // cooldown: 12 secondi
            false // isPassive = false
        ));
    }

    /**
     * Override del metodo takeDamage per gestire la logica di gioco.
     * Gli Sniper hanno una probabilità del 30% di subire meno danno
     * grazie alla passiva "Occhio d'Aquila" (schivano i colpi).
     */
    takeDamage(amount: number): number {
        // Controlliamo se la passiva è attiva (è sempre attiva per le passive)
        const passiveAbility = this.abilities[0];
        
        if (passiveAbility.isReady()) {
            // 30% di probabilità di schivare il colpo
            if (Math.random() < 0.3) {
                // Schiviamo completamente il danno
                return 0;
            }
        }
        
        return super.takeDamage(amount);
    }

    /**
     * Metodo per usare l'abilità "Tiro Preciso".
     * Attiva il flag per il prossimo colpo critico.
     */
    activatePreciseShot(): void {
        this.nextShotCritical = true;
    }

    /**
     * Controlla se il prossimo colpo sarà critico e resetta il flag.
     */
    consumeCriticalShot(): boolean {
        const wasCritical = this.nextShotCritical;
        this.nextShotCritical = false;
        return wasCritical;
    }
}

/**
 * LUMINA (Healer) - Il Supporto
 * 
 * Caratteristiche:
 * - Salute media (300) - non è un tank ma resiste
 * - Basso danno (10) - non è un combattente diretto
 * - Buona velocità (140) - può muoversi rapidamente
 * - Abilità di supporto e cura
 * 
 * Ruolo nel team: Supporto, mantenimento in vita dei compagni
 */
export class HealerCharacter extends BaseCharacter {
    // Variabile per tracciare la cura passiva accumulata
    private passiveHealAccumulator: number = 0;

    constructor(id: string) {
        // Creiamo l'Healer con:
        // - Salute media (300) - bilanciato
        // - Basso danno (10) - non è un combattente
        // - Buona velocità (140) - può muoversi rapidamente
        // - Dimensioni medie (35x35)
        super(
            id,
            "Lumina",
            "healer",
            300,    // maxHealth: 300 punti vita
            10,     // baseDamage: 10 (basso, non è un DPS)
            140,    // moveSpeed: 140 unità/sec
            35,     // width: 35 pixel
            35      // height: 35 pixel
        );
        
        // Inizializziamo le abilità specifiche dell'Healer
        this.initAbilities();
    }

    /**
     * Inizializza le 4 abilità dell'Healer:
     * 1 passiva + 3 attive
     */
    initAbilities(): void {
        // --- ABILITÀ PASSIVA ---
        // "Aura Rigenerativa": Cura passiva ogni secondo
        // L'Healer cura automaticamente gli alleati vicini
        this.abilities.push(new BaseAbility(
            "Aura Rigenerativa",
            "Cura 5 punti vita ogni secondo a tutti gli alleati vicini",
            0,  // Nessun cooldown per le abilità passive
            true // isPassive = true
        ));

        // --- ABILITÀ ATTIVA 1 ---
        // "Cura": Cura un alleato singolo
        // Cura immediata su un bersaglio
        this.abilities.push(new BaseAbility(
            "Cura",
            "Cura un alleato di 50 punti vita",
            3,  // cooldown: 3 secondi
            false // isPassive = false
        ));

        // --- ABILITÀ ATTIVA 2 ---
        // "Barriera": Protezione temporanea
        // Assorbe danno per un breve periodo
        this.abilities.push(new BaseAbility(
            "Barriera",
            "Crea una barriera che assorbe 80 danno per 3 secondi",
            6,  // cooldown: 6 secondi
            false // isPassive = false
        ));

        // --- ABILITÀ ATTIVA 3 ---
        // "Rianimazione": Revive un alleato caduto
        // Permette di rientrare in gioco un compagno
        this.abilities.push(new BaseAbility(
            "Rianimazione",
            "Rialza un alleato sconfitto con il 50% di vita",
            15,  // cooldown: 15 secondi
            false // isPassive = false
        ));
    }

    /**
     * Override del metodo tick per gestire la cura passiva.
     * L'abilità "Aura Rigenerativa" cura 5 punti vita ogni secondo.
     */
    tick(dt: number): void {
        // Prima chiamiamo il metodo della classe base per aggiornare i cooldown
        super.tick(dt);
        
        // Accumula il tempo per la cura passiva
        this.passiveHealAccumulator += dt;
        
        // Ogni secondo, cura se stessi
        if (this.passiveHealAccumulator >= 1) {
            this.passiveHealAccumulator = 0;
            // Cura 5 punti vita ogni secondo
            this.heal(5);
        }
    }

    /**
     * Cura un alleato specifico.
     * 
     * @param target - Il personaggio da curare
     * @param amount - Quantità di cure
     * @returns La quantità effettiva curata
     */
    healAlly(target: Character, amount: number): number {
        return target.heal(amount);
    }
}

/**
 * VORTICE (Controller) - Il Controllo Area
 * 
 * Caratteristiche:
 * - Salute media (350) - bilanciato tra tank e fragile
 * - Danno medio (18) - non è il DPS principale
 * - Velocità media (130) - si muove decentemente
 * - Abilità di controllo area - rallenta, blocca, danneggia zone
 * 
 * Ruolo nel team: Controllo, supporto tattico, zone control
 */
export class ControllerCharacter extends BaseCharacter {
    // Variabile per tracciare i nemici rallentati
    private slowedEnemies: Map<string, number> = new Map();

    constructor(id: string) {
        // Creiamo il Controller con:
        // - Salute media (350) - bilanciato
        // - Danno medio (18) - non è un DPS puro
        // - Velocità media (130) - movimento normale
        // - Dimensioni medie-grandi (40x40)
        super(
            id,
            "Vortice",
            "controller",
            350,    // maxHealth: 350 punti vita
            18,     // baseDamage: 18 danno
            130,    // moveSpeed: 130 unità/sec
            40,     // width: 40 pixel
            40      // height: 40 pixel
        );
        
        // Inizializziamo le abilità specifiche del Controller
        this.initAbilities();
    }

    /**
     * Inizializza le 4 abilità del Controller:
     * 1 passiva + 3 attive
     */
    initAbilities(): void {
        // --- ABILITÀ PASSIVA ---
        // "Campo di Forza": Riduce la velocità dei nemici vicini
        // Il Controller crea un campo che rallenta chi si avvicina
        this.abilities.push(new BaseAbility(
            "Campo di Forza",
            "Riduce del 15% la velocità dei nemici entro 100 pixel",
            0,  // Nessun cooldown per le abilità passive
            true // isPassive = true
        ));

        // --- ABILITÀ ATTIVA 1 ---
        // "Gelamento": Rallentamento di area
        // Rallenta tutti i nemici in un'area
        this.abilities.push(new BaseAbility(
            "Gelamento",
            "Rallenta tutti i nemici nell'area del 50% per 3 secondi",
            5,  // cooldown: 5 secondi
            false // isPassive = false
        ));

        // --- ABILITÀ ATTIVA 2 ---
        // "Catenaccio": Immobilizzazione singola
        // Fissa un nemico sul posto temporaneamente
        this.abilities.push(new BaseAbility(
            "Catenaccio",
            "Immobilizza un nemico per 2 secondi",
            7,  // cooldown: 7 secondi
            false // isPassive = false
        ));

        // --- ABILITÀ ATTIVA 3 ---
        // "Tempesta": Danno ad area
        // Danno a tutti i nemici in un'area
        this.abilities.push(new BaseAbility(
            "Tempesta",
            "Infligge 30 danno a tutti i nemici nell'area",
            8,  // cooldown: 8 secondi
            false // isPassive = false
        ));
    }

    /**
     * Override del metodo tick per gestire gli effetti di rallentamento.
     * Rimuove i nemici dalla lista dei rallentati quando scade l'effetto.
     */
    tick(dt: number): void {
        // Prima chiamiamo il metodo della classe base per aggiornare i cooldown
        super.tick(dt);
        
        // Aggiorniamo i timer dei nemici rallentati
        const now = Date.now();
        for (const [enemyId, expireTime] of this.slowedEnemies) {
            if (now > expireTime) {
                // Il rallentamento è scaduto, rimuoviamo il nemico dalla lista
                this.slowedEnemies.delete(enemyId);
            }
        }
    }

    /**
     * Applica rallentamento a un nemico.
     * 
     * @param enemyId - ID del nemico da rallentare
     * @param duration - Durata del rallentamento in millisecondi
     */
    applySlow(enemyId: string, duration: number): void {
        this.slowedEnemies.set(enemyId, Date.now() + duration);
    }

    /**
     * Controlla se un nemico è attualmente rallentato.
     * 
     * @param enemyId - ID del nemico da controllare
     * @returns true se il nemico è rallentato
     */
    isEnemySlowed(enemyId: string): boolean {
        const expireTime = this.slowedEnemies.get(enemyId);
        if (expireTime === undefined) {
            return false;
        }
        return Date.now() < expireTime;
    }

    /**
     * Ottiene la lista dei nemici attualmente rallentati.
     * 
     * @returns Array di ID dei nemici rallentati
     */
    getSlowedEnemies(): string[] {
        return Array.from(this.slowedEnemies.keys());
    }
}

// ============================================================
// PARTE 5: SISTEMA ULTIMATE
// ============================================================

/**
 * Interfaccia per la Ultimate di un personaggio.
 * Ogni personaggio ha una super unica che si carica con i danni inflitti.
 */
export interface Ultimate {
    /** Nome della ultimate */
    name: string;
    
    /** Descrizione per il giocatore */
    description: string;
    
    /** Indica se la ultimate è attualmente attiva */
    isActive: boolean;
    
    /** Durata dell'effetto della ultimate in secondi (0 se istantanea) */
    duration: number;
    
    /** Tempo rimanente dell'effetto attivo */
    currentDuration: number;
    
    /** Attiva la ultimate e restituisce true se riuscita */
    activate(): boolean;
    
    /** Aggiorna il timer della ultimate (chiamato ogni tick) */
    tick(dt: number): void;
    
    /** Resetta la ultimate allo stato iniziale */
    reset(): void;
}

/**
 * Classe base per una ultimate.
 * Gestisce l'attivazione e il timer.
 */
export abstract class BaseUltimate implements Ultimate {
    name: string;
    description: string;
    isActive: boolean = false;
    duration: number;
    currentDuration: number = 0;

    constructor(name: string, description: string, duration: number) {
        this.name = name;
        this.description = description;
        this.duration = duration;
    }

    /**
     * Attiva la ultimate.
     * Deve essere implementato dalle classi figlie per la logica specifica.
     */
    activate(): boolean {
        this.isActive = true;
        this.currentDuration = this.duration;
        return true;
    }

    /**
     * Aggiorna il timer della ultimate.
     */
    tick(dt: number): void {
        if (this.isActive && this.currentDuration > 0) {
            this.currentDuration -= dt;
            if (this.currentDuration <= 0) {
                this.isActive = false;
                this.currentDuration = 0;
            }
        }
    }

    /**
     * Resetta la ultimate.
     */
    reset(): void {
        this.isActive = false;
        this.currentDuration = 0;
    }
}

// ============================================================
// ULTIMATE SPECIFICHE PER OGNI PERSONAGGIO
// ============================================================

/**
 * ULTIMATE DEL BRIAR (Brawler): "FURIA DEL TITANO"
 * 
 * Descrizione: Il Brawler entra in uno stato di furia che aumenta
 * drasticamente il suo danno e la sua velocità per un periodo limitato.
 * 
 * Effetto:
 * - Danno aumentato del 100% (da 15 a 30)
 * - Velocità aumentata del 50% (da 150 a 225)
 * - Invulnerabilità parziale (50% riduzione danno)
 * - Durata: 5 secondi
 */
export class BrawlerUltimate extends BaseUltimate {
    // Riferimento al personaggio per modificare le statistiche
    private character: BrawlerCharacter;
    
    // Valori originali per il restore dopo la ultimate
    private originalDamage: number;
    private originalSpeed: number;

    constructor(character: BrawlerCharacter) {
        super(
            "Furia del Titano",
            "Entra in uno stato di furia: danno x2, velocità x1.5, 50% riduzione danno per 5 secondi",
            5  // duration: 5 secondi
        );
        this.character = character;
        this.originalDamage = character.baseDamage;
        this.originalSpeed = character.moveSpeed;
    }

    /**
     * Attiva la ultimate del Brawler.
     * Raddoppia il danno e aumenta la velocità.
     */
    activate(): boolean {
        if (!this.character.isUltimateReady()) {
            return false; // Non può attivare se non è carica
        }
        
        // Attiviamo l'effetto
        super.activate();
        
        // Aumentiamo il danno del 100%
        this.character.baseDamage = this.originalDamage * 2;
        
        // Aumentiamo la velocità del 50%
        this.character.moveSpeed = this.originalSpeed * 1.5;
        
        return true;
    }

    /**
     * Override del tick per gestire la fine della ultimate.
     */
    tick(dt: number): void {
        super.tick(dt);
        
        // Quando la ultimate finisce, ripristiniamo le statistiche
        if (!this.isActive && this.currentDuration === 0 && this.character.baseDamage !== this.originalDamage) {
            this.character.baseDamage = this.originalDamage;
            this.character.moveSpeed = this.originalSpeed;
        }
    }

    /**
     * Resetta la ultimate e ripristina le statistiche.
     */
    reset(): void {
        super.reset();
        this.character.baseDamage = this.originalDamage;
        this.character.moveSpeed = this.originalSpeed;
    }
}

/**
 * ULTIMATE DELLA MIRA (Sniper): "COLPO DEL DESTINO"
 * 
 * Descrizione: Lo Sniper carica un colpo devastante che può
 * eliminare qualsiasi nemico con un singolo colpo alla testa.
 * 
 * Effetto:
 * - Prossimo colpo è un colpo critico garantito da 100 danno
 * - Non può essere schivato o bloccato
 * - Durata: 3 secondi per mirare
 */
export class SniperUltimate extends BaseUltimate {
    private character: SniperCharacter;

    constructor(character: SniperCharacter) {
        super(
            "Colpo del Destino",
            "Carica un colpo devastante: prossimo colpo causa 100 danno garantiti in 3 secondi",
            3  // duration: 3 secondi per mirare
        );
        this.character = character;
    }

    /**
     * Attiva la ultimate dello Sniper.
     */
    activate(): boolean {
        if (!this.character.isUltimateReady()) {
            return false;
        }
        
        super.activate();
        return true;
    }

    /**
     * Applica il danno della ultimate.
     * 
     * @param target - Il bersaglio
     * @returns Il danno inflitto
     */
    executeUltimate(target: Character): number {
        // 100 danno garantiti (non può essere schivato)
        return target.takeDamage(100);
    }
}

/**
 * ULTIMATE DELLA LUMINA (Healer): "RESURREZIONE DI MASSA"
 * 
 * Descrizione: L'Healer cura tutti gli alleati nella mappa
 * e rimuove tutti gli effetti negativi.
 * 
 * Effetto:
 * - Cura tutti gli alleati di 100 HP
 * - Rimuove tutti i debuff
 * - Effetto istantaneo (duration = 0)
 */
export class HealerUltimate extends BaseUltimate {
    private character: HealerCharacter;

    constructor(character: HealerCharacter) {
        super(
            "Resurrezione di Massa",
            "Cura tutti gli alleati di 100 HP e rimuove tutti i debuff",
            0  // duration: 0 (istantanea)
        );
        this.character = character;
    }

    /**
     * Attiva la ultimate dell'Healer.
     */
    activate(): boolean {
        if (!this.character.isUltimateReady()) {
            return false;
        }
        
        super.activate();
        return true;
    }

    /**
     * Esegue la ultimate su tutti gli alleati.
     * 
     * @param allies - Array degli alleati da curare
     * @returns Numero di alleati curati
     */
    executeUltimate(allies: Character[]): number {
        let healedCount = 0;
        
        for (const ally of allies) {
            // Non curiamo noi stessi (già curato dal tick)
            if (ally.id !== this.character.id) {
                const healed = this.character.healAlly(ally, 100);
                if (healed > 0) {
                    healedCount++;
                }
            }
        }
        
        return healedCount;
    }
}

/**
 * ULTIMATE DEL VORTICE (Controller): "BUCO NERO"
 * 
 * Descrizione: Il Controller crea un buco nero che attira
 * tutti i nemici verso il centro e li danneggia.
 * 
 * Effetto:
 * - Attira tutti i nemici verso il centro
 * - Danno continuo a tutti i nemici nell'area
 * - Durata: 4 secondi
 */
export class ControllerUltimate extends BaseUltimate {
    private character: ControllerCharacter;
    
    // Centro dell'effetto
    centerX: number = 0;
    centerY: number = 0;
    
    // Danno al secondo
    damagePerSecond: number = 15;

    constructor(character: ControllerCharacter) {
        super(
            "Buco Nero",
            "Crea un buco nero che attira i nemici e causa 15 danno/sec per 4 secondi",
            4  // duration: 4 secondi
        );
        this.character = character;
    }

    /**
     * Attiva la ultimate del Controller.
     * 
     * @param x - Posizione X del buco nero
     * @param y - Posizione Y del buco nero
     */
    activateAt(x: number, y: number): boolean {
        if (!this.character.isUltimateReady()) {
            return false;
        }
        
        this.centerX = x;
        this.centerY = y;
        
        super.activate();
        return true;
    }

    /**
     * Esegue il danno della ultimate.
     * 
     * @param enemies - Array dei nemici nell'area
     * @returns Danno totale inflitto
     */
    executeUltimate(enemies: Character[]): number {
        let totalDamage = 0;
        
        for (const enemy of enemies) {
            // Calcola distanza dal buco nero
            // (qui serve la logica di gioco reale)
            const damage = enemy.takeDamage(this.damagePerSecond * (this.duration / 4));
            totalDamage += damage;
        }
        
        return totalDamage;
    }
}

// ============================================================
// GESTORE ULTIMATE
// ============================================================

/**
 * Classe che gestisce la ultimate di un personaggio.
 * Tiene traccia del caricamento e gestisce l'attivazione.
 */
export class UltimateManager {
    private character: Character;
    private ultimate: Ultimate | null = null;

    constructor(character: Character) {
        this.character = character;
    }

    /**
     * Imposta la ultimate specifica per il personaggio.
     * 
     * @param ultimate - L'istanza della ultimate
     */
    setUltimate(ultimate: Ultimate): void {
        this.ultimate = ultimate;
    }

    /**
     * Controlla se la ultimate è carica.
     */
    isReady(): boolean {
        return this.character.isUltimateReady();
    }

    /**
     * Ottiene la percentuale di caricamento (0-100).
     */
    getChargePercent(): number {
        return this.character.ultimateCharge;
    }

    /**
     * Attiva la ultimate se è carica.
     * 
     * @param args - Argomenti specifici per la ultimate
     * @returns true se attivata con successo
     */
    activate(...args: any[]): boolean {
        if (!this.isReady() || !this.ultimate) {
            return false;
        }
        
        // Resettiamo il caricamento dopo l'attivazione
        this.character.resetUltimate();
        
        return this.ultimate.activate();
    }

    /**
     * Aggiorna il timer della ultimate.
     * 
     * @param dt - Delta time in secondi
     */
    tick(dt: number): void {
        if (this.ultimate) {
            this.ultimate.tick(dt);
        }
    }

    /**
     * Controlla se la ultimate è attualmente attiva.
     */
    isActive(): boolean {
        return this.ultimate?.isActive ?? false;
    }

    /**
     * Resetta la ultimate.
     */
    reset(): void {
        if (this.ultimate) {
            this.ultimate.reset();
        }
    }
}

// ============================================================
// PARTE 6: FUNZIONI DI UTILITÀ
// ============================================================

/**
 * Controlla se un personaggio è vivo.
 * 
 * @param character - Il personaggio da controllare
 * @returns true se il personaggio è vivo
 */
export function isAlive(character: Character): boolean {
    return character.currentHealth > 0;
}

/**
 * Controlla se un personaggio può usare un'abilità.
 * 
 * @param character - Il personaggio
 * @param abilityIndex - Indice dell'abilità (0-3)
 * @returns true se l'abilità può essere usata
 */
export function canUseAbility(character: Character, abilityIndex: number): boolean {
    // Controlliamo che l'indice sia valido
    if (abilityIndex < 0 || abilityIndex >= character.abilities.length) {
        return false;
    }
    
    return character.abilities[abilityIndex].isReady();
}

/**
 * Usa un'abilità e resetta il suo cooldown.
 * 
 * @param character - Il personaggio che usa l'abilità
 * @param abilityIndex - Indice dell'abilità da usare
 * @returns true se l'abilità è stata usata con successo
 */
export function useAbility(character: Character, abilityIndex: number): boolean {
    // Controlliamo se l'abilità può essere usata
    if (!canUseAbility(character, abilityIndex)) {
        return false;
    }
    
    // Reset del cooldown
    character.abilities[abilityIndex].resetCooldown();
    
    return true;
}

/**
 * Applica danno a un personaggio e aggiorna la ultimate.
 * 
 * @param attacker - Il personaggio che attacca
 * @param target - Il personaggio che riceve il danno
 * @param damage - Quantità di danno da infliggere
 * @returns Il danno effettivo inflitto
 */
export function applyDamage(attacker: Character, target: Character, damage: number): number {
    // Applichiamo il danno al bersaglio
    const actualDamage = target.takeDamage(damage);
    
    // Se il danno è stato inflitto, aggiungiamo caricamento alla ultimate dell'attaccante
    // La regola è: 1% di ultimate per ogni 5 danno inflitto
    if (actualDamage > 0) {
        const ultimateGain = actualDamage / 5;
        attacker.addUltimateCharge(ultimateGain);
    }
    
    return actualDamage;
}