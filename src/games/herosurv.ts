import type { Player } from "../common";
import type { IncomingMsg, OutgoingMsg } from "../server";
import { Button } from "../client/ui-elements";
import type { UserInput } from "../client/user-input";
import { GameClient, GameServer } from "./game";

/**
 * Indica i quattro ruoli previsti dal design del gioco.
 * Tutti e quattro hanno kit, attacco base, passiva e Ultimate.
 */
export type CharacterKind = "Bull" | "Sniper" | "Healer" | "Controller";

/**
 * Indica il tipo di danno.
 * "physical" e importante perche solo questo tipo carica la Ultimate.
 */
export type DamageKind = "physical" | "special" | "true";

/**
 * Rappresenta una posizione o una direzione in 2D.
 * Usiamo un'interfaccia semplice per restare vicini al piano cartesiano del Canvas.
 */
export interface Vector2 {
    x: number;
    y: number;
}

/**
 * Rappresenta un muro rettangolare della mappa.
 * I muri bloccano movimento, dash e linea di tiro dei colpi mirati.
 */
export interface ArenaWall {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Rappresenta le dimensioni dell'arena.
 * Serve per evitare che i personaggi escano dai limiti dello schermo.
 */
export interface ArenaBounds {
    width: number;
    height: number;
    walls: ArenaWall[];
    blockers?: ArenaWall[];
}

/**
 * Descrive un evento di danno gia calcolato.
 * Questo oggetto e utile per debug, UI, effetti visivi e sincronizzazione multiplayer.
 */
export interface DamageEvent {
    sourceId: string;
    targetId: string;
    amount: number;
    kind: DamageKind;
    abilityId: string;
}

/**
 * Descrive il risultato del tentativo di usare una abilita.
 * Non lanciamo errori durante il gameplay: restituiamo un risultato leggibile e sicuro.
 */
export interface AbilityUseResult {
    activated: boolean;
    reason: string;
    damageEvents: DamageEvent[];
}

/**
 * Contesto passato a una abilita quando viene usata.
 * In questo modo l'abilita conosce chi la usa, chi puo colpire e dove sono i limiti.
 */
export interface AbilityContext {
    caster: Character;
    targets: Character[];
    allies: Character[];
    aimDirection: Vector2;
    arena: ArenaBounds;
}

/**
 * Descrive una abilita passiva.
 * La passiva non ha tasti o cooldown: modifica automaticamente alcune regole.
 */
export interface PassiveAbility {
    name: string;
    description: string;
    modifyIncomingDamage(owner: Character, amount: number, kind: DamageKind): number;
}

/**
 * Statistiche base di un personaggio.
 * Tenerle in un oggetto rende piu facile bilanciare i personaggi senza cercare numeri sparsi.
 */
export interface CharacterStats {
    maxHealth: number;
    moveSpeed: number;
    radius: number;
    ultimateDamageRequired: number;
}

/**
 * Dati minimi per creare un personaggio.
 * Il costruttore della classe Character usa questi valori per inizializzare lo stato.
 */
export interface CharacterConfig {
    id: string;
    teamId: string | null;
    kind: CharacterKind;
    displayName: string;
    stats: CharacterStats;
    startPosition: Vector2;
    passive: PassiveAbility;
    activeAbilities: Ability[];
    ultimate: UltimateAbility;
}

/**
 * Fotografia sicura dello stato di un personaggio.
 * Un server potrebbe inviare questo oggetto ai client senza esporre metodi interni.
 */
export interface CharacterSnapshot {
    id: string;
    teamId: string | null;
    kind: CharacterKind;
    displayName: string;
    health: number;
    maxHealth: number;
    radius: number;
    shieldPoints: number;
    ultimateChargePercent: number;
    position: Vector2;
    velocity: Vector2;
    facingDirection: Vector2;
    activeEffectIds: string[];
    isAlive: boolean;
}

/**
 * Rappresenta un effetto temporaneo applicato a un personaggio.
 * Lo usiamo per scudi, stun e potenziamenti senza creare sistemi separati.
 */
export interface TimedEffect {
    id: string;
    name: string;
    remainingSeconds: number;
    shieldPoints?: number;
    outgoingDamageMultiplier?: number;
    incomingDamageMultiplier?: number;
    speedMultiplier?: number;
    blocksMovement?: boolean;
}

/**
 * Versione leggibile e sicura di un effetto temporaneo.
 * Questo oggetto puo essere mandato alla UI senza esporre riferimenti modificabili.
 */
export interface TimedEffectSnapshot {
    id: string;
    name: string;
    remainingSeconds: number;
    shieldPoints: number;
    blocksMovement: boolean;
}

/**
 * Stile visivo base per un personaggio.
 * Questi colori sono condivisi tra lobby, HUD e disegno su Canvas.
 */
export interface CharacterVisualStyle {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    outlineColor: string;
    bodyColor: string;
}

/**
 * Valore molto piccolo usato per confronti numerici stabili.
 * Evita problemi dovuti agli arrotondamenti dei numeri decimali.
 */
const EPSILON = 0.0001;

/**
 * Delta time massimo accettato in un singolo aggiornamento.
 * Se la scheda del browser si blocca per un attimo, questo limite evita scatti enormi.
 */
const MAX_SAFE_DT_SECONDS = 0.1;

/**
 * Dopo quanti secondi senza danno parte la cura automatica.
 * Questa regola premia chi riesce a uscire dal combattimento per qualche secondo.
 */
const OUT_OF_COMBAT_HEAL_DELAY_SECONDS = 3;

/**
 * Percentuale di vita massima recuperata ogni secondo fuori combattimento.
 * Usare una percentuale rende la cura proporzionata sia sui tank sia sui personaggi fragili.
 */
const OUT_OF_COMBAT_HEAL_PERCENT_PER_SECOND = 0.13;

/**
 * Carica Ultimate guadagnata lentamente ogni secondo anche senza colpire.
 * I danni fisici restano il modo principale per caricarla, ma nessuno resta bloccato a zero.
 */
const ULTIMATE_PASSIVE_CHARGE_PER_SECOND = 1.8;

/**
 * Protezione breve dopo il respawn in Arraffagemme.
 * Rende il rientro leggibile e impedisce eliminazioni istantanee allo spawn.
 */
const RESPAWN_INVULNERABILITY_SECONDS = 1.15;

/**
 * Bonus permanenti raccolti in Sopravvivenza tramite i power-up.
 */
const POWER_CUBE_HEALTH_BONUS = 430;
const POWER_CUBE_DAMAGE_BONUS = 0.1;

/**
 * Limita un numero tra un minimo e un massimo.
 * Usiamo questa funzione per salute, cooldown, carica Ultimate e limiti arena.
 */
function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/**
 * Trasforma un numero non valido in un valore di riserva.
 * Questo rende il codice robusto contro NaN, Infinity o dati corrotti arrivati dalla rete.
 */
function safeNumber(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * Ripulisce il delta time prima di usarlo nella simulazione.
 * Un dt negativo o infinito viene trattato come zero per non rompere la fisica.
 */
function safeDeltaTime(dt: number): number {
    const cleanDt = safeNumber(dt, 0);
    return clamp(cleanDt, 0, MAX_SAFE_DT_SECONDS);
}

/**
 * Crea una copia di un vettore.
 * Copiare evita che codice esterno modifichi per sbaglio lo stato interno del personaggio.
 */
function copyVector(vector: Vector2): Vector2 {
    return {
        x: safeNumber(vector.x, 0),
        y: safeNumber(vector.y, 0),
    };
}

/**
 * Calcola la lunghezza di un vettore.
 * Serve per normalizzare direzioni e misurare distanze fra personaggi.
 */
function vectorLength(vector: Vector2): number {
    return Math.hypot(vector.x, vector.y);
}

/**
 * Restituisce una direzione con lunghezza 1 oppure il vettore zero.
 * Questo impedisce movimenti piu veloci in diagonale e rende i comandi fluidi.
 */
function normalizeOrZero(vector: Vector2): Vector2 {
    const length = vectorLength(vector);

    if (length <= EPSILON) {
        return { x: 0, y: 0 };
    }

    return {
        x: vector.x / length,
        y: vector.y / length,
    };
}

/**
 * Ruota una direzione gia normalizzata.
 * La usiamo per creare attacchi con piu proiettili e un piccolo spread controllato.
 */
function rotateVector(vector: Vector2, radians: number): Vector2 {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    return normalizeOrZero({
        x: vector.x * cos - vector.y * sin,
        y: vector.x * sin + vector.y * cos,
    });
}

/**
 * Calcola la distanza fra due posizioni.
 * Le abilita melee e ad area la usano per capire chi viene colpito.
 */
function distanceBetween(a: Vector2, b: Vector2): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Calcola la distanza minima fra un punto e il segmento percorso da un proiettile.
 * Questo rende le hitbox stabili anche se il server salta un frame.
 */
function distancePointToSegment(point: Vector2, start: Vector2, end: Vector2): number {
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

    if (segmentLengthSquared <= EPSILON) {
        return distanceBetween(point, start);
    }

    const t = clamp(
        ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / segmentLengthSquared,
        0,
        1
    );

    return distanceBetween(point, {
        x: start.x + segmentX * t,
        y: start.y + segmentY * t,
    });
}

/**
 * Controlla se un segmento attraversa un rettangolo.
 * Lo usiamo per far bloccare i colpi dai muri, come copertura reale.
 */
function segmentIntersectsWall(start: Vector2, end: Vector2, wall: ArenaWall): boolean {
    const minX = wall.x;
    const maxX = wall.x + wall.w;
    const minY = wall.y;
    const maxY = wall.y + wall.h;
    let tMin = 0;
    let tMax = 1;
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    const clip = (origin: number, direction: number, min: number, max: number): boolean => {
        if (Math.abs(direction) <= EPSILON) {
            return origin >= min && origin <= max;
        }

        const t1 = (min - origin) / direction;
        const t2 = (max - origin) / direction;
        const near = Math.min(t1, t2);
        const far = Math.max(t1, t2);
        tMin = Math.max(tMin, near);
        tMax = Math.min(tMax, far);
        return tMin <= tMax;
    };

    return clip(start.x, dx, minX, maxX) && clip(start.y, dy, minY, maxY);
}

/**
 * Dice se un muro interrompe la linea tra due personaggi.
 * Se ritorna true, il colpo a distanza non deve passare.
 */
function isLineBlockedByWalls(start: Vector2, end: Vector2, walls: ArenaWall[]): boolean {
    return walls.some((wall) => segmentIntersectsWall(start, end, wall));
}

/**
 * Crea un risultato positivo per una abilita.
 * Avere una funzione dedicata mantiene coerenti tutti i risultati di gameplay.
 */
function abilitySuccess(reason: string, damageEvents: DamageEvent[] = []): AbilityUseResult {
    return {
        activated: true,
        reason,
        damageEvents,
    };
}

/**
 * Crea un risultato negativo per una abilita.
 * Usiamo un fallimento controllato invece di causare crash durante la partita.
 */
function abilityFailure(reason: string): AbilityUseResult {
    return {
        activated: false,
        reason,
        damageEvents: [],
    };
}

/**
 * Classe astratta per una abilita attiva.
 * Ogni abilita attiva ha un cooldown aggiornato con il delta time.
 */
export abstract class Ability {
    public readonly id: string;
    public readonly name: string;
    public readonly description: string;
    public readonly cooldownSeconds: number;
    private cooldownRemainingSeconds: number;

    /**
     * Prepara i dati comuni a tutte le abilita attive.
     * Il cooldown viene corretto per evitare valori negativi o non validi.
     */
    constructor(id: string, name: string, description: string, cooldownSeconds: number) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.cooldownSeconds = Math.max(0, safeNumber(cooldownSeconds, 0));
        this.cooldownRemainingSeconds = 0;
    }

    /**
     * Aggiorna il cooldown usando il delta time.
     * Sottrarre dt rende la ricarica indipendente dagli FPS del computer.
     */
    public update(dt: number): void {
        const safeDt = safeDeltaTime(dt);
        this.cooldownRemainingSeconds = clamp(
            this.cooldownRemainingSeconds - safeDt,
            0,
            this.cooldownSeconds
        );
    }

    /**
     * Dice se l'abilita puo essere usata ora.
     * Il controllo centralizzato evita logiche duplicate nelle singole abilita.
     */
    public isReady(): boolean {
        return this.cooldownRemainingSeconds <= EPSILON;
    }

    /**
     * Restituisce i secondi di cooldown ancora mancanti.
     * Questo valore puo essere mostrato nella UI della lobby o dell'HUD.
     */
    public getCooldownRemainingSeconds(): number {
        return this.cooldownRemainingSeconds;
    }

    /**
     * Restituisce una percentuale da 0 a 100 del cooldown completato.
     * 100 significa pronta, 0 significa appena usata.
     */
    public getCooldownReadyPercent(): number {
        if (this.cooldownSeconds <= EPSILON) {
            return 100;
        }

        const remainingRatio = this.cooldownRemainingSeconds / this.cooldownSeconds;
        return clamp((1 - remainingRatio) * 100, 0, 100);
    }

    /**
     * Prova a usare l'abilita in modo sicuro.
     * Se l'abilita riesce, il cooldown parte solo dopo una attivazione valida.
     */
    public tryUse(context: AbilityContext): AbilityUseResult {
        if (!this.isReady()) {
            return abilityFailure(`${this.name} e ancora in ricarica.`);
        }

        try {
            const result = this.activate(context);

            if (result.activated) {
                this.cooldownRemainingSeconds = this.cooldownSeconds;
            }

            return result;
        } catch {
            return abilityFailure(`${this.name} non e riuscita per un errore controllato.`);
        }
    }

    /**
     * Metodo che ogni abilita concreta deve implementare.
     * La classe base gestisce il cooldown; la sottoclasse decide l'effetto di gioco.
     */
    protected abstract activate(context: AbilityContext): AbilityUseResult;
}

/**
 * Classe astratta per la Ultimate.
 * La Ultimate non usa cooldown: viene controllata solo dalla percentuale di carica.
 */
export abstract class UltimateAbility {
    public readonly id: string;
    public readonly name: string;
    public readonly description: string;

    /**
     * Salva i dati descrittivi della Ultimate.
     * Non esiste cooldownSeconds perche la ricarica dipende da danni fisici e carica lenta.
     */
    constructor(id: string, name: string, description: string) {
        this.id = id;
        this.name = name;
        this.description = description;
    }

    /**
     * Prova a usare la Ultimate in modo sicuro.
     * La carica viene consumata solo se l'effetto parte davvero.
     */
    public tryUse(context: AbilityContext): AbilityUseResult {
        if (!context.caster.isUltimateReady()) {
            return abilityFailure(`${this.name} richiede il 100% di carica Ultimate.`);
        }

        try {
            const result = this.activate(context);

            if (result.activated) {
                context.caster.consumeUltimateCharge();
            }

            return result;
        } catch {
            return abilityFailure(`${this.name} non e riuscita per un errore controllato.`);
        }
    }

    /**
     * Metodo che ogni Ultimate concreta deve implementare.
     * La sottoclasse descrive l'effetto, mentre questa classe protegge la carica.
     */
    protected abstract activate(context: AbilityContext): AbilityUseResult;
}

/**
 * Classe astratta per un personaggio giocabile.
 * Contiene movimento, salute, cooldown e carica Ultimate in un unico punto robusto.
 */
export abstract class Character {
    public readonly id: string;
    public readonly teamId: string | null;
    public readonly kind: CharacterKind;
    public readonly displayName: string;
    public readonly stats: CharacterStats;
    public readonly passive: PassiveAbility;
    public readonly activeAbilities: Ability[];
    public readonly ultimate: UltimateAbility;
    private health: number;
    private ultimateChargePercent: number;
    private position: Vector2;
    private velocity: Vector2;
    private facingDirection: Vector2;
    private activeEffects: TimedEffect[];
    private secondsSinceLastDamage: number;
    private powerCubeCount: number;

    /**
     * Costruisce lo stato iniziale del personaggio.
     * Tutti i numeri vengono corretti per evitare valori impossibili.
     */
    constructor(config: CharacterConfig) {
        this.id = config.id;
        this.teamId = config.teamId;
        this.kind = config.kind;
        this.displayName = config.displayName;
        this.stats = {
            maxHealth: Math.max(1, safeNumber(config.stats.maxHealth, 1)),
            moveSpeed: Math.max(0, safeNumber(config.stats.moveSpeed, 0)),
            radius: Math.max(1, safeNumber(config.stats.radius, 1)),
            ultimateDamageRequired: Math.max(1, safeNumber(config.stats.ultimateDamageRequired, 1)),
        };
        this.passive = config.passive;
        this.activeAbilities = config.activeAbilities.slice(0, 1);
        this.ultimate = config.ultimate;
        this.health = this.stats.maxHealth;
        this.ultimateChargePercent = 0;
        this.position = copyVector(config.startPosition);
        this.velocity = { x: 0, y: 0 };
        this.facingDirection = { x: 1, y: 0 };
        this.activeEffects = [];
        this.secondsSinceLastDamage = 0;
        this.powerCubeCount = 0;
    }

    /**
     * Aggiorna movimento e cooldown usando il delta time.
     * Questo metodo e pensato per essere chiamato una volta per frame o tick server.
     */
    public update(dt: number, inputDirection: Vector2, arena: ArenaBounds, blocksPassiveHealing: boolean = false): void {
        const safeDt = safeDeltaTime(dt);

        for (const ability of this.activeAbilities) {
            ability.update(safeDt);
        }

        this.updateTimedEffects(safeDt);

        if (!this.isAlive()) {
            this.velocity = { x: 0, y: 0 };
            return;
        }

        // La rigenerazione parte solo quando il giocatore non prende danni e non sta recuperando dallo sparo.
        if (blocksPassiveHealing) {
            this.secondsSinceLastDamage = 0;
        } else {
            this.secondsSinceLastDamage += safeDt;
        }
        this.addUltimateChargeOverTime(safeDt);
        this.applyOutOfCombatHealing(safeDt);

        if (this.isMovementBlocked()) {
            this.velocity = { x: 0, y: 0 };
            return;
        }

        const moveDirection = normalizeOrZero(inputDirection);

        if (vectorLength(moveDirection) > EPSILON) {
            this.facingDirection = moveDirection;
        }

        const desiredVelocity = {
            x: moveDirection.x * this.getEffectiveMoveSpeed(),
            y: moveDirection.y * this.getEffectiveMoveSpeed(),
        };

        const accelerationStrength = 14;
        const smoothing = clamp(accelerationStrength * safeDt, 0, 1);

        this.velocity.x += (desiredVelocity.x - this.velocity.x) * smoothing;
        this.velocity.y += (desiredVelocity.y - this.velocity.y) * smoothing;

        this.position.x += this.velocity.x * safeDt;
        this.position.y += this.velocity.y * safeDt;

        this.keepInsideArena(arena);
        this.keepOutsideWalls(arena.blockers ?? []);
    }

    /**
     * Infligge danno a un altro personaggio e ricarica la Ultimate se il danno e fisico.
     * Restituisce un evento pronto per essere mostrato o sincronizzato online.
     */
    public dealDamage(
        target: Character,
        amount: number,
        kind: DamageKind,
        abilityId: string,
        canChargeUltimate: boolean = true
    ): DamageEvent {
        if (target.id === this.id) {
            return { sourceId: this.id, targetId: target.id, amount: 0, kind, abilityId };
        }

        const cleanAmount = Math.max(0, safeNumber(amount, 0)) * this.getOutgoingDamageMultiplier();
        const actualDamage = target.receiveDamage(cleanAmount, kind);

        if (canChargeUltimate && kind === "physical") {
            this.addUltimateChargeFromPhysicalDamage(actualDamage);
        }

        return {
            sourceId: this.id,
            targetId: target.id,
            amount: actualDamage,
            kind,
            abilityId,
        };
    }

    /**
     * Riceve danno dopo aver applicato la passiva.
     * La salute viene sempre bloccata tra 0 e maxHealth per evitare stati impossibili.
     */
    public receiveDamage(amount: number, kind: DamageKind): number {
        if (!this.isAlive()) {
            return 0;
        }

        const cleanAmount = Math.max(0, safeNumber(amount, 0));
        const modifiedAmount = this.passive.modifyIncomingDamage(this, cleanAmount, kind);
        const effectAmount = safeNumber(modifiedAmount, cleanAmount) * this.getIncomingDamageMultiplier();
        const damageAfterShields = this.absorbDamageWithShields(effectAmount);
        const finalAmount = clamp(damageAfterShields, 0, this.health);

        this.health = clamp(this.health - finalAmount, 0, this.getEffectiveMaxHealth());

        if (finalAmount > EPSILON) {
            this.secondsSinceLastDamage = 0;
        }

        return finalAmount;
    }

    /**
     * Cura il personaggio senza superare la salute massima.
     * Restituisce la cura effettiva, utile per numeri fluttuanti e log di partita.
     */
    public heal(amount: number): number {
        if (!this.isAlive()) {
            return 0;
        }

        const cleanAmount = Math.max(0, safeNumber(amount, 0));
        const oldHealth = this.health;

        this.health = clamp(this.health + cleanAmount, 0, this.getEffectiveMaxHealth());
        return this.health - oldHealth;
    }

/**
 * Aggiunge un power-up permanente in Sopravvivenza.
 * Ogni power-up aumenta salute massima e danno.
     */
    public addPowerCube(): void {
        this.powerCubeCount += 1;
        this.health = clamp(this.health + POWER_CUBE_HEALTH_BONUS, 0, this.getEffectiveMaxHealth());
    }

    /**
     * Rimuove power-up quando un personaggio muore e li lascia cadere a terra.
     */
    public removePowerCubes(count: number): number {
        const removed = clamp(Math.floor(safeNumber(count, 0)), 0, this.powerCubeCount);

        if (removed <= 0) {
            return 0;
        }

        this.powerCubeCount -= removed;
        this.health = clamp(this.health, 0, this.getEffectiveMaxHealth());
        return removed;
    }

    /**
     * Restituisce quanti power-up sono attivi.
     */
    public getPowerCubeCount(): number {
        return this.powerCubeCount;
    }

    /**
     * Salute massima dopo i bonus permanenti.
     */
    public getEffectiveMaxHealth(): number {
        return this.stats.maxHealth + this.powerCubeCount * POWER_CUBE_HEALTH_BONUS;
    }

    /**
     * Riporta in vita il personaggio in una posizione sicura.
     * Serve per Arraffagemme, dove un giocatore eliminato rientra dopo pochi secondi.
     */
    public reviveAt(position: Vector2, arena: ArenaBounds): void {
        this.health = this.getEffectiveMaxHealth();
        this.position = copyVector(position);
        this.velocity = { x: 0, y: 0 };
        this.activeEffects = [];
        this.secondsSinceLastDamage = 0;
        this.keepInsideArena(arena);
    }

    /**
     * Sposta il personaggio di una distanza immediata, per dash o spinte.
     * Dopo lo spostamento controlliamo subito i bordi dell'arena.
     */
    public dash(direction: Vector2, distance: number, arena: ArenaBounds): void {
        const cleanDirection = normalizeOrZero(direction);
        const cleanDistance = Math.max(0, safeNumber(distance, 0));
        const stepDistance = Math.max(12, this.stats.radius * 0.45);
        const steps = Math.max(1, Math.ceil(cleanDistance / stepDistance));
        const step = cleanDistance / steps;

        for (let i = 0; i < steps; i += 1) {
            this.position.x += cleanDirection.x * step;
            this.position.y += cleanDirection.y * step;
            this.keepInsideArena(arena);
            this.keepOutsideWalls(arena.blockers ?? []);
        }
    }

    /**
     * Aggiunge un effetto temporaneo al personaggio.
     * Se esiste gia un effetto con lo stesso id, lo sostituiamo per evitare duplicati confusi.
     */
    public addTimedEffect(effect: TimedEffect): void {
        const cleanEffect: TimedEffect = {
            id: effect.id,
            name: effect.name,
            remainingSeconds: Math.max(0, safeNumber(effect.remainingSeconds, 0)),
            shieldPoints: Math.max(0, safeNumber(effect.shieldPoints ?? 0, 0)),
            outgoingDamageMultiplier: Math.max(0, safeNumber(effect.outgoingDamageMultiplier ?? 1, 1)),
            incomingDamageMultiplier: Math.max(0, safeNumber(effect.incomingDamageMultiplier ?? 1, 1)),
            speedMultiplier: Math.max(0, safeNumber(effect.speedMultiplier ?? 1, 1)),
            blocksMovement: effect.blocksMovement === true,
        };

        const cleanShieldPoints = Math.max(0, safeNumber(cleanEffect.shieldPoints ?? 0, 0));

        if (cleanEffect.remainingSeconds <= EPSILON && cleanShieldPoints <= EPSILON) {
            return;
        }

        this.activeEffects = this.activeEffects.filter((activeEffect) => activeEffect.id !== cleanEffect.id);
        this.activeEffects.push(cleanEffect);
    }

    /**
     * Restituisce quanti punti scudo sono ancora attivi.
     * La UI puo usare questo numero per disegnare una barra separata dalla vita.
     */
    public getShieldPoints(): number {
        return this.activeEffects.reduce((total, effect) => {
            return total + Math.max(0, safeNumber(effect.shieldPoints ?? 0, 0));
        }, 0);
    }

    /**
     * Restituisce una copia leggibile degli effetti attivi.
     * Copiare i dati evita che la UI modifichi per errore la logica del personaggio.
     */
    public getActiveEffectsSnapshot(): TimedEffectSnapshot[] {
        return this.activeEffects.map((effect) => {
            return {
                id: effect.id,
                name: effect.name,
                remainingSeconds: effect.remainingSeconds,
                shieldPoints: Math.max(0, safeNumber(effect.shieldPoints ?? 0, 0)),
                blocksMovement: effect.blocksMovement === true,
            };
        });
    }

    /**
     * Restituisce la posizione attuale come copia.
     * La copia protegge lo stato interno da modifiche esterne accidentali.
     */
    public getPosition(): Vector2 {
        return copyVector(this.position);
    }

    /**
     * Restituisce la velocita attuale come copia.
     * Questo valore puo servire per animazioni o interpolazioni lato client.
     */
    public getVelocity(): Vector2 {
        return copyVector(this.velocity);
    }

    /**
     * Restituisce la direzione in cui il personaggio sta guardando.
     * Se il giocatore non mira, le abilita possono usare questa direzione.
     */
    public getFacingDirection(): Vector2 {
        return copyVector(this.facingDirection);
    }

    /**
     * Restituisce la salute attuale.
     * Esporre un getter evita modifiche dirette non controllate.
     */
    public getHealth(): number {
        return this.health;
    }

    /**
     * Restituisce la salute in percentuale da 0 a 100.
     * Questo formato e comodo per barre vita ridimensionabili in Canvas.
     */
    public getHealthPercent(): number {
        return clamp((this.health / this.getEffectiveMaxHealth()) * 100, 0, 100);
    }

    /**
     * Dice se il personaggio e ancora in partita.
     * Centralizzare questo controllo rende piu sicure abilita e collisioni.
     */
    public isAlive(): boolean {
        return this.health > EPSILON;
    }

    /**
     * Restituisce la percentuale di carica Ultimate.
     * Il valore resta sempre tra 0 e 100.
     */
    public getUltimateChargePercent(): number {
        return this.ultimateChargePercent;
    }

    /**
     * Dice se la Ultimate puo essere usata.
     * Non controlliamo cooldown perche la Ultimate dipende solo dalla carica.
     */
    public isUltimateReady(): boolean {
        return this.ultimateChargePercent >= 100;
    }

    /**
     * Consuma tutta la carica Ultimate.
     * La chiamiamo solo dopo una Ultimate attivata con successo.
     */
    public consumeUltimateCharge(): void {
        this.ultimateChargePercent = 0;
    }

    /**
     * Crea una fotografia sicura dello stato del personaggio.
     * Questo aiuta a separare logica interna e dati inviabili ai client.
     */
    public getSnapshot(): CharacterSnapshot {
        return {
            id: this.id,
            teamId: this.teamId,
            kind: this.kind,
            displayName: this.displayName,
            health: this.health,
            maxHealth: this.getEffectiveMaxHealth(),
            radius: this.stats.radius,
            shieldPoints: this.getShieldPoints(),
            ultimateChargePercent: this.ultimateChargePercent,
            position: this.getPosition(),
            velocity: this.getVelocity(),
            facingDirection: this.getFacingDirection(),
            activeEffectIds: this.activeEffects.map((effect) => effect.id),
            isAlive: this.isAlive(),
        };
    }

    /**
     * Aggiorna la durata degli effetti temporanei con il delta time.
     * Usare dt rende scudi, stun e buff uguali su computer veloci o lenti.
     */
    private updateTimedEffects(dt: number): void {
        for (const effect of this.activeEffects) {
            effect.remainingSeconds = clamp(effect.remainingSeconds - dt, 0, Number.POSITIVE_INFINITY);
        }

        this.activeEffects = this.activeEffects.filter((effect) => {
            const shieldPoints = Math.max(0, safeNumber(effect.shieldPoints ?? 0, 0));
            return effect.remainingSeconds > EPSILON && (effect.shieldPoints === undefined || shieldPoints > EPSILON);
        });
    }

    /**
     * Dice se un effetto attivo blocca il movimento.
     * Lo stun usa questo controllo per fermare il personaggio senza rompere i cooldown.
     */
    private isMovementBlocked(): boolean {
        return this.activeEffects.some((effect) => effect.blocksMovement === true);
    }

    /**
     * Calcola la velocita finale dopo i moltiplicatori temporanei.
     * La Ultimate di Bull usa questo metodo per aumentare la velocita per pochi secondi.
     */
    private getEffectiveMoveSpeed(): number {
        const multiplier = this.activeEffects.reduce((currentMultiplier, effect) => {
            return currentMultiplier * Math.max(0, safeNumber(effect.speedMultiplier ?? 1, 1));
        }, 1);

        return this.stats.moveSpeed * multiplier;
    }

    /**
     * Calcola il moltiplicatore del danno in uscita.
     * Tenerlo qui permette a tutte le abilita di beneficiare dei buff senza duplicare codice.
     */
    private getOutgoingDamageMultiplier(): number {
        const effectMultiplier = this.activeEffects.reduce((currentMultiplier, effect) => {
            return currentMultiplier * Math.max(0, safeNumber(effect.outgoingDamageMultiplier ?? 1, 1));
        }, 1);

        return effectMultiplier * (1 + this.powerCubeCount * POWER_CUBE_DAMAGE_BONUS);
    }

    /**
     * Calcola il moltiplicatore del danno in entrata.
     * Un valore sotto 1 riduce il danno, un valore sopra 1 lo aumenta.
     */
    private getIncomingDamageMultiplier(): number {
        return this.activeEffects.reduce((currentMultiplier, effect) => {
            return currentMultiplier * Math.max(0, safeNumber(effect.incomingDamageMultiplier ?? 1, 1));
        }, 1);
    }

    /**
     * Usa gli scudi attivi per assorbire il danno prima della vita.
     * Restituisce solo il danno rimasto dopo l'assorbimento degli scudi.
     */
    private absorbDamageWithShields(amount: number): number {
        let remainingDamage = Math.max(0, safeNumber(amount, 0));

        for (const effect of this.activeEffects) {
            const shieldPoints = Math.max(0, safeNumber(effect.shieldPoints ?? 0, 0));

            if (shieldPoints <= EPSILON || remainingDamage <= EPSILON) {
                continue;
            }

            const absorbedDamage = Math.min(shieldPoints, remainingDamage);
            effect.shieldPoints = shieldPoints - absorbedDamage;
            remainingDamage -= absorbedDamage;
        }

        this.activeEffects = this.activeEffects.filter((effect) => {
            const shieldPoints = Math.max(0, safeNumber(effect.shieldPoints ?? 0, 0));
            return effect.remainingSeconds > EPSILON && (effect.shieldPoints === undefined || shieldPoints > EPSILON);
        });

        return remainingDamage;
    }

    /**
     * Aggiunge carica Ultimate in base al danno fisico realmente inflitto.
     * Se il nemico aveva poca vita, conta solo il danno effettivo e non quello teorico.
     */
    private addUltimateChargeFromPhysicalDamage(damageAmount: number): void {
        const cleanDamage = Math.max(0, safeNumber(damageAmount, 0));
        const gainPercent = (cleanDamage / this.stats.ultimateDamageRequired) * 100;

        this.ultimateChargePercent = clamp(this.ultimateChargePercent + gainPercent, 0, 100);
    }

    /**
     * Aggiunge una piccola carica Ultimate nel tempo.
     * Questo rende la Ultimate sempre raggiungibile anche se il giocatore fatica a colpire.
     */
    private addUltimateChargeOverTime(dt: number): void {
        this.ultimateChargePercent = clamp(
            this.ultimateChargePercent + ULTIMATE_PASSIVE_CHARGE_PER_SECOND * dt,
            0,
            100
        );
    }

    /**
     * Cura lentamente il personaggio dopo alcuni secondi senza subire danno.
     * La cura si ferma automaticamente quando la vita torna al massimo.
     */
    private applyOutOfCombatHealing(dt: number): void {
        const maxHealth = this.getEffectiveMaxHealth();

        if (this.secondsSinceLastDamage < OUT_OF_COMBAT_HEAL_DELAY_SECONDS || this.health >= maxHealth) {
            return;
        }

        const healPerSecond = maxHealth * OUT_OF_COMBAT_HEAL_PERCENT_PER_SECOND;
        this.heal(healPerSecond * dt);
    }

    /**
     * Tiene il personaggio dentro l'arena.
     * Se tocca un bordo, azzeriamo la velocita su quell'asse per evitare vibrazioni.
     */
    private keepInsideArena(arena: ArenaBounds): void {
        const safeWidth = Math.max(this.stats.radius * 2, safeNumber(arena.width, this.stats.radius * 2));
        const safeHeight = Math.max(this.stats.radius * 2, safeNumber(arena.height, this.stats.radius * 2));
        const minX = this.stats.radius;
        const minY = this.stats.radius;
        const maxX = safeWidth - this.stats.radius;
        const maxY = safeHeight - this.stats.radius;
        const clampedX = clamp(this.position.x, minX, maxX);
        const clampedY = clamp(this.position.y, minY, maxY);

        if (Math.abs(clampedX - this.position.x) > EPSILON) {
            this.velocity.x = 0;
        }

        if (Math.abs(clampedY - this.position.y) > EPSILON) {
            this.velocity.y = 0;
        }

        this.position.x = clampedX;
        this.position.y = clampedY;

        this.keepOutsideWalls(arena.walls);
    }

    /**
     * Spinge il personaggio fuori dai muri rettangolari.
     * Usiamo una collisione cerchio-rettangolo semplice e stabile per non incastrare i player.
     */
    private keepOutsideWalls(walls: ArenaWall[]): void {
        for (const wall of walls) {
            const closestX = clamp(this.position.x, wall.x, wall.x + wall.w);
            const closestY = clamp(this.position.y, wall.y, wall.y + wall.h);
            let deltaX = this.position.x - closestX;
            let deltaY = this.position.y - closestY;
            let distance = Math.hypot(deltaX, deltaY);

            if (distance >= this.stats.radius || (distance <= EPSILON && !this.isPointInsideWall(this.position, wall))) {
                continue;
            }

            if (distance <= EPSILON) {
                const left = Math.abs(this.position.x - wall.x);
                const right = Math.abs(wall.x + wall.w - this.position.x);
                const top = Math.abs(this.position.y - wall.y);
                const bottom = Math.abs(wall.y + wall.h - this.position.y);
                const smallest = Math.min(left, right, top, bottom);

                if (smallest === left) {
                    deltaX = -1;
                    deltaY = 0;
                    distance = 1;
                } else if (smallest === right) {
                    deltaX = 1;
                    deltaY = 0;
                    distance = 1;
                } else if (smallest === top) {
                    deltaX = 0;
                    deltaY = -1;
                    distance = 1;
                } else {
                    deltaX = 0;
                    deltaY = 1;
                    distance = 1;
                }
            }

            const pushDistance = this.stats.radius - distance + 0.5;
            const pushX = (deltaX / distance) * pushDistance;
            const pushY = (deltaY / distance) * pushDistance;
            this.position.x += pushX;
            this.position.y += pushY;

            if (Math.abs(pushX) > Math.abs(pushY)) {
                this.velocity.x = 0;
            } else {
                this.velocity.y = 0;
            }
        }
    }

    /**
     * Controlla se il centro del personaggio e dentro un muro.
     * Questo caso raro succede dopo dash o spawn e va risolto con una spinta decisa.
     */
    private isPointInsideWall(point: Vector2, wall: ArenaWall): boolean {
        return point.x >= wall.x && point.x <= wall.x + wall.w && point.y >= wall.y && point.y <= wall.y + wall.h;
    }
}

/**
 * Controlla se un target e un nemico valido.
 * Evita di colpire se stessi, alleati e personaggi gia sconfitti.
 */
function isValidEnemy(caster: Character, target: Character): boolean {
    if (caster.id === target.id) {
        return false;
    }

    if (!target.isAlive()) {
        return false;
    }

    if (caster.teamId !== null && caster.teamId === target.teamId) {
        return false;
    }

    return true;
}

/**
 * Trova tutti i nemici vivi entro un certo raggio.
 * Le abilita ad area usano questa funzione per avere collisioni coerenti.
 */
function findEnemiesInRange(caster: Character, targets: Character[], range: number): Character[] {
    const cleanRange = Math.max(0, safeNumber(range, 0));
    const casterPosition = caster.getPosition();

    return targets.filter((target) => {
        if (!isValidEnemy(caster, target)) {
            return false;
        }

        const targetPosition = target.getPosition();
        const hitDistance = cleanRange + target.stats.radius + caster.stats.radius;
        return distanceBetween(casterPosition, targetPosition) <= hitDistance;
    });
}

/**
 * Trova i nemici dentro un cono di mira.
 * Le abilita a distanza usano questo controllo per sembrare skillshot e non aura invisibili.
 */
function findEnemiesInCone(
    caster: Character,
    targets: Character[],
    range: number,
    aimDirection: Vector2,
    minimumDot: number,
    walls: ArenaWall[] = []
): Character[] {
    const casterPosition = caster.getPosition();
    const cleanAim = vectorLength(aimDirection) > EPSILON
        ? normalizeOrZero(aimDirection)
        : caster.getFacingDirection();

    return targets.filter((target) => {
        if (!isValidEnemy(caster, target)) {
            return false;
        }

        const targetPosition = target.getPosition();
        const toTarget = {
            x: targetPosition.x - casterPosition.x,
            y: targetPosition.y - casterPosition.y,
        };
        const distance = vectorLength(toTarget);

        if (distance > range + target.stats.radius) {
            return false;
        }

        if (isLineBlockedByWalls(casterPosition, targetPosition, walls)) {
            return false;
        }

        const targetDirection = normalizeOrZero(toTarget);
        const dot = cleanAim.x * targetDirection.x + cleanAim.y * targetDirection.y;
        return dot >= minimumDot;
    });
}

/**
 * Trova il nemico piu vicino dentro un cono di mira.
 * Lo Sniper lo usa per premiare la mira precisa senza richiedere pixel-perfect.
 */
function findClosestEnemyInCone(
    caster: Character,
    targets: Character[],
    range: number,
    aimDirection: Vector2,
    minimumDot: number,
    walls: ArenaWall[] = []
): Character | null {
    const enemies = findEnemiesInCone(caster, targets, range, aimDirection, minimumDot, walls);
    const casterPosition = caster.getPosition();
    let bestTarget: Character | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const enemy of enemies) {
        const enemyDistance = distanceBetween(casterPosition, enemy.getPosition());

        if (enemyDistance < bestDistance) {
            bestDistance = enemyDistance;
            bestTarget = enemy;
        }
    }

    return bestTarget;
}

/**
 * Trova tutti gli alleati vivi entro un raggio.
 * L'Healer usa questa funzione per curare senza colpire accidentalmente i nemici.
 */
function findAlliesInRange(caster: Character, allies: Character[], range: number): Character[] {
    const casterPosition = caster.getPosition();
    const cleanRange = Math.max(0, safeNumber(range, 0));

    return allies.filter((ally) => {
        if (!ally.isAlive()) {
            return false;
        }

        const allyPosition = ally.getPosition();
        const hitDistance = cleanRange + ally.stats.radius + caster.stats.radius;
        return distanceBetween(casterPosition, allyPosition) <= hitDistance;
    });
}

/**
 * Trova l'alleato piu vicino entro un raggio.
 * Se nessun alleato e vicino, molte cure ricadono sul personaggio stesso.
 */
function findClosestAllyInRange(caster: Character, allies: Character[], range: number): Character | null {
    const closeAllies = findAlliesInRange(caster, allies, range);
    const casterPosition = caster.getPosition();
    let bestAlly: Character | null = null;
    let bestMissingHealth = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const ally of closeAllies) {
        const missingHealth = ally.stats.maxHealth - ally.getHealth();
        const allyDistance = distanceBetween(casterPosition, ally.getPosition());

        if (missingHealth > bestMissingHealth || (missingHealth === bestMissingHealth && allyDistance < bestDistance)) {
            bestMissingHealth = missingHealth;
            bestDistance = allyDistance;
            bestAlly = ally;
        }
    }

    return bestAlly;
}

/**
 * Passiva di Bull.
 * Riduce il danno fisico in entrata per rendere il personaggio un vero tank da mischia.
 */
class BullPassive implements PassiveAbility {
    public readonly name = "Pelle Dura";
    public readonly description = "Riduce del 12% i danni fisici subiti.";

    /**
     * Modifica il danno in entrata.
     * Applichiamo la riduzione solo al danno fisico per mantenere spazio a counter futuri.
     */
    public modifyIncomingDamage(owner: Character, amount: number, kind: DamageKind): number {
        if (kind !== "physical") {
            return amount;
        }

        return amount * 0.88;
    }
}

/**
 * Abilita attiva di Bull: dash semplice, danno e breve stun se arriva addosso ai nemici.
 */
class BullCharge extends Ability {
    private readonly damage = 1250;
    private readonly dashDistance = 185;
    private readonly impactRange = 74;
    private readonly stunSeconds = 0.75;

    /**
     * Configura la carica con cooldown medio-alto.
     * La mobilita e forte, quindi il tempo di ricarica evita abusi.
     */
    constructor() {
        super("bull-charge", "Carica", "Scatta in avanti, danneggia e stordisce i nemici colpiti.", 4.8);
    }

    /**
     * Esegue lo scatto e colpisce i nemici vicini al punto di arrivo.
     * Il cooldown parte anche se non colpisce, perche lo spostamento e gia un vantaggio.
     */
    protected activate(context: AbilityContext): AbilityUseResult {
        const aimDirection = normalizeOrZero(context.aimDirection);
        const chargeDirection = vectorLength(aimDirection) > EPSILON
            ? aimDirection
            : context.caster.getFacingDirection();

        context.caster.dash(chargeDirection, this.dashDistance, context.arena);

        const enemies = findEnemiesInRange(context.caster, context.targets, this.impactRange);
        const damageEvents = enemies.map((enemy) => {
            enemy.addTimedEffect({
                id: "bull-charge-stun",
                name: "Stordimento da Carica",
                remainingSeconds: this.stunSeconds,
                blocksMovement: true,
            });

            return context.caster.dealDamage(enemy, this.damage, "physical", this.id);
        });

        return abilitySuccess("Carica completata.", damageEvents);
    }
}

/**
 * Ultimate di Bull.
 * Non ha cooldown: richiede il 100% di carica ottenuta con danni fisici e tempo.
 */
class BullUltimate extends UltimateAbility {
    private readonly durationSeconds = 5;
    private readonly damageMultiplier = 2;
    private readonly speedMultiplier = 1.5;
    private readonly incomingDamageMultiplier = 0.5;

    /**
     * Configura nome e descrizione della Ultimate.
     * La ricarica e gestita dal Character, quindi qui non c'e un tempo di recupero.
     */
    constructor() {
        super(
            "bull-titan-fury",
            "Furia del Titano",
            "Per 5 secondi raddoppia il danno, aumenta la velocita e dimezza i danni subiti."
        );
    }

    /**
     * Applica il potenziamento temporaneo a Bull.
     * L'effetto viene aggiornato nel metodo update del personaggio usando il delta time.
     */
    protected activate(context: AbilityContext): AbilityUseResult {
        context.caster.addTimedEffect({
            id: "bull-titan-fury",
            name: "Furia del Titano",
            remainingSeconds: this.durationSeconds,
            outgoingDamageMultiplier: this.damageMultiplier,
            incomingDamageMultiplier: this.incomingDamageMultiplier,
            speedMultiplier: this.speedMultiplier,
        });

        return abilitySuccess("Furia del Titano attivata.");
    }
}

/**
 * Implementazione completa del personaggio Bull.
 * Estende Character e fornisce passiva, una abilita attiva e una Ultimate.
 */
export class Bull extends Character {
    /**
     * Crea Bull, resistente e forte negli scontri ravvicinati.
     * I valori sono scelti per un tank da mischia: molta vita, velocita media, raggio leggibile.
     */
    constructor(id: string, startPosition: Vector2, teamId: string | null = null) {
        super({
            id,
            teamId,
            kind: "Bull",
            displayName: "Bull",
            stats: {
                maxHealth: 7600,
                moveSpeed: 250,
                radius: 32,
                ultimateDamageRequired: 6200,
            },
            startPosition,
            passive: new BullPassive(),
            activeAbilities: [
                new BullCharge(),
            ],
            ultimate: new BullUltimate(),
        });
    }
}

/**
 * Passiva dello Sniper.
 * Mira e fragile, quindi riceve una piccola riduzione quando subisce danni speciali.
 */
class SniperPassive implements PassiveAbility {
    public readonly name = "Posizione Coperta";
    public readonly description = "Riduce del 15% i colpi grossi sopra 900 danni.";

    /**
     * Modifica solo i danni speciali.
     * Lo Sniper resta vulnerabile se viene raggiunto in corpo a corpo.
     */
    public modifyIncomingDamage(owner: Character, amount: number, kind: DamageKind): number {
        return amount >= 900 ? amount * 0.85 : amount;
    }
}

/**
 * Primo colpo dello Sniper.
 * Premia la mira in linea retta e infligge danno fisico, quindi carica la Ultimate.
 */
class SniperPreciseShot extends Ability {
    private readonly damage = 1450;
    private readonly range = 570;

    /**
     * Configura il tiro principale con cooldown medio.
     * Il range alto bilancia la fragilita dello Sniper.
     */
    constructor() {
        super("sniper-precise-shot", "Tiro Preciso", "Colpisce il nemico mirato da lunga distanza.", 2.4);
    }

    /**
     * Cerca un bersaglio nel cono di mira e applica danno fisico.
     * Se il giocatore mira male, il cooldown non parte.
     */
    protected activate(context: AbilityContext): AbilityUseResult {
        const target = findClosestEnemyInCone(context.caster, context.targets, this.range, context.aimDirection, 0.94, context.arena.walls);

        if (target === null) {
            return abilityFailure("Tiro Preciso richiede un nemico nella direzione del mouse.");
        }

        return abilitySuccess("Tiro Preciso ha colpito.", [
            context.caster.dealDamage(target, this.damage, "physical", this.id),
        ]);
    }
}

/**
 * Ultimate dello Sniper.
 * Un singolo colpo fisico molto potente, caricato da danni fisici e carica lenta nel tempo.
 */
class SniperUltimate extends UltimateAbility {
    private readonly damage = 3400;
    private readonly range = 760;

    /**
     * Configura la Ultimate da finisher.
     * Non ha cooldown: dipende dalla carica al 100%.
     */
    constructor() {
        super("sniper-destiny-shot", "Colpo del Destino", "Spara un colpo fisico devastante nella direzione del mouse.");
    }

    /**
     * Colpisce il nemico mirato senza ricaricare la Ultimate stessa.
     * Questo evita cicli infiniti di Super.
     */
    protected activate(context: AbilityContext): AbilityUseResult {
        const target = findClosestEnemyInCone(context.caster, context.targets, this.range, context.aimDirection, 0.96, context.arena.walls);

        if (target === null) {
            return abilityFailure("Colpo del Destino richiede un nemico perfettamente in mira.");
        }

        return abilitySuccess("Colpo del Destino ha colpito.", [
            context.caster.dealDamage(target, this.damage, "physical", this.id, false),
        ]);
    }
}

/**
 * Implementazione completa dello Sniper.
 * Mira ha poca vita ma un controllo enorme sulla distanza.
 */
export class Sniper extends Character {
    /**
     * Crea Mira con statistiche da DPS fragile.
     * Il raggio piccolo la rende meno ingombrante e piu leggibile come personaggio agile.
     */
    constructor(id: string, startPosition: Vector2, teamId: string | null = null) {
        super({
            id,
            teamId,
            kind: "Sniper",
            displayName: "Mira",
            stats: {
                maxHealth: 4200,
                moveSpeed: 275,
                radius: 25,
                ultimateDamageRequired: 5000,
            },
            startPosition,
            passive: new SniperPassive(),
            activeAbilities: [
                new SniperPreciseShot(),
            ],
            ultimate: new SniperUltimate(),
        });
    }
}

/**
 * Passiva dell'Healer.
 * Lumina diventa piu resistente quando resta con poca vita.
 */
class HealerPassive implements PassiveAbility {
    public readonly name = "Istinto Protettivo";
    public readonly description = "Sotto il 45% di vita subisce il 18% di danni in meno.";

    /**
     * Applica una riduzione solo quando la vita e bassa.
     * Questo aiuta il supporto a scappare senza renderlo sempre resistente.
     */
    public modifyIncomingDamage(owner: Character, amount: number, kind: DamageKind): number {
        return owner.getHealth() < owner.stats.maxHealth * 0.45 ? amount * 0.82 : amount;
    }
}

/**
 * Prima abilita dell'Healer.
 * Cura l'alleato vicino piu ferito oppure se stessa.
 */
class HealerFocusedHeal extends Ability {
    private readonly healAmount = 1300;
    private readonly range = 245;

    /**
     * Configura la cura principale.
     * Cooldown breve per rendere il supporto utile ma non immortale.
     */
    constructor() {
        super("healer-focused-heal", "Cura Mirata", "Cura l'alleato vicino piu ferito o te stesso.", 5);
    }

    /**
     * Cerca l'alleato con piu vita mancante.
     * Se nessuno e vicino, la cura va al caster per non sprecare il tasto.
     */
    protected activate(context: AbilityContext): AbilityUseResult {
        const target = findClosestAllyInRange(context.caster, context.allies, this.range) ?? context.caster;
        const healed = target.heal(this.healAmount);

        if (healed <= EPSILON) {
            return abilityFailure("Cura Mirata non ha trovato vita da recuperare.");
        }

        return abilitySuccess(`Cura Mirata recupera ${Math.round(healed)} vita.`);
    }
}

/**
 * Ultimate dell'Healer.
 * Cura e protegge tutta la squadra viva.
 */
class HealerUltimate extends UltimateAbility {
    private readonly healAmount = 2300;
    private readonly shieldPoints = 1000;
    private readonly durationSeconds = 4;

    /**
     * Configura la Ultimate di supporto.
     * Ha effetto sul team e puo ribaltare un combattimento.
     */
    constructor() {
        super("healer-mass-resonance", "Resonanza Vitale", "Cura tutta la squadra e aggiunge uno scudo temporaneo.");
    }

    /**
     * Cura tutti gli alleati vivi e applica uno scudo.
     * Non infligge danno, quindi non ricarica ulteriormente la Ultimate.
     */
    protected activate(context: AbilityContext): AbilityUseResult {
        for (const ally of context.allies) {
            ally.heal(this.healAmount);
            ally.addTimedEffect({
                id: "healer-mass-resonance",
                name: "Resonanza Vitale",
                remainingSeconds: this.durationSeconds,
                shieldPoints: this.shieldPoints,
            });
        }

        return abilitySuccess("Resonanza Vitale cura la squadra.");
    }
}

/**
 * Implementazione completa dell'Healer.
 * Lumina ha danno basso ma grande valore di squadra.
 */
export class Healer extends Character {
    /**
     * Crea Lumina con vita media e velocita buona.
     * Le sue abilita sono pensate per tenere insieme il team.
     */
    constructor(id: string, startPosition: Vector2, teamId: string | null = null) {
        super({
            id,
            teamId,
            kind: "Healer",
            displayName: "Lumina",
            stats: {
                maxHealth: 5200,
                moveSpeed: 265,
                radius: 27,
                ultimateDamageRequired: 4300,
            },
            startPosition,
            passive: new HealerPassive(),
            activeAbilities: [
                new HealerFocusedHeal(),
            ],
            ultimate: new HealerUltimate(),
        });
    }
}

/**
 * Passiva del Controller.
 * Vortice resiste meglio agli effetti speciali grazie al suo campo stabile.
 */
class ControllerPassive implements PassiveAbility {
    public readonly name = "Campo Stabile";
    public readonly description = "Riduce del 20% i danni speciali subiti.";

    /**
     * Riduce solo i danni speciali.
     * Il Controller deve comunque temere i danni fisici diretti.
     */
    public modifyIncomingDamage(owner: Character, amount: number, kind: DamageKind): number {
        return kind === "special" ? amount * 0.8 : amount;
    }
}

/**
 * Prima abilita del Controller.
 * Rallenta e danneggia i nemici nell'area vicina.
 */
class ControllerFreezeField extends Ability {
    private readonly damage = 850;
    private readonly range = 175;
    private readonly slowSeconds = 2.6;

    /**
     * Configura un controllo ad area breve.
     * Il danno e basso perche l'effetto principale e il rallentamento.
     */
    constructor() {
        super("controller-freeze-field", "Gelamento", "Rallenta i nemici vicini e infligge danno fisico.", 5);
    }

    /**
     * Applica rallentamento e danno a tutti i nemici nell'area.
     * Il rallentamento usa speedMultiplier, quindi scade con il delta time.
     */
    protected activate(context: AbilityContext): AbilityUseResult {
        const enemies = findEnemiesInRange(context.caster, context.targets, this.range);
        const damageEvents = enemies.map((enemy) => {
            enemy.addTimedEffect({
                id: "controller-freeze-field",
                name: "Gelamento",
                remainingSeconds: this.slowSeconds,
                speedMultiplier: 0.45,
            });

            return context.caster.dealDamage(enemy, this.damage, "physical", this.id);
        });

        if (damageEvents.length === 0) {
            return abilityFailure("Gelamento richiede nemici vicini.");
        }

        return abilitySuccess("Gelamento rallenta l'area.", damageEvents);
    }
}

/**
 * Ultimate del Controller.
 * Controlla una grande zona intorno al personaggio.
 */
class ControllerUltimate extends UltimateAbility {
    private readonly damage = 1550;
    private readonly range = 260;
    private readonly slowSeconds = 3.5;

    /**
     * Configura il Buco Nero.
     * Non sposta fisicamente i nemici, ma li blocca/rallenta in modo leggibile.
     */
    constructor() {
        super("controller-black-hole", "Buco Nero", "Danneggia e rallenta pesantemente tutti i nemici vicini.");
    }

    /**
     * Applica danno speciale e rallentamento forte.
     * Il danno della Ultimate non ricarica la Ultimate stessa.
     */
    protected activate(context: AbilityContext): AbilityUseResult {
        const enemies = findEnemiesInRange(context.caster, context.targets, this.range);
        const damageEvents = enemies.map((enemy) => {
            enemy.addTimedEffect({
                id: "controller-black-hole",
                name: "Buco Nero",
                remainingSeconds: this.slowSeconds,
                speedMultiplier: 0.25,
            });

            return context.caster.dealDamage(enemy, this.damage, "special", this.id, false);
        });

        if (damageEvents.length === 0) {
            return abilityFailure("Buco Nero richiede nemici vicini.");
        }

        return abilitySuccess("Buco Nero controlla l'area.", damageEvents);
    }
}

/**
 * Implementazione completa del Controller.
 * Vortice domina zone e percorsi, ma non ha burst immediato come lo Sniper.
 */
export class Controller extends Character {
    /**
     * Crea Vortice con statistiche intermedie.
     * Il suo valore nasce da slow, stun e area denial.
     */
    constructor(id: string, startPosition: Vector2, teamId: string | null = null) {
        super({
            id,
            teamId,
            kind: "Controller",
            displayName: "Vortice",
            stats: {
                maxHealth: 6100,
                moveSpeed: 245,
                radius: 30,
                ultimateDamageRequired: 5200,
            },
            startPosition,
            passive: new ControllerPassive(),
            activeAbilities: [
                new ControllerFreezeField(),
            ],
            ultimate: new ControllerUltimate(),
        });
    }
}

/**
 * Configurazione descrittiva del gioco Herosurv.
 */
export const OURSPACE_GAME_CONFIG = {
    key: "herosurv",
    name: "Herosurv",
    description: "Arena multiplayer veloce con proiettili, power-up, abilita e Ultimate.",
    minPlayers: 2,
    maxPlayers: 10,
    estimatedDurationMinutes: 15,
    arenaWidth: 1700,
    arenaHeight: 1200,
} as const;

/**
 * Colori principali dei quattro personaggi.
 * Questi valori sono pronti per disegnare card lobby, HUD e sagome su Canvas.
 */
export const OURSPACE_CHARACTER_STYLES: Readonly<Record<CharacterKind, CharacterVisualStyle>> = {
    Bull: {
        primaryColor: "#e53935",
        secondaryColor: "#b71c1c",
        accentColor: "#ffcdd2",
        outlineColor: "#b71c1c",
        bodyColor: "#d32f2f",
    },
    Sniper: {
        primaryColor: "#43a047",
        secondaryColor: "#1b5e20",
        accentColor: "#c8e6c9",
        outlineColor: "#1b5e20",
        bodyColor: "#388e3c",
    },
    Healer: {
        primaryColor: "#1e88e5",
        secondaryColor: "#0d47a1",
        accentColor: "#bbdefb",
        outlineColor: "#0d47a1",
        bodyColor: "#1976d2",
    },
    Controller: {
        primaryColor: "#8e24aa",
        secondaryColor: "#4a148c",
        accentColor: "#e1bee7",
        outlineColor: "#4a148c",
        bodyColor: "#7b1fa2",
    },
};

type OurSpaceBasicAttackConfig = {
    name: string;
    description: string;
    damage: number;
    cooldownSeconds: number;
    projectileSpeed: number;
    range: number;
    radius: number;
    pelletCount: number;
    spreadRadians: number;
    color: string;
    slowOnHit?: {
        seconds: number;
        speedMultiplier: number;
    };
};

/**
 * Attacco base dei quattro ruoli.
 * Sono tutti proiettili server-authoritative: visibili, schivabili e bloccati dai muri.
 */
const OURSPACE_BASIC_ATTACKS: Readonly<Record<CharacterKind, OurSpaceBasicAttackConfig>> = {
    Bull: {
        name: "Gancio Energetico",
        description: "Tre colpi corti, forti da vicino.",
        damage: 520,
        cooldownSeconds: 0.68,
        projectileSpeed: 760,
        range: 250,
        radius: 18,
        pelletCount: 3,
        spreadRadians: 0.22,
        color: "#ff7a45",
    },
    Sniper: {
        name: "Dardo Preciso",
        description: "Colpo veloce a lunga gittata.",
        damage: 1120,
        cooldownSeconds: 0.92,
        projectileSpeed: 1120,
        range: 820,
        radius: 9,
        pelletCount: 1,
        spreadRadians: 0,
        color: "#8cff9b",
    },
    Healer: {
        name: "Scintilla Medica",
        description: "Colpo leggero, utile per caricare la Ultimate.",
        damage: 430,
        cooldownSeconds: 0.62,
        projectileSpeed: 820,
        range: 520,
        radius: 13,
        pelletCount: 1,
        spreadRadians: 0,
        color: "#77c8ff",
    },
    Controller: {
        name: "Nucleo Lento",
        description: "Colpo che rallenta chi viene centrato.",
        damage: 560,
        cooldownSeconds: 0.78,
        projectileSpeed: 690,
        range: 470,
        radius: 16,
        pelletCount: 1,
        spreadRadians: 0,
        color: "#d58cff",
        slowOnHit: {
            seconds: 1.15,
            speedMultiplier: 0.72,
        },
    },
};

/**
 * Catalogo dei personaggi previsti dalla lobby di Herosurv.
 * Ogni personaggio mostra vita, attacco base, passiva, abilita attiva e Ultimate.
 */
export const OURSPACE_CHARACTER_CATALOG: ReadonlyArray<{
    kind: CharacterKind;
    displayName: string;
    role: string;
    description: string;
    basicAttack: { name: string; description: string };
    passive: string;
    abilities: ReadonlyArray<{ key: string; name: string; description: string }>;
    ultimate: { key: string; name: string; description: string };
    statsPreview: {
        health: number;
        damage: number;
        range: number;
        speed: number;
        control: number;
        support: number;
    };
    style: CharacterVisualStyle;
    isImplemented: boolean;
}> = [
    {
        kind: "Bull",
        displayName: "Bull",
        role: "Tank",
        description: "Tanta vita, danno forte a corto raggio.",
        basicAttack: {
            name: OURSPACE_BASIC_ATTACKS.Bull.name,
            description: OURSPACE_BASIC_ATTACKS.Bull.description,
        },
        passive: "subisce meno danni fisici.",
        abilities: [
            { key: "", name: "Carica", description: "Scatta, colpisce e stordisce." },
        ],
        ultimate: {
            key: "",
            name: "Furia del Titano",
            description: "Per pochi secondi picchia piu forte e resiste meglio.",
        },
        statsPreview: { health: 5, damage: 3, range: 2, speed: 3, control: 3, support: 1 },
        style: OURSPACE_CHARACTER_STYLES.Bull,
        isImplemented: true,
    },
    {
        kind: "Sniper",
        displayName: "Mira",
        role: "Tiratrice",
        description: "Poca vita, colpi lunghi e precisi.",
        basicAttack: {
            name: OURSPACE_BASIC_ATTACKS.Sniper.name,
            description: OURSPACE_BASIC_ATTACKS.Sniper.description,
        },
        passive: "regge meglio i colpi pesanti.",
        abilities: [
            { key: "", name: "Tiro Preciso", description: "Colpo mirato a lunga distanza." },
        ],
        ultimate: {
            key: "",
            name: "Colpo del Destino",
            description: "Un colpo enorme che fa tanto danno.",
        },
        statsPreview: { health: 2, damage: 5, range: 5, speed: 4, control: 1, support: 1 },
        style: OURSPACE_CHARACTER_STYLES.Sniper,
        isImplemented: true,
    },
    {
        kind: "Healer",
        displayName: "Lumina",
        role: "Supporto",
        description: "Cura gli alleati.",
        basicAttack: {
            name: OURSPACE_BASIC_ATTACKS.Healer.name,
            description: OURSPACE_BASIC_ATTACKS.Healer.description,
        },
        passive: "resiste meglio quando ha poca vita.",
        abilities: [
            { key: "", name: "Cura Mirata", description: "Cura chi ne ha piu bisogno vicino a te." },
        ],
        ultimate: {
            key: "",
            name: "Resonanza Vitale",
            description: "Cura la squadra e mette uno scudo.",
        },
        statsPreview: { health: 3, damage: 2, range: 3, speed: 4, control: 1, support: 5 },
        style: OURSPACE_CHARACTER_STYLES.Healer,
        isImplemented: true,
    },
    {
        kind: "Controller",
        displayName: "Vortice",
        role: "Controllo",
        description: "Rallenta i nemici.",
        basicAttack: {
            name: OURSPACE_BASIC_ATTACKS.Controller.name,
            description: OURSPACE_BASIC_ATTACKS.Controller.description,
        },
        passive: "subisce meno danni speciali.",
        abilities: [
            { key: "", name: "Gelamento", description: "Danno e rallentamento ad area." },
        ],
        ultimate: {
            key: "",
            name: "Buco Nero",
            description: "Area grande che danneggia e rallenta.",
        },
        statsPreview: { health: 4, damage: 3, range: 3, speed: 2, control: 5, support: 2 },
        style: OURSPACE_CHARACTER_STYLES.Controller,
        isImplemented: true,
    },
];

/**
 * Restituisce lo stile visivo di un personaggio.
 * La UI puo usarlo senza conoscere la struttura interna del catalogo.
 */
export function getOurSpaceCharacterStyle(kind: CharacterKind): CharacterVisualStyle {
    return OURSPACE_CHARACTER_STYLES[kind];
}

/**
 * Factory sicura per creare personaggi di Herosurv.
 * Restituisce null per i personaggi non ancora implementati invece di causare un crash.
 */
export function createOurSpaceCharacter(
    kind: CharacterKind,
    id: string,
    startPosition: Vector2,
    teamId: string | null = null
): Character | null {
    if (kind === "Bull") {
        return new Bull(id, startPosition, teamId);
    }

    if (kind === "Sniper") {
        return new Sniper(id, startPosition, teamId);
    }

    if (kind === "Healer") {
        return new Healer(id, startPosition, teamId);
    }

    if (kind === "Controller") {
        return new Controller(id, startPosition, teamId);
    }

    return null;
}

/**
 * Fase corrente della partita.
 * Separare selezione, gioco e fine partita rende il flusso facile da seguire.
 */
type OurSpacePhase = "select" | "play" | "gameOver";

/**
 * Fase interna della lobby multiplayer.
 * Prima si vota la modalita, poi si scelgono i personaggi.
 */
type OurSpaceLobbyStage = "modeVote" | "characterSelect";

/**
 * Modalita disponibili dentro Herosurv.
 * Arraffagemme e a squadre, Sopravvivenza e tutti contro tutti.
 */
type OurSpaceMode = "gemGrab" | "survival";

/**
 * Catalogo delle modalita giocabili.
 * Tenerlo in una struttura unica evita testi duplicati tra lobby, HUD e regole.
 */
const OURSPACE_MODE_CATALOG: ReadonlyArray<{
    id: OurSpaceMode;
    title: string;
    shortTitle: string;
    description: string;
    objective: string;
    color: string;
}> = [
    {
        id: "gemGrab",
        title: "Arraffagemme",
        shortTitle: "Arraffagemme",
        description: "Due squadre si contendono le gemme al centro.",
        objective: "Tieni 10 gemme di squadra e resisti al countdown.",
        color: "#9b5cff",
    },
    {
        id: "survival",
        title: "Sopravvivenza",
        shortTitle: "Sopravvivenza",
        description: "Raccogli power-up, evita la zona e resta in piedi.",
        objective: "La zona sicura si chiude piano piano: resta l'ultimo vivo.",
        color: "#2fbf71",
    },
];

type OurSpacePowerBoxSpawn = {
    x: number;
    y: number;
};

type OurSpaceMapDefinition = {
    name: string;
    width: number;
    height: number;
    safeStartRadius: number;
    walls: readonly ArenaWall[];
    powerBoxes?: readonly OurSpacePowerBoxSpawn[];
};

/**
 * Pool di mappe: ogni partita pesca una variante della modalita.
 */
const OURSPACE_MAP_POOL: Readonly<Record<OurSpaceMode, readonly OurSpaceMapDefinition[]>> = {
    gemGrab: [
        {
            name: "Miniera Gemella",
            width: 1800,
            height: 1260,
            safeStartRadius: 0,
            walls: [
                { x: 420, y: 265, w: 260, h: 80 },
                { x: 1120, y: 265, w: 260, h: 80 },
                { x: 420, y: 915, w: 260, h: 80 },
                { x: 1120, y: 915, w: 260, h: 80 },
                { x: 800, y: 470, w: 70, h: 135 },
                { x: 930, y: 655, w: 70, h: 135 },
                { x: 230, y: 565, w: 210, h: 110 },
                { x: 1360, y: 565, w: 210, h: 110 },
            ],
        },
        {
            name: "Corridoio Centrale",
            width: 1780,
            height: 1240,
            safeStartRadius: 0,
            walls: [
                { x: 520, y: 210, w: 170, h: 90 },
                { x: 1090, y: 210, w: 170, h: 90 },
                { x: 520, y: 940, w: 170, h: 90 },
                { x: 1090, y: 940, w: 170, h: 90 },
                { x: 820, y: 380, w: 140, h: 95 },
                { x: 820, y: 765, w: 140, h: 95 },
                { x: 270, y: 565, w: 235, h: 105 },
                { x: 1275, y: 565, w: 235, h: 105 },
            ],
        },
    ],
    survival: [
        {
            name: "Radure Incrociate",
            width: 2300,
            height: 1650,
            safeStartRadius: 760,
            walls: [
                { x: 420, y: 320, w: 280, h: 90 },
                { x: 1570, y: 320, w: 280, h: 90 },
                { x: 420, y: 1240, w: 280, h: 90 },
                { x: 1570, y: 1240, w: 280, h: 90 },
                { x: 970, y: 370, w: 360, h: 80 },
                { x: 970, y: 1200, w: 360, h: 80 },
                { x: 600, y: 745, w: 250, h: 90 },
                { x: 1450, y: 745, w: 250, h: 90 },
                { x: 1085, y: 735, w: 130, h: 180 },
            ],
            powerBoxes: [
                { x: 740, y: 600 },
                { x: 1560, y: 600 },
                { x: 740, y: 1050 },
                { x: 1560, y: 1050 },
            ],
        },
        {
            name: "Anello Selvatico",
            width: 2200,
            height: 1580,
            safeStartRadius: 720,
            walls: [
                { x: 360, y: 270, w: 300, h: 90 },
                { x: 1540, y: 270, w: 300, h: 90 },
                { x: 360, y: 1220, w: 300, h: 90 },
                { x: 1540, y: 1220, w: 300, h: 90 },
                { x: 925, y: 250, w: 350, h: 80 },
                { x: 925, y: 1250, w: 350, h: 80 },
                { x: 510, y: 720, w: 230, h: 110 },
                { x: 1460, y: 720, w: 230, h: 110 },
            ],
            powerBoxes: [
                { x: 610, y: 520 },
                { x: 1590, y: 520 },
                { x: 610, y: 1060 },
                { x: 1590, y: 1060 },
            ],
        },
    ],
};

const OURSPACE_MAPS: Readonly<Record<OurSpaceMode, OurSpaceMapDefinition>> = {
    gemGrab: OURSPACE_MAP_POOL.gemGrab[0],
    survival: OURSPACE_MAP_POOL.survival[0],
};

const OURSPACE_ASSET_PATHS = {
    groundTile: "/assets/herosurv/ground_01.png",
    groundDetail: "/assets/herosurv/ground_05.png",
    wallTile: "/assets/herosurv/block_06.png",
    crate: "/assets/herosurv/crate_07.png",
    gem: "/assets/herosurv/environment_15.png",
} as const;

type OurSpaceAssetKey = keyof typeof OURSPACE_ASSET_PATHS;

/**
 * Messaggio inviato dal client quando sceglie la modalita.
 * La modalita si sceglie prima del personaggio, dentro lo stesso file di gioco.
 */
type OurSpaceSelectModeMsg = {
    kind: "herosurv_select_mode";
    mode: OurSpaceMode;
};

/**
 * Messaggio inviato dal client quando sceglie un personaggio.
 * Tutti e quattro i ruoli sono selezionabili.
 */
type OurSpaceSelectCharacterMsg = {
    kind: "herosurv_select_character";
    characterKind: CharacterKind;
};

/**
 * Messaggio inviato quando il giocatore conferma di essere pronto.
 * Se tutti sono pronti, la partita parte prima della fine del countdown.
 */
type OurSpaceReadyMsg = {
    kind: "herosurv_ready";
};

/**
 * Messaggio inviato dal client a ogni tick con movimento, mira e azioni.
 * Il server resta autorevole: il client chiede, il server decide cosa succede.
 */
type OurSpaceInputMsg = {
    kind: "herosurv_input";
    moveDirection: Vector2;
    aimDirection: Vector2;
    useBasicAttack: boolean;
    abilityIndex: number | null;
    useUltimate: boolean;
};

/**
 * Unione dei messaggi che il server di Herosurv accetta.
 * Avere tipi distinti riduce gli errori quando il gioco cresce.
 */
type OurSpaceClientMsg = OurSpaceSelectModeMsg | OurSpaceSelectCharacterMsg | OurSpaceReadyMsg | OurSpaceInputMsg;

/**
 * Evento testuale e numerico da mostrare nella UI.
 * Gli eventi sono brevi per non riempire troppo la rete.
 */
type OurSpaceEvent = {
    kind: "info" | "ability" | "damage" | "elimination" | "objective";
    message: string;
    gameTime: number;
    sourceId?: string;
    targetId?: string;
    value?: number;
};

type OurSpaceRoundStats = {
    damageDealt: number;
    damageTaken: number;
    eliminations: number;
    deaths: number;
    gemsCollected: number;
    powerCubesCollected: number;
    shotsFired: number;
    shotsHit: number;
};

/**
 * Stato pubblico di un giocatore.
 * Questo e quello che arriva al client: niente metodi, solo dati serializzabili.
 */
type OurSpacePublicPlayerState = {
    id: string;
    name: string;
    modeVote: OurSpaceMode | null;
    selectedKind: CharacterKind | null;
    isReady: boolean;
    teamId: string | null;
    aimDirection: Vector2;
    score: number;
    heldGems: number;
    powerCubes: number;
    respawnRemainingSeconds: number;
    invulnerabilitySeconds: number;
    isEliminated: boolean;
    character: CharacterSnapshot | null;
    basicAttackName: string | null;
    basicAttackDescription: string | null;
    basicAttackCooldownReadyPercent: number;
    abilityNames: string[];
    abilityDescriptions: string[];
    abilityCooldownReadyPercents: number[];
    ultimateName: string | null;
    ultimateDescription: string | null;
    roundStats: OurSpaceRoundStats;
};

/**
 * Gemma presente sulla mappa in Arraffagemme.
 * Ogni gemma ha id e posizione per essere sincronizzata sul client.
 */
type OurSpaceGemState = {
    id: string;
    position: Vector2;
};

/**
 * Stato pubblico specifico di Arraffagemme.
 * Tiene punteggi, countdown e gemme visibili.
 */
type OurSpaceGemGrabState = {
    gems: OurSpaceGemState[];
    redGems: number;
    blueGems: number;
    countdownTeamId: string | null;
    countdownRemainingSeconds: number;
    targetGems: number;
};

type OurSpacePowerCubeState = {
    id: string;
    position: Vector2;
};

type OurSpacePowerBoxState = {
    id: string;
    position: Vector2;
    radius: number;
    health: number;
    maxHealth: number;
};

/**
 * Stato pubblico specifico di Sopravvivenza.
 * Descrive la zona sicura che si restringe progressivamente.
 */
type OurSpaceSurvivalState = {
    safeCenter: Vector2;
    safeRadius: number;
    nextShrinkHintSeconds: number;
    powerCubes: OurSpacePowerCubeState[];
    powerBoxes: OurSpacePowerBoxState[];
};

type OurSpaceProjectileState = {
    id: string;
    sourceId: string;
    teamId: string | null;
    sourceKind: CharacterKind;
    position: Vector2;
    previousPosition: Vector2;
    direction: Vector2;
    speed: number;
    radius: number;
    rangeRemaining: number;
    damage: number;
    damageKind: DamageKind;
    color: string;
    abilityId: string;
    slowOnHit?: {
        seconds: number;
        speedMultiplier: number;
    };
};

/**
 * Stato pubblico dell'intera partita.
 * Il client lo usa per disegnare arena, giocatori, HUD e schermata finale.
 */
type OurSpacePublicGameState = {
    phase: OurSpacePhase;
    lobbyStage: OurSpaceLobbyStage;
    selectedMode: OurSpaceMode | null;
    modeVotes: Record<OurSpaceMode, number>;
    modeVoteCountdownSeconds: number | null;
    characterSelectCountdownSeconds: number | null;
    arena: ArenaBounds;
    selectedMapName: string | null;
    players: Record<string, OurSpacePublicPlayerState>;
    projectiles: OurSpaceProjectileState[];
    gemGrab: OurSpaceGemGrabState | null;
    survival: OurSpaceSurvivalState | null;
    gameTime: number;
    gameOver: boolean;
    winnerId: string | null;
    requiredPlayersMessage: string | null;
};

/**
 * Messaggio inviato dal server ai client.
 * Contiene sempre una fotografia completa per tollerare pacchetti persi o join tardivi.
 */
type OurSpaceServerMsg = {
    kind: "herosurv_update";
    state: OurSpacePublicGameState;
    events: OurSpaceEvent[];
};

/**
 * Stato interno del server per un giocatore.
 * Qui conserviamo anche input e oggetti Character, che non devono essere inviati direttamente.
 */
type OurSpaceServerPlayer = {
    id: string;
    name: string;
    modeVote: OurSpaceMode | null;
    selectedKind: CharacterKind | null;
    isReady: boolean;
    teamId: string | null;
    character: Character | null;
    inputDirection: Vector2;
    aimDirection: Vector2;
    score: number;
    heldGems: number;
    powerCubes: number;
    basicAttackCooldownSeconds: number;
    respawnRemainingSeconds: number;
    invulnerabilitySeconds: number;
    isEliminated: boolean;
    roundStats: OurSpaceRoundStats;
};

/**
 * Stato grafico interpolato lato client.
 * Serve a rendere fluido il movimento tra un aggiornamento server e il successivo.
 */
type OurSpaceVisualPlayer = {
    x: number;
    y: number;
};

type OurSpaceFloatingText = {
    id: string;
    position: Vector2;
    text: string;
    color: string;
    ageSeconds: number;
    durationSeconds: number;
    riseSpeed: number;
};

type OurSpaceImpactPulse = {
    id: string;
    position: Vector2;
    color: string;
    ageSeconds: number;
    durationSeconds: number;
    radius: number;
};

/**
 * Descrive la finestra di camera usata dal Canvas.
 * La mappa e grande: la camera segue il giocatore invece di comprimere tutto lo scenario.
 */
type OurSpaceArenaView = {
    x: number;
    y: number;
    w: number;
    h: number;
    scale: number;
    worldX: number;
    worldY: number;
    visibleWorldWidth: number;
    visibleWorldHeight: number;
};

/**
 * Numero massimo di eventi mostrati nella UI.
 * Limitare la lista evita testo sovrapposto durante gli scontri.
 */
const OURSPACE_MAX_VISIBLE_EVENTS = 6;

/**
 * Tempo di conferma dopo il raggiungimento della maggioranza sulla modalita.
 * Il countdown evita partenze istantanee se qualcuno cambia idea all'ultimo.
 */
const MODE_VOTE_LOCK_SECONDS = 20;

/**
 * Tempo disponibile per scegliere il personaggio dopo la modalita.
 * Alla fine chi non ha scelto riceve Bull, il personaggio base.
 */
const CHARACTER_SELECT_SECONDS = 50;

/**
 * Configurazione delle regole di Arraffagemme.
 * Sono numeri piccoli e leggibili, facili da bilanciare durante i test.
 */
const GEM_GRAB_TARGET_GEMS = 10;
const GEM_GRAB_COUNTDOWN_SECONDS = 15;
const GEM_GRAB_RESPAWN_SECONDS = 4;
const GEM_GRAB_SPAWN_INTERVAL_SECONDS = 2.1;
const GEM_GRAB_MAX_MAP_GEMS = 12;

/**
 * Configurazione delle regole di Sopravvivenza.
 * La zona parte larga e si chiude lentamente verso il centro.
 */
const SURVIVAL_SHRINK_DELAY_SECONDS = 10;
const SURVIVAL_SHRINK_DURATION_SECONDS = 145;
const SURVIVAL_END_RADIUS = 85;
const SURVIVAL_OUTSIDE_DAMAGE_PER_SECOND = 520;

/**
 * Converte una direzione ricevuta dalla rete in un vettore sicuro.
 * Anche se arriva un messaggio corrotto, il movimento resta stabile.
 */
function sanitizeDirection(direction: Vector2 | undefined): Vector2 {
    if (!direction) {
        return { x: 0, y: 0 };
    }

    return normalizeOrZero({
        x: safeNumber(direction.x, 0),
        y: safeNumber(direction.y, 0),
    });
}

/**
 * Restituisce una posizione di spawn ordinata attorno al centro arena.
 * Distribuire i giocatori evita che inizino tutti sovrapposti.
 */
function getSpawnPosition(index: number, totalPlayers: number, arena: ArenaBounds): Vector2 {
    const safeTotal = Math.max(1, totalPlayers);
    const angle = (Math.PI * 2 * index) / safeTotal;
    const spawnRadius = Math.min(arena.width, arena.height) * 0.38;

    return {
        x: arena.width / 2 + Math.cos(angle) * spawnRadius,
        y: arena.height / 2 + Math.sin(angle) * spawnRadius,
    };
}

function createEmptyRoundStats(): OurSpaceRoundStats {
    return {
        damageDealt: 0,
        damageTaken: 0,
        eliminations: 0,
        deaths: 0,
        gemsCollected: 0,
        powerCubesCollected: 0,
        shotsFired: 0,
        shotsHit: 0,
    };
}

/**
 * Crea un evento di gameplay con tempo di partita.
 * Centralizzare questa funzione mantiene uniforme il log degli eventi.
 */
function createOurSpaceEvent(
    kind: OurSpaceEvent["kind"],
    message: string,
    gameTime: number,
    extra: Partial<OurSpaceEvent> = {}
): OurSpaceEvent {
    return {
        kind,
        message,
        gameTime,
        ...extra,
    };
}

/**
 * Server giocabile di Herosurv.
 * Gestisce selezione, movimento, abilita, obiettivi e condizioni di vittoria.
 */
export class OurSpaceGameServer extends GameServer {
    private arena: ArenaBounds = {
        width: OURSPACE_GAME_CONFIG.arenaWidth,
        height: OURSPACE_GAME_CONFIG.arenaHeight,
        walls: [],
    };
    private players: Record<string, OurSpaceServerPlayer> = {};
    private phase: OurSpacePhase = "select";
    private lobbyStage: OurSpaceLobbyStage = "modeVote";
    private selectedMode: OurSpaceMode | null = null;
    private modeVoteCountdownMode: OurSpaceMode | null = null;
    private modeVoteCountdownSeconds: number | null = null;
    private characterSelectCountdownSeconds: number | null = null;
    private gameTime = 0;
    private gameOver = false;
    private winnerId: string | null = null;
    private pendingEvents: OurSpaceEvent[] = [];
    private gems: OurSpaceGemState[] = [];
    private nextGemId = 1;
    private gemSpawnTimer = 0;
    private countdownTeamId: string | null = null;
    private countdownRemainingSeconds = GEM_GRAB_COUNTDOWN_SECONDS;
    private lastCountdownAnnouncedSecond: number | null = null;
    private survivalSafeRadius = OURSPACE_MAPS.survival.safeStartRadius;
    private survivalStartRadius = OURSPACE_MAPS.survival.safeStartRadius;
    private projectiles: OurSpaceProjectileState[] = [];
    private nextProjectileId = 1;
    private powerCubes: OurSpacePowerCubeState[] = [];
    private powerBoxes: OurSpacePowerBoxState[] = [];
    private nextPowerCubeId = 1;
    private selectedMapName: string | null = null;

    /**
     * Inizializza i giocatori ricevuti dalla lobby.
     */
    public init(players: Record<string, Player>): void {
        this.players = {};
        this.phase = "select";
        this.lobbyStage = "modeVote";
        this.selectedMode = null;
        this.modeVoteCountdownMode = null;
        this.modeVoteCountdownSeconds = null;
        this.characterSelectCountdownSeconds = null;
        this.gameTime = 0;
        this.gameOver = false;
        this.winnerId = null;
        this.gems = [];
        this.nextGemId = 1;
        this.gemSpawnTimer = 0;
        this.countdownTeamId = null;
        this.countdownRemainingSeconds = GEM_GRAB_COUNTDOWN_SECONDS;
        this.lastCountdownAnnouncedSecond = null;
        this.projectiles = [];
        this.nextProjectileId = 1;
        this.powerCubes = [];
        this.powerBoxes = [];
        this.nextPowerCubeId = 1;
        this.selectedMapName = null;
        this.arena = {
            width: OURSPACE_GAME_CONFIG.arenaWidth,
            height: OURSPACE_GAME_CONFIG.arenaHeight,
            walls: [],
        };
        this.survivalSafeRadius = OURSPACE_MAPS.survival.safeStartRadius;
        this.survivalStartRadius = OURSPACE_MAPS.survival.safeStartRadius;
        this.pendingEvents = [
            createOurSpaceEvent("info", "Scegli una modalita, poi scegli il personaggio.", this.gameTime),
        ];

        Object.entries(players).forEach(([id, player]) => {
            this.players[id] = {
                id,
                name: player.name,
                modeVote: null,
                selectedKind: null,
                isReady: false,
                teamId: null,
                character: null,
                inputDirection: { x: 0, y: 0 },
                aimDirection: { x: 1, y: 0 },
                score: 0,
                heldGems: 0,
                powerCubes: 0,
                basicAttackCooldownSeconds: 0,
                respawnRemainingSeconds: 0,
                invulnerabilitySeconds: 0,
                isEliminated: false,
                roundStats: createEmptyRoundStats(),
            };
        });
    }

    /**
     * Esegue un tick server.
     * Il server resta autorevole su movimento, danni, obiettivi e vittoria.
     */
    public tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        const safeDt = safeDeltaTime(dt);

        this.processIncomingMessages(incomingMessages);

        if (!this.gameOver && this.phase === "select") {
            this.updateLobbyCountdowns(safeDt);
        }

        if (!this.gameOver && this.phase === "play") {
            this.gameTime += safeDt;
            this.updateCharacters(safeDt);
            this.updateProjectiles(safeDt);

            if (this.selectedMode === "gemGrab") {
                this.updateGemGrab(safeDt);
            } else if (this.selectedMode === "survival") {
                this.updateSurvival(safeDt);
            }

            this.checkWinCondition();
        }

        const updateMessage: OurSpaceServerMsg = {
            kind: "herosurv_update",
            state: this.createPublicState(),
            events: this.pendingEvents.slice(-OURSPACE_MAX_VISIBLE_EVENTS),
        };

        this.pendingEvents = [];
        return [{ payload: updateMessage }];
    }

    /**
     * Dice alla lobby se la partita e finita.
     * Dopo il messaggio finale il giocatore puo tornare alla lobby con exit.
     */
    public isFinished(): boolean {
        return this.gameOver;
    }

    /**
     * Se un client esce, il server rimuove il suo personaggio e libera gli oggetti portati.
     * In questo modo una partita multiplayer non resta bloccata su un giocatore assente.
     */
    public clientDisconnected(id: string): void {
        const player = this.players[id];

        if (!player) {
            return;
        }

        const playerName = player.name;

        if (this.phase === "play" && player.character && !player.isEliminated) {
            if (this.selectedMode === "gemGrab") {
                this.dropHeldGems(player);
            } else if (this.selectedMode === "survival") {
                this.dropPowerCubes(player);
            }
        }

        delete this.players[id];

        if (this.winnerId === id) {
            this.winnerId = null;
        }

        this.pendingEvents.push(
            createOurSpaceEvent("info", `${playerName} si e disconnesso.`, this.gameTime)
        );

        if (Object.keys(this.players).length === 0) {
            this.gameOver = true;
            this.phase = "gameOver";
        }
    }

    /**
     * Legge tutti i messaggi arrivati dai client.
     * Ogni messaggio viene validato prima di cambiare lo stato.
     */
    private processIncomingMessages(messages: IncomingMsg[]): void {
        for (const message of messages) {
            const player = this.players[message.clientId];

            if (!player) {
                continue;
            }

            const payload = message.payload as Partial<OurSpaceClientMsg>;

            if (payload.kind === "herosurv_select_mode") {
                this.selectMode(player, payload.mode);
            } else if (payload.kind === "herosurv_select_character") {
                this.selectCharacter(player, payload.characterKind);
            } else if (payload.kind === "herosurv_ready") {
                this.confirmReady(player);
            } else if (payload.kind === "herosurv_input") {
                this.updatePlayerInput(player, payload as OurSpaceInputMsg);
            }
        }
    }

    /**
     * Registra il voto modalita di un giocatore.
     * La partita non parte subito: serve la maggioranza e poi un breve countdown.
     */
    private selectMode(player: OurSpaceServerPlayer, mode: OurSpaceMode | undefined): void {
        if (this.phase !== "select" || this.lobbyStage !== "modeVote" || (mode !== "gemGrab" && mode !== "survival")) {
            return;
        }

        const chosenMode = mode === "gemGrab" && !this.isGemGrabAllowed()
            ? "survival"
            : mode;

        if (mode === "gemGrab" && chosenMode === "survival") {
            this.pendingEvents.push(
                createOurSpaceEvent("info", "Arraffagemme richiede 2, 4 o 6 giocatori: voto spostato su Sopravvivenza.", this.gameTime)
            );
        }

        player.modeVote = chosenMode;
        this.pendingEvents.push(
            createOurSpaceEvent(
                "info",
                `${player.name} vota ${chosenMode === "gemGrab" ? "Arraffagemme" : "Sopravvivenza"}.`,
                this.gameTime,
                { sourceId: player.id }
            )
        );
    }

    /**
     * Seleziona il personaggio del giocatore.
     * Tutti i personaggi nel catalogo sono giocabili.
     */
    private selectCharacter(player: OurSpaceServerPlayer, requestedKind: CharacterKind | undefined): void {
        if (this.phase !== "select" || this.lobbyStage !== "characterSelect") {
            return;
        }

        const characterInfo = OURSPACE_CHARACTER_CATALOG.find((info) => info.kind === requestedKind);

        if (!characterInfo || !characterInfo.isImplemented) {
            this.pendingEvents.push(createOurSpaceEvent("info", "Personaggio non disponibile.", this.gameTime));
            return;
        }

        player.selectedKind = characterInfo.kind;
        player.isReady = false;
        this.pendingEvents.push(
            createOurSpaceEvent("info", `${player.name} ha scelto ${characterInfo.displayName}.`, this.gameTime, {
                sourceId: player.id,
            })
        );

    }

    /**
     * Conferma che un giocatore e pronto nella scelta personaggio.
     * Se tutti confermano, saltiamo il resto del countdown.
     */
    private confirmReady(player: OurSpaceServerPlayer): void {
        if (this.phase !== "select" || this.lobbyStage !== "characterSelect") {
            return;
        }

        player.isReady = true;
        this.pendingEvents.push(
            createOurSpaceEvent("info", `${player.name} e pronto.`, this.gameTime, { sourceId: player.id })
        );

        if (Object.values(this.players).every((candidate) => candidate.isReady)) {
            this.startMatch();
        }
    }

    /**
     * Aggiorna i countdown della lobby.
     * La modalita passa a selezione personaggio solo quando una scelta ha la maggioranza.
     */
    private updateLobbyCountdowns(dt: number): void {
        if (this.lobbyStage === "modeVote") {
            const majorityMode = this.getMajorityMode();

            if (majorityMode === null) {
                this.modeVoteCountdownSeconds = null;
                this.modeVoteCountdownMode = null;
                return;
            }

            if (this.modeVoteCountdownSeconds === null || this.modeVoteCountdownMode !== majorityMode) {
                this.modeVoteCountdownMode = majorityMode;
                this.modeVoteCountdownSeconds = MODE_VOTE_LOCK_SECONDS;
                this.pendingEvents.push(
                    createOurSpaceEvent("info", `Maggioranza su ${majorityMode === "gemGrab" ? "Arraffagemme" : "Sopravvivenza"}: countdown modalita.`, this.gameTime)
                );
            }

            this.modeVoteCountdownSeconds = clamp(this.modeVoteCountdownSeconds - dt, 0, MODE_VOTE_LOCK_SECONDS);

            if (this.modeVoteCountdownSeconds <= EPSILON) {
                this.lockMode(majorityMode);
            }

            return;
        }

        if (this.lobbyStage === "characterSelect" && this.selectedMode !== null) {
            this.characterSelectCountdownSeconds = clamp(
                (this.characterSelectCountdownSeconds ?? CHARACTER_SELECT_SECONDS) - dt,
                0,
                CHARACTER_SELECT_SECONDS
            );

            if (this.characterSelectCountdownSeconds <= EPSILON) {
                this.startMatch();
            }
        }
    }

    /**
     * Restituisce la modalita che ha la maggioranza assoluta dei giocatori.
     * Se non c'e maggioranza, la lobby resta in voto.
     */
    private getMajorityMode(): OurSpaceMode | null {
        const playerCount = Object.keys(this.players).length;

        if (playerCount < 2 || playerCount > OURSPACE_GAME_CONFIG.maxPlayers) {
            return null;
        }

        const votes = this.countModeVotes();
        const neededVotes = Math.floor(playerCount / 2) + 1;

        if (this.isGemGrabAllowed() && votes.gemGrab >= neededVotes) {
            return "gemGrab";
        }

        if (votes.survival >= neededVotes) {
            return "survival";
        }

        return null;
    }

    /**
     * Blocca la modalita scelta dalla maggioranza e apre la scelta personaggio.
     * Da qui parte il countdown che assegna Bull a chi non sceglie.
     */
    private lockMode(mode: OurSpaceMode): void {
        this.selectedMode = mode;
        this.applyMapForMode(mode);
        this.lobbyStage = "characterSelect";
        this.modeVoteCountdownMode = null;
        this.modeVoteCountdownSeconds = null;
        this.characterSelectCountdownSeconds = CHARACTER_SELECT_SECONDS;
        this.pendingEvents.push(
            createOurSpaceEvent(
                "info",
                `${mode === "gemGrab" ? "Arraffagemme" : "Sopravvivenza"} scelta. Ora scegli il personaggio.`,
                this.gameTime
            )
        );

        for (const player of Object.values(this.players)) {
            player.isReady = false;
        }
    }

    /**
     * Carica dimensioni e muri della mappa scelta.
     * Arraffagemme e Sopravvivenza hanno layout diversi e coperture diverse.
     */
    private applyMapForMode(mode: OurSpaceMode): void {
        const maps = OURSPACE_MAP_POOL[mode];
        const mapIndex = Math.floor(Math.random() * maps.length);
        const map = maps[mapIndex] ?? OURSPACE_MAPS[mode];

        this.selectedMapName = map.name;
        this.arena = {
            width: map.width,
            height: map.height,
            walls: map.walls.map((wall) => ({ ...wall })),
        };

        if (mode === "survival") {
            this.survivalSafeRadius = map.safeStartRadius;
            this.survivalStartRadius = map.safeStartRadius;
        }
    }

    /**
     * Conta i voti ricevuti per le due modalita.
     * Il client usa gli stessi numeri per mostrare una lobby chiara.
     */
    private countModeVotes(): Record<OurSpaceMode, number> {
        const votes: Record<OurSpaceMode, number> = {
            gemGrab: 0,
            survival: 0,
        };

        for (const player of Object.values(this.players)) {
            if (player.modeVote !== null) {
                votes[player.modeVote] += 1;
            }
        }

        return votes;
    }

    /**
     * Arraffagemme e disponibile solo con squadre pari e massimo 6 giocatori.
     * Se la lobby e dispari o troppo grande, resta disponibile solo Sopravvivenza.
     */
    private isGemGrabAllowed(): boolean {
        const playerCount = Object.keys(this.players).length;
        return playerCount >= 2 && playerCount <= 6 && playerCount % 2 === 0;
    }

    /**
     * Restituisce un messaggio se la modalita non ha abbastanza giocatori.
     * In questo modo una partita in singolo non parte per sbaglio.
     */
    private getRequiredPlayersMessage(): string | null {
        const playerCount = Object.keys(this.players).length;

        if (playerCount < 2) {
            return "Servono almeno 2 giocatori.";
        }

        if (playerCount > OURSPACE_GAME_CONFIG.maxPlayers) {
            return "Herosurv supporta massimo 10 giocatori.";
        }

        return null;
    }

    /**
     * Avvia la partita creando i Character e assegnando squadre/spawn.
     * In Arraffagemme alterniamo rosso/blu per bilanciare anche lobby numerose.
     */
    private startMatch(): void {
        if (this.selectedMode === null || this.gameOver || this.phase !== "select") {
            return;
        }

        const allPlayers = Object.values(this.players);

        this.projectiles = [];
        this.gems = [];
        this.powerCubes = [];
        this.powerBoxes = [];
        this.nextProjectileId = 1;
        this.nextPowerCubeId = 1;
        this.countdownTeamId = null;
        this.countdownRemainingSeconds = GEM_GRAB_COUNTDOWN_SECONDS;
        this.lastCountdownAnnouncedSecond = null;

        allPlayers.forEach((player, index) => {
            player.teamId = this.selectedMode === "gemGrab" ? (index % 2 === 0 ? "red" : "blue") : null;
            player.heldGems = 0;
            player.powerCubes = 0;
            player.score = 0;
            player.basicAttackCooldownSeconds = 0;
            player.respawnRemainingSeconds = 0;
            player.invulnerabilitySeconds = 0.45;
            player.isEliminated = false;
            player.roundStats = createEmptyRoundStats();

            const spawnPosition = this.getPlayerSpawnPosition(player, index, allPlayers.length);
            const selectedKind = player.selectedKind ?? "Bull";
            player.selectedKind = selectedKind;
            player.character = createOurSpaceCharacter(selectedKind, player.id, spawnPosition, player.teamId)
                ?? createOurSpaceCharacter("Bull", player.id, spawnPosition, player.teamId);
        });

        this.phase = "play";
        if (this.selectedMode === "gemGrab") {
            this.spawnGem();
        } else {
            this.initializePowerBoxes();
        }
        this.pendingEvents.push(
            createOurSpaceEvent(
                "info",
                `Partita iniziata${this.selectedMapName ? ` su ${this.selectedMapName}` : ""}: mouse attacca, WASD muove, 1 abilita, Spazio Ultimate.`,
                this.gameTime
            )
        );
    }

    /**
     * Calcola lo spawn in base alla modalita.
     * Le squadre partono ai lati, la Sopravvivenza usa punti attorno al centro.
     */
    private getPlayerSpawnPosition(player: OurSpaceServerPlayer, index: number, totalPlayers: number): Vector2 {
        if (this.selectedMode === "gemGrab") {
            const teamPlayers = Object.values(this.players).filter((candidate) => candidate.teamId === player.teamId);
            const teamIndex = teamPlayers.findIndex((candidate) => candidate.id === player.id);
            const laneOffset = (teamIndex - (teamPlayers.length - 1) / 2) * 118;

            return {
                x: player.teamId === "red" ? 145 : this.arena.width - 145,
                y: this.arena.height / 2 + laneOffset,
            };
        }

        return getSpawnPosition(index, totalPlayers, this.arena);
    }

    /**
     * Aggiorna input, mira e richieste di abilita di un giocatore.
     * I giocatori in respawn o eliminati non possono agire.
     */
    private updatePlayerInput(player: OurSpaceServerPlayer, payload: OurSpaceInputMsg): void {
        if (this.phase !== "play" || !player.character || player.isEliminated || player.respawnRemainingSeconds > 0) {
            return;
        }

        player.inputDirection = sanitizeDirection(payload.moveDirection);
        player.aimDirection = sanitizeDirection(payload.aimDirection);

        if (payload.useBasicAttack) {
            this.tryUseBasicAttack(player);
        }

        if (typeof payload.abilityIndex === "number") {
            this.tryUseActiveAbility(player, payload.abilityIndex);
        }

        if (payload.useUltimate) {
            this.tryUseUltimate(player);
        }
    }

    /**
     * Aggiorna movimento, cooldown e respawn.
     * In Arraffagemme il respawn e temporaneo; in Sopravvivenza e permanente.
     */
    private updateCharacters(dt: number): void {
        const collisionArena = this.getCollisionArena();

        for (const player of Object.values(this.players)) {
            if (!player.character) {
                continue;
            }

            player.basicAttackCooldownSeconds = clamp(player.basicAttackCooldownSeconds - dt, 0, Number.POSITIVE_INFINITY);
            player.invulnerabilitySeconds = clamp(player.invulnerabilitySeconds - dt, 0, RESPAWN_INVULNERABILITY_SECONDS);

            if (player.respawnRemainingSeconds > 0) {
                player.respawnRemainingSeconds = clamp(player.respawnRemainingSeconds - dt, 0, GEM_GRAB_RESPAWN_SECONDS);

                if (player.respawnRemainingSeconds <= EPSILON) {
                    player.isEliminated = false;
                    player.character.reviveAt(this.getPlayerSpawnPosition(player, 0, 1), this.arena);
                    player.invulnerabilitySeconds = RESPAWN_INVULNERABILITY_SECONDS;
                    this.pendingEvents.push(
                        createOurSpaceEvent("info", `${player.name} rientra in campo.`, this.gameTime, { sourceId: player.id })
                    );
                }

                continue;
            }

            if (player.isEliminated) {
                continue;
            }

            player.character.update(dt, player.inputDirection, collisionArena, player.basicAttackCooldownSeconds > EPSILON);
        }
    }

    /**
     * Crea l'arena usata solo per le collisioni dei personaggi.
     * Le casse bloccano il movimento, ma restano colpibili dai proiettili.
     */
    private getCollisionArena(): ArenaBounds {
        if (this.selectedMode !== "survival" || this.powerBoxes.length === 0) {
            return this.arena;
        }

        return {
            ...this.arena,
            blockers: this.powerBoxes.map((box) => ({
                x: box.position.x - box.radius,
                y: box.position.y - box.radius,
                w: box.radius * 2,
                h: box.radius * 2,
            })),
        };
    }

    /**
     * Aggiorna le regole di Arraffagemme.
     * Genera gemme, raccoglie gemme e gestisce il countdown di vittoria.
     */
    private updateGemGrab(dt: number): void {
        this.gemSpawnTimer += dt;

        if (this.gemSpawnTimer >= GEM_GRAB_SPAWN_INTERVAL_SECONDS && this.gems.length < GEM_GRAB_MAX_MAP_GEMS) {
            this.gemSpawnTimer = 0;
            this.spawnGem();
        }

        this.collectGems();
        this.updateGemCountdown(dt);
    }

    /**
     * Crea una gemma vicino al centro.
     * La piccola variazione evita sovrapposizioni perfette.
     */
    private spawnGem(): void {
        if (this.selectedMode !== "gemGrab") {
            return;
        }

        const wobble = (this.nextGemId % 7) - 3;
        this.gems.push({
            id: `gem-${this.nextGemId}`,
            position: {
                x: this.arena.width / 2 + wobble * 28,
                y: this.arena.height / 2 + ((this.nextGemId * 37) % 7 - 3) * 22,
            },
        });
        this.nextGemId += 1;
    }

    /**
     * Raccoglie le gemme quando un giocatore vivo le tocca.
     * Le gemme restano portate dal giocatore finche non viene eliminato.
     */
    private collectGems(): void {
        for (const player of Object.values(this.players)) {
            if (!player.character || player.isEliminated || player.respawnRemainingSeconds > 0) {
                continue;
            }

            const playerPosition = player.character.getPosition();
            const remainingGems: OurSpaceGemState[] = [];

            for (const gem of this.gems) {
                const canCollect = distanceBetween(playerPosition, gem.position) <= player.character.stats.radius + 18;

                if (canCollect) {
                    player.heldGems += 1;
                    player.roundStats.gemsCollected += 1;
                    this.pendingEvents.push(
                        createOurSpaceEvent("objective", `${player.name} raccoglie una gemma.`, this.gameTime, {
                            sourceId: player.id,
                        })
                    );
                } else {
                    remainingGems.push(gem);
                }
            }

            this.gems = remainingGems;
        }
    }

    /**
     * Aggiorna il countdown di Arraffagemme.
     * Una squadra deve tenere almeno 10 gemme fino allo scadere.
     */
    private updateGemCountdown(dt: number): void {
        const redGems = this.getTeamHeldGems("red");
        const blueGems = this.getTeamHeldGems("blue");
        const leadingTeam = redGems >= GEM_GRAB_TARGET_GEMS
            ? "red"
            : blueGems >= GEM_GRAB_TARGET_GEMS
                ? "blue"
                : null;

        if (leadingTeam === null) {
            if (this.countdownTeamId !== null) {
                this.pendingEvents.push(
                    createOurSpaceEvent("objective", "Countdown interrotto: le gemme sono cadute.", this.gameTime)
                );
            }
            this.countdownTeamId = null;
            this.countdownRemainingSeconds = GEM_GRAB_COUNTDOWN_SECONDS;
            this.lastCountdownAnnouncedSecond = null;
            return;
        }

        if (this.countdownTeamId !== leadingTeam) {
            this.countdownTeamId = leadingTeam;
            this.countdownRemainingSeconds = GEM_GRAB_COUNTDOWN_SECONDS;
            this.lastCountdownAnnouncedSecond = Math.ceil(GEM_GRAB_COUNTDOWN_SECONDS);
            this.pendingEvents.push(
                createOurSpaceEvent("objective", `${this.getTeamName(leadingTeam)} ha 10 gemme: parte il countdown!`, this.gameTime)
            );
        }

        this.countdownRemainingSeconds = clamp(this.countdownRemainingSeconds - dt, 0, GEM_GRAB_COUNTDOWN_SECONDS);
        const countdownSecond = Math.ceil(this.countdownRemainingSeconds);

        if (countdownSecond <= 5 && countdownSecond > 0 && countdownSecond !== this.lastCountdownAnnouncedSecond) {
            this.lastCountdownAnnouncedSecond = countdownSecond;
            this.pendingEvents.push(
                createOurSpaceEvent("objective", `${countdownSecond}...`, this.gameTime, {
                    sourceId: leadingTeam,
                    value: countdownSecond,
                })
            );
        }

        if (this.countdownRemainingSeconds <= EPSILON) {
            this.endGameForTeam(leadingTeam);
        }
    }

    /**
     * Aggiorna la zona di Sopravvivenza.
     * Dopo un breve delay il raggio si restringe lentamente verso il centro.
     */
    private updateSurvival(dt: number): void {
        const mapStartRadius = this.survivalStartRadius;
        const shrinkTime = clamp(this.gameTime - SURVIVAL_SHRINK_DELAY_SECONDS, 0, SURVIVAL_SHRINK_DURATION_SECONDS);
        const shrinkRatio = shrinkTime / SURVIVAL_SHRINK_DURATION_SECONDS;
        this.survivalSafeRadius = mapStartRadius + (SURVIVAL_END_RADIUS - mapStartRadius) * shrinkRatio;

        for (const player of Object.values(this.players)) {
            if (!player.character || player.isEliminated) {
                continue;
            }

            const distanceFromCenter = distanceBetween(player.character.getPosition(), this.getSurvivalCenter());

            if (distanceFromCenter > this.survivalSafeRadius) {
                const damage = player.character.receiveDamage(SURVIVAL_OUTSIDE_DAMAGE_PER_SECOND * dt, "true");

                if (damage > EPSILON && !player.character.isAlive()) {
                    this.eliminatePlayer(player, null);
                }
            }
        }

        this.collectPowerCubes();
    }

    /**
     * Crea le casse power-up della mappa di Sopravvivenza.
     * Sono bersagli neutrali: vanno distrutti con l'attacco base.
     */
    private initializePowerBoxes(): void {
        const map = OURSPACE_MAP_POOL.survival.find((candidate) => candidate.name === this.selectedMapName)
            ?? OURSPACE_MAPS.survival;
        const spawns = map.powerBoxes ?? [];

        this.powerBoxes = spawns.map((spawn, index) => {
            return {
                id: `box-${index + 1}`,
                position: { x: spawn.x, y: spawn.y },
                radius: 34,
                health: 1800,
                maxHealth: 1800,
            };
        });
    }

    /**
     * Raccoglie i power-up lasciati dalle casse distrutte.
     */
    private collectPowerCubes(): void {
        for (const player of Object.values(this.players)) {
            if (!player.character || player.isEliminated) {
                continue;
            }

            const playerPosition = player.character.getPosition();
            const remainingCubes: OurSpacePowerCubeState[] = [];

            for (const cube of this.powerCubes) {
                const canCollect = distanceBetween(playerPosition, cube.position) <= player.character.stats.radius + 18;

                if (canCollect) {
                    player.powerCubes += 1;
                    player.roundStats.powerCubesCollected += 1;
                    player.character.addPowerCube();
                    this.pendingEvents.push(
                        createOurSpaceEvent("objective", `${player.name} raccoglie un power-up.`, this.gameTime, {
                            sourceId: player.id,
                        })
                    );
                } else {
                    remainingCubes.push(cube);
                }
            }

            this.powerCubes = remainingCubes;
        }
    }

    /**
     * Usa l'attacco base del personaggio.
     * Il server crea proiettili reali con cooldown e spread diversi per ruolo.
     */
    private tryUseBasicAttack(player: OurSpaceServerPlayer): void {
        if (!player.character || player.basicAttackCooldownSeconds > EPSILON) {
            return;
        }

        const config = OURSPACE_BASIC_ATTACKS[player.character.kind];
        const aimDirection = vectorLength(player.aimDirection) > EPSILON
            ? normalizeOrZero(player.aimDirection)
            : player.character.getFacingDirection();
        const pelletCount = Math.max(1, config.pelletCount);
        const spreadStep = pelletCount > 1 ? config.spreadRadians / (pelletCount - 1) : 0;
        const startAngle = pelletCount > 1 ? -config.spreadRadians / 2 : 0;

        player.basicAttackCooldownSeconds = config.cooldownSeconds;
        player.roundStats.shotsFired += pelletCount;

        for (let i = 0; i < pelletCount; i += 1) {
            const projectileDirection = rotateVector(aimDirection, startAngle + spreadStep * i);
            this.spawnBasicProjectile(player, config, projectileDirection);
        }
    }

    /**
     * Crea un singolo proiettile dell'attacco base.
     */
    private spawnBasicProjectile(
        player: OurSpaceServerPlayer,
        config: OurSpaceBasicAttackConfig,
        direction: Vector2
    ): void {
        if (!player.character) {
            return;
        }

        const startPosition = player.character.getPosition();
        const offset = player.character.stats.radius + config.radius + 4;
        const position = {
            x: startPosition.x + direction.x * offset,
            y: startPosition.y + direction.y * offset,
        };

        this.projectiles.push({
            id: `shot-${this.nextProjectileId}`,
            sourceId: player.id,
            teamId: player.teamId,
            sourceKind: player.character.kind,
            position,
            previousPosition: copyVector(position),
            direction,
            speed: config.projectileSpeed,
            radius: config.radius,
            rangeRemaining: config.range,
            damage: config.damage,
            damageKind: "physical",
            color: config.color,
            abilityId: "basic-attack",
            slowOnHit: config.slowOnHit,
        });
        this.nextProjectileId += 1;
    }

    /**
     * Muove i proiettili e risolve collisioni con muri, casse e giocatori.
     */
    private updateProjectiles(dt: number): void {
        const remainingProjectiles: OurSpaceProjectileState[] = [];

        for (const projectile of this.projectiles) {
            const travelDistance = Math.min(projectile.rangeRemaining, projectile.speed * dt);
            const previousPosition = copyVector(projectile.position);
            const nextPosition = {
                x: projectile.position.x + projectile.direction.x * travelDistance,
                y: projectile.position.y + projectile.direction.y * travelDistance,
            };

            projectile.previousPosition = previousPosition;
            projectile.position = nextPosition;
            projectile.rangeRemaining -= travelDistance;

            if (this.projectileHitsWall(projectile, previousPosition, nextPosition)) {
                continue;
            }

            if (this.selectedMode === "survival" && this.projectileHitsPowerBox(projectile, previousPosition, nextPosition)) {
                continue;
            }

            if (this.projectileHitsPlayer(projectile, previousPosition, nextPosition)) {
                continue;
            }

            const stillInsideArena = nextPosition.x >= -projectile.radius
                && nextPosition.y >= -projectile.radius
                && nextPosition.x <= this.arena.width + projectile.radius
                && nextPosition.y <= this.arena.height + projectile.radius;

            if (projectile.rangeRemaining > EPSILON && stillInsideArena) {
                remainingProjectiles.push(projectile);
            }
        }

        this.projectiles = remainingProjectiles;
    }

    private projectileHitsWall(projectile: OurSpaceProjectileState, start: Vector2, end: Vector2): boolean {
        return this.arena.walls.some((wall) => {
            if (!segmentIntersectsWall(start, end, wall)) {
                return false;
            }

            this.pendingEvents.push(
                createOurSpaceEvent("ability", "Colpo bloccato dalla copertura.", this.gameTime, {
                    sourceId: projectile.sourceId,
                })
            );
            return true;
        });
    }

    private projectileHitsPowerBox(projectile: OurSpaceProjectileState, start: Vector2, end: Vector2): boolean {
        for (const box of this.powerBoxes) {
            const hitDistance = distancePointToSegment(box.position, start, end);

            if (hitDistance > box.radius + projectile.radius) {
                continue;
            }

            box.health = clamp(box.health - projectile.damage, 0, box.maxHealth);

            if (box.health <= EPSILON) {
                this.powerCubes.push({
                    id: `cube-${this.nextPowerCubeId}`,
                    position: copyVector(box.position),
                });
                this.nextPowerCubeId += 1;
                this.powerBoxes = this.powerBoxes.filter((candidate) => candidate.id !== box.id);
                this.pendingEvents.push(
                    createOurSpaceEvent("objective", "Una cassa lascia cadere un power-up.", this.gameTime, {
                        sourceId: projectile.sourceId,
                    })
                );
            }

            return true;
        }

        return false;
    }

    private projectileHitsPlayer(projectile: OurSpaceProjectileState, start: Vector2, end: Vector2): boolean {
        const source = this.players[projectile.sourceId];

        if (!source?.character) {
            return true;
        }

        for (const target of Object.values(this.players)) {
            if (!target.character || target.id === projectile.sourceId || target.isEliminated || target.invulnerabilitySeconds > EPSILON) {
                continue;
            }

            if (this.selectedMode === "gemGrab" && target.teamId === projectile.teamId) {
                continue;
            }

            const targetPosition = target.character.getPosition();
            const hitDistance = distancePointToSegment(targetPosition, start, end);

            if (hitDistance > target.character.stats.radius + projectile.radius) {
                continue;
            }

            if (projectile.slowOnHit) {
                target.character.addTimedEffect({
                    id: "basic-slow",
                    name: "Rallentato",
                    remainingSeconds: projectile.slowOnHit.seconds,
                    speedMultiplier: projectile.slowOnHit.speedMultiplier,
                });
            }

            const damageEvent = source.character.dealDamage(
                target.character,
                projectile.damage,
                projectile.damageKind,
                projectile.abilityId
            );

            this.recordDamageEvent(damageEvent);
            source.roundStats.shotsHit += damageEvent.amount > EPSILON ? 1 : 0;

            if (damageEvent.amount > EPSILON) {
                this.pendingEvents.push(
                    createOurSpaceEvent(
                        "damage",
                        `${source.name} colpisce ${target.name} per ${Math.round(damageEvent.amount)}.`,
                        this.gameTime,
                        {
                            sourceId: damageEvent.sourceId,
                            targetId: damageEvent.targetId,
                            value: damageEvent.amount,
                        }
                    )
                );
            }

            if (!target.character.isAlive() && !target.isEliminated) {
                this.eliminatePlayer(target, source);
            }

            return true;
        }

        return false;
    }

    /**
     * Prova a usare l'abilita attiva del personaggio.
     * Il server passa sia nemici sia alleati, cosi ogni ruolo ha il suo kit completo.
     */
    private tryUseActiveAbility(player: OurSpaceServerPlayer, abilityIndex: number): void {
        if (!player.character || abilityIndex < 0 || abilityIndex >= player.character.activeAbilities.length) {
            return;
        }

        const ability = player.character.activeAbilities[abilityIndex];
        const collisionArena = this.getCollisionArena();
        const result = ability.tryUse({
            caster: player.character,
            targets: this.getEnemyCharacters(player.id),
            allies: this.getAllyCharacters(player.id),
            aimDirection: player.aimDirection,
            arena: collisionArena,
        });

        this.handleAbilityResult(player, result);
    }

    /**
     * Prova a usare la Ultimate.
     * Se non e carica, il server restituisce un messaggio chiaro.
     */
    private tryUseUltimate(player: OurSpaceServerPlayer): void {
        if (!player.character) {
            return;
        }

        const collisionArena = this.getCollisionArena();
        const result = player.character.ultimate.tryUse({
            caster: player.character,
            targets: this.getEnemyCharacters(player.id),
            allies: this.getAllyCharacters(player.id),
            aimDirection: player.aimDirection,
            arena: collisionArena,
        });

        this.handleAbilityResult(player, result);
    }

    /**
     * Aggiorna le statistiche round dopo un danno effettivo.
     */
    private recordDamageEvent(damageEvent: DamageEvent): void {
        if (damageEvent.amount <= EPSILON) {
            return;
        }

        const source = this.players[damageEvent.sourceId];
        const target = this.players[damageEvent.targetId];

        if (source) {
            source.roundStats.damageDealt += damageEvent.amount;
        }

        if (target) {
            target.roundStats.damageTaken += damageEvent.amount;
        }
    }

    /**
     * Converte il risultato di una abilita in eventi e controlli di eliminazione.
     * Anche i fallimenti vengono spiegati, cosi il giocatore capisce cosa manca.
     */
    private handleAbilityResult(player: OurSpaceServerPlayer, result: AbilityUseResult): void {
        if (!result.activated) {
            this.pendingEvents.push(
                createOurSpaceEvent("info", `${player.name}: ${result.reason}`, this.gameTime, { sourceId: player.id })
            );
            return;
        }

        this.pendingEvents.push(
            createOurSpaceEvent("ability", `${player.name}: ${result.reason}`, this.gameTime, { sourceId: player.id })
        );

        for (const damageEvent of result.damageEvents) {
            if (damageEvent.amount <= EPSILON) {
                continue;
            }

            const target = this.players[damageEvent.targetId];
            this.recordDamageEvent(damageEvent);

            this.pendingEvents.push(
                createOurSpaceEvent(
                    "damage",
                    `${player.name} infligge ${Math.round(damageEvent.amount)} danni.`,
                    this.gameTime,
                    {
                        sourceId: damageEvent.sourceId,
                        targetId: damageEvent.targetId,
                        value: damageEvent.amount,
                    }
                )
            );

            if (target?.character && !target.character.isAlive() && !target.isEliminated) {
                this.eliminatePlayer(target, player);
            }
        }
    }

    /**
     * Elimina un giocatore.
     * In Arraffagemme lascia cadere le gemme e prepara il respawn; in Sopravvivenza e definitivo.
     */
    private eliminatePlayer(target: OurSpaceServerPlayer, attacker: OurSpaceServerPlayer | null): void {
        target.isEliminated = true;
        target.inputDirection = { x: 0, y: 0 };
        target.roundStats.deaths += 1;

        if (attacker) {
            attacker.score += 1;
            attacker.roundStats.eliminations += 1;
        }

        if (this.selectedMode === "gemGrab") {
            this.dropHeldGems(target);
            target.respawnRemainingSeconds = GEM_GRAB_RESPAWN_SECONDS;
        } else if (this.selectedMode === "survival") {
            this.dropPowerCubes(target);
        }

        this.pendingEvents.push(
            createOurSpaceEvent("elimination", `${target.name} e stato eliminato.`, this.gameTime, {
                sourceId: attacker?.id,
                targetId: target.id,
            })
        );
    }

    /**
     * Fa cadere le gemme del giocatore eliminato.
     * Le posizioniamo in cerchio per renderle raccoglibili e leggibili.
     */
    private dropHeldGems(player: OurSpaceServerPlayer): void {
        if (!player.character || player.heldGems <= 0) {
            return;
        }

        const center = player.character.getPosition();

        for (let i = 0; i < player.heldGems; i += 1) {
            this.gems.push({
                id: `gem-${this.nextGemId}`,
                position: this.getDropPosition(center, i, player.heldGems, 28),
            });
            this.nextGemId += 1;
        }

        player.heldGems = 0;
    }

    /**
     * In Sopravvivenza un eliminato lascia a terra meta dei power-up.
     * Il floor sui numeri dispari rende la regola facile da verificare.
     */
    private dropPowerCubes(player: OurSpaceServerPlayer): void {
        if (!player.character || player.powerCubes <= 1) {
            return;
        }

        const dropCount = Math.floor(player.powerCubes / 2);
        const removed = player.character.removePowerCubes(dropCount);

        if (removed <= 0) {
            return;
        }

        const center = player.character.getPosition();
        player.powerCubes = Math.max(0, player.powerCubes - removed);

        for (let i = 0; i < removed; i += 1) {
            this.powerCubes.push({
                id: `cube-${this.nextPowerCubeId}`,
                position: this.getDropPosition(center, i, removed, 34),
            });
            this.nextPowerCubeId += 1;
        }

        this.pendingEvents.push(
            createOurSpaceEvent("objective", `${player.name} lascia cadere ${removed} power-up.`, this.gameTime, {
                sourceId: player.id,
            })
        );
    }

    /**
     * Calcola posizioni ordinate attorno al punto di morte, senza uscire dall'arena.
     */
    private getDropPosition(center: Vector2, index: number, total: number, distance: number): Vector2 {
        const angle = (Math.PI * 2 * index) / Math.max(1, total);

        return {
            x: clamp(center.x + Math.cos(angle) * distance, 30, this.arena.width - 30),
            y: clamp(center.y + Math.sin(angle) * distance, 30, this.arena.height - 30),
        };
    }

    /**
     * Restituisce i Character nemici validi per abilita e Ultimate.
     * In Sopravvivenza tutti gli altri giocatori sono nemici.
     */
    private getEnemyCharacters(sourceId: string): Character[] {
        const source = this.players[sourceId];

        return Object.values(this.players)
            .filter((player) => {
                if (
                    player.id === sourceId
                    || !player.character
                    || player.isEliminated
                    || player.respawnRemainingSeconds > 0
                    || player.invulnerabilitySeconds > EPSILON
                ) {
                    return false;
                }

                if (this.selectedMode === "gemGrab") {
                    return player.teamId !== source?.teamId;
                }

                return true;
            })
            .map((player) => player.character!);
    }

    /**
     * Restituisce i Character alleati validi.
     * Include il caster, cosi cure e scudi possono sempre funzionare su se stessi.
     */
    private getAllyCharacters(sourceId: string): Character[] {
        const source = this.players[sourceId];

        return Object.values(this.players)
            .filter((player) => {
                if (!player.character || player.isEliminated || player.respawnRemainingSeconds > 0) {
                    return false;
                }

                if (this.selectedMode === "gemGrab") {
                    return player.teamId === source?.teamId;
                }

                return player.id === sourceId;
            })
            .map((player) => player.character!);
    }

    /**
     * Controlla le condizioni di vittoria della modalita corrente.
     * Arraffagemme usa il countdown, Sopravvivenza l'ultimo vivo.
     */
    private checkWinCondition(): void {
        if (this.gameOver) {
            return;
        }

        if (this.selectedMode === "gemGrab") {
            const redHasPlayers = Object.values(this.players).some((player) => player.teamId === "red");
            const blueHasPlayers = Object.values(this.players).some((player) => player.teamId === "blue");

            if (redHasPlayers && !blueHasPlayers) {
                this.endGameForTeam("red");
            } else if (blueHasPlayers && !redHasPlayers) {
                this.endGameForTeam("blue");
            }

            return;
        }

        if (this.selectedMode === "survival") {
            const alivePlayers = Object.values(this.players).filter((player) => {
                return player.character !== null && player.character.isAlive() && !player.isEliminated;
            });

            if (alivePlayers.length <= 1) {
                this.gameOver = true;
                this.phase = "gameOver";
                this.winnerId = alivePlayers[0]?.id ?? null;
                const message = this.winnerId
                    ? `${this.players[this.winnerId].name} resta per ultimo: vittoria in Sopravvivenza!`
                    : "Sopravvivenza finisce in pareggio: nessuno resta in piedi.";
                this.pendingEvents.push(createOurSpaceEvent("objective", message, this.gameTime, { sourceId: this.winnerId ?? undefined }));
            }
        }
    }

    /**
     * Termina Arraffagemme per la squadra vincente.
     * Il vincitore pubblico e il giocatore con piu gemme nella squadra.
     */
    private endGameForTeam(teamId: string): void {
        this.gameOver = true;
        this.phase = "gameOver";
        const winningPlayers = Object.values(this.players).filter((player) => player.teamId === teamId);
        winningPlayers.sort((a, b) => b.heldGems - a.heldGems || b.score - a.score);
        this.winnerId = winningPlayers[0]?.id ?? null;
        this.pendingEvents.push(
            createOurSpaceEvent("objective", `${this.getTeamName(teamId)} vince Arraffagemme: countdown completato!`, this.gameTime, {
                sourceId: this.winnerId ?? undefined,
            })
        );
    }

    /**
     * Somma le gemme tenute dai giocatori vivi e in respawn della squadra.
     * Le gemme cadute a terra non contano per il countdown.
     */
    private getTeamHeldGems(teamId: string): number {
        return Object.values(this.players)
            .filter((player) => player.teamId === teamId)
            .reduce((total, player) => total + player.heldGems, 0);
    }

    /**
     * Restituisce un nome squadra leggibile.
     * Evita di mostrare id tecnici come "red" o "blue" nella UI.
     */
    private getTeamName(teamId: string): string {
        return teamId === "red" ? "Squadra Rossa" : "Squadra Blu";
    }

    /**
     * Restituisce il centro della zona sicura in Sopravvivenza.
     * Per ora resta al centro per chiarezza didattica.
     */
    private getSurvivalCenter(): Vector2 {
        return {
            x: this.arena.width / 2,
            y: this.arena.height / 2,
        };
    }

    /**
     * Crea lo stato pubblico da inviare ai client.
     * Ogni giocatore viene trasformato in dati serializzabili.
     */
    private createPublicState(): OurSpacePublicGameState {
        const publicPlayers: Record<string, OurSpacePublicPlayerState> = {};

        for (const player of Object.values(this.players)) {
            publicPlayers[player.id] = {
                id: player.id,
                name: player.name,
                modeVote: player.modeVote,
                selectedKind: player.selectedKind,
                isReady: player.isReady,
                teamId: player.teamId,
                aimDirection: player.aimDirection,
                score: player.score,
                heldGems: player.heldGems,
                powerCubes: player.powerCubes,
                respawnRemainingSeconds: player.respawnRemainingSeconds,
                invulnerabilitySeconds: player.invulnerabilitySeconds,
                isEliminated: player.isEliminated,
                character: player.character ? player.character.getSnapshot() : null,
                basicAttackName: player.character ? OURSPACE_BASIC_ATTACKS[player.character.kind].name : null,
                basicAttackDescription: player.character ? OURSPACE_BASIC_ATTACKS[player.character.kind].description : null,
                basicAttackCooldownReadyPercent: player.character
                    ? clamp((1 - player.basicAttackCooldownSeconds / OURSPACE_BASIC_ATTACKS[player.character.kind].cooldownSeconds) * 100, 0, 100)
                    : 0,
                abilityNames: player.character ? player.character.activeAbilities.map((ability) => ability.name) : [],
                abilityDescriptions: player.character ? player.character.activeAbilities.map((ability) => ability.description) : [],
                abilityCooldownReadyPercents: player.character
                    ? player.character.activeAbilities.map((ability) => ability.getCooldownReadyPercent())
                    : [],
                ultimateName: player.character ? player.character.ultimate.name : null,
                ultimateDescription: player.character ? player.character.ultimate.description : null,
                roundStats: { ...player.roundStats },
            };
        }

        return {
            phase: this.phase,
            lobbyStage: this.lobbyStage,
            selectedMode: this.selectedMode,
            modeVotes: this.countModeVotes(),
            modeVoteCountdownSeconds: this.modeVoteCountdownSeconds,
            characterSelectCountdownSeconds: this.characterSelectCountdownSeconds,
            arena: this.arena,
            selectedMapName: this.selectedMapName,
            players: publicPlayers,
            projectiles: this.projectiles.map((projectile) => ({
                ...projectile,
                position: copyVector(projectile.position),
                previousPosition: copyVector(projectile.previousPosition),
                direction: copyVector(projectile.direction),
            })),
            gemGrab: this.selectedMode === "gemGrab" ? {
                gems: this.gems,
                redGems: this.getTeamHeldGems("red"),
                blueGems: this.getTeamHeldGems("blue"),
                countdownTeamId: this.countdownTeamId,
                countdownRemainingSeconds: this.countdownRemainingSeconds,
                targetGems: GEM_GRAB_TARGET_GEMS,
            } : null,
            survival: this.selectedMode === "survival" ? {
                safeCenter: this.getSurvivalCenter(),
                safeRadius: this.survivalSafeRadius,
                nextShrinkHintSeconds: Math.max(0, SURVIVAL_SHRINK_DELAY_SECONDS - this.gameTime),
                powerCubes: this.powerCubes,
                powerBoxes: this.powerBoxes,
            } : null,
            gameTime: this.gameTime,
            gameOver: this.gameOver,
            winnerId: this.winnerId,
            requiredPlayersMessage: this.getRequiredPlayersMessage(),
        };
    }
}

/**
 * Client giocabile di Herosurv.
 * Disegna selezione, arena, giocatori, HUD e invia input al server.
 */
export class OurSpaceGameClient extends GameClient {
    private state: OurSpacePublicGameState | null = null;
    private visibleEvents: OurSpaceEvent[] = [];
    private outgoingMessages: OurSpaceClientMsg[] = [];
    private visualPlayers: Record<string, OurSpaceVisualPlayer> = {};
    private selectedAbilityQueue: number[] = [];
    private basicAttackQueued = false;
    private primaryPointerHeld = false;
    private ultimateQueued = false;
    private userExited = false;
    private modeButtons: Button[] = [];
    private selectionButtons: Button[] = [];
    private basicAttackButton: Button;
    private abilityButtons: Button[] = [];
    private readyButton: Button;
    private ultimateButton: Button;
    private exitButton: Button;
    private floatingTexts: OurSpaceFloatingText[] = [];
    private impactPulses: OurSpaceImpactPulse[] = [];
    private nextFeedbackId = 1;
    private cameraShakeSeconds = 0;
    private cameraShakeIntensity = 0;
    private cameraFocus: Vector2 | null = null;

    /**
     * Prepara bottoni e scorciatoie tastiera.
     * I callback controllano sempre la fase corrente prima di inviare messaggi.
     */
    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);

        OURSPACE_MODE_CATALOG.forEach((modeInfo, index) => {
            const button = new Button(modeInfo.shortTitle, userInput, () => {
                if (this.state?.phase !== "select" || this.state.lobbyStage !== "modeVote") {
                    return;
                }

                this.requestModeSelection(modeInfo.id);
            });
            button.setColors({
                main: modeInfo.color,
                text: "#ffffff",
                shadow: "#12151d",
            });
            this.modeButtons[index] = button;
        });

        OURSPACE_CHARACTER_CATALOG.forEach((characterInfo, index) => {
            const button = new Button(characterInfo.displayName, userInput, () => {
                if (!characterInfo.isImplemented || this.state?.phase !== "select" || this.state.lobbyStage !== "characterSelect") {
                    return;
                }

                this.requestCharacterSelection(characterInfo.kind);
            });
            button.setColors({
                main: characterInfo.isImplemented ? characterInfo.style.primaryColor : "#5f6670",
                text: "#ffffff",
                shadow: "#151515",
            });
            this.selectionButtons[index] = button;
        });

        ["1"].forEach((label, index) => {
            const button = new Button(label, userInput, () => {
                if (this.state?.phase === "play") {
                    this.selectedAbilityQueue.push(index);
                }
            });
            button.setColors({ main: "#303846", text: "#ffffff", shadow: "#101014" });
            this.abilityButtons[index] = button;
        });

        this.basicAttackButton = new Button("M1", userInput, () => {
            if (this.state?.phase === "play") {
                this.basicAttackQueued = true;
            }
        });
        this.basicAttackButton.setColors({ main: "#2d6f7a", text: "#ffffff", shadow: "#082329" });

        this.readyButton = new Button("Conferma", userInput, () => {
            if (this.state?.phase === "select" && this.state.lobbyStage === "characterSelect") {
                this.requestReady();
            }
        });
        this.readyButton.setColors({ main: "#27a85f", text: "#ffffff", shadow: "#092313" });

        this.ultimateButton = new Button("ULT", userInput, () => {
            if (this.state?.phase === "play") {
                this.ultimateQueued = true;
            }
        });
        this.ultimateButton.setColors({ main: "#b8860b", text: "#ffffff", shadow: "#2a1900" });

        this.exitButton = new Button("exit", userInput, () => {
            this.userExited = true;
        });
        this.exitButton.setColors({ main: "#9f2638", text: "#ffffff", shadow: "#23040a" });

        this.userInput.canvas.addEventListener("pointerdown", () => {
            this.primaryPointerHeld = true;
        });
        this.userInput.canvas.addEventListener("pointerup", () => {
            this.primaryPointerHeld = false;
        });
        this.userInput.canvas.addEventListener("pointercancel", () => {
            this.primaryPointerHeld = false;
        });
        window.addEventListener("blur", () => {
            this.primaryPointerHeld = false;
        });
        document.addEventListener("keydown", (event) => this.handleKeyDown(event));
    }

    /**
     * Inizializza il client.
     * Carica gli asset grafici di Herosurv per il rendering dell'arena.
     */
    public init(players: Record<string, Player>): Promise<void> {
        return Promise.all([
            this.assets.loadImage("herosurv-groundTile", OURSPACE_ASSET_PATHS.groundTile),
            this.assets.loadImage("herosurv-groundDetail", OURSPACE_ASSET_PATHS.groundDetail),
            this.assets.loadImage("herosurv-wallTile", OURSPACE_ASSET_PATHS.wallTile),
            this.assets.loadImage("herosurv-crate", OURSPACE_ASSET_PATHS.crate),
            this.assets.loadImage("herosurv-gem", OURSPACE_ASSET_PATHS.gem),
        ]).then(() => undefined);
    }

    private getAssetImage(key: OurSpaceAssetKey): HTMLImageElement | null {
        return this.assets.images[`herosurv-${key}`] ?? null;
    }

    /**
     * Disegna il frame corrente.
     * La scena cambia in base alla fase ricevuta dal server.
     */
    public draw(ctx: CanvasRenderingContext2D, dt: number): void {
        const { screenW, screenH } = this.userInput;

        if (!this.state) {
            this.drawLoading(ctx, screenW, screenH);
            return;
        }

        if (this.state.phase === "select") {
            this.drawCharacterSelection(ctx, screenW, screenH);
            return;
        }

        this.drawArenaScene(ctx, dt, screenW, screenH);

        if (this.state.phase === "gameOver") {
            this.drawGameOver(ctx, screenW, screenH);
        }
    }

    /**
     * Riceve aggiornamenti dal server.
     * Il client sostituisce lo stato completo, cosi resta sincronizzato anche dopo lag.
     */
    public handleMessage(message: any): void {
        if (message.kind !== "herosurv_update") {
            return;
        }

        const update = message as OurSpaceServerMsg;
        this.state = update.state;
        if (this.state.phase === "select") {
            this.cameraFocus = null;
        }
        this.visibleEvents = update.events.slice(-OURSPACE_MAX_VISIBLE_EVENTS);
        this.registerFeedbackEvents(update.events);
    }

    /**
     * Trasforma gli eventi server in feedback grafico locale.
     */
    private registerFeedbackEvents(events: OurSpaceEvent[]): void {
        if (!this.state) {
            return;
        }

        for (const event of events) {
            const target = event.targetId ? this.state.players[event.targetId] : null;
            const source = event.sourceId ? this.state.players[event.sourceId] : null;
            const anchor = target?.character?.position ?? source?.character?.position;

            if (event.kind === "damage" && anchor && event.value) {
                this.floatingTexts.push({
                    id: `text-${this.nextFeedbackId}`,
                    position: copyVector(anchor),
                    text: `-${Math.round(event.value)}`,
                    color: "#ffd1a6",
                    ageSeconds: 0,
                    durationSeconds: 0.85,
                    riseSpeed: 58,
                });
                this.impactPulses.push({
                    id: `pulse-${this.nextFeedbackId}`,
                    position: copyVector(anchor),
                    color: "#ffb15f",
                    ageSeconds: 0,
                    durationSeconds: 0.28,
                    radius: 34,
                });
                this.nextFeedbackId += 1;
                this.cameraShakeSeconds = Math.max(this.cameraShakeSeconds, 0.12);
                this.cameraShakeIntensity = Math.max(this.cameraShakeIntensity, clamp(event.value / 260, 3, 12));
            } else if (event.kind === "elimination" && anchor) {
                this.floatingTexts.push({
                    id: `text-${this.nextFeedbackId}`,
                    position: copyVector(anchor),
                    text: "KO",
                    color: "#ff8fa0",
                    ageSeconds: 0,
                    durationSeconds: 1.1,
                    riseSpeed: 42,
                });
                this.nextFeedbackId += 1;
                this.cameraShakeSeconds = Math.max(this.cameraShakeSeconds, 0.22);
                this.cameraShakeIntensity = Math.max(this.cameraShakeIntensity, 13);
            } else if (event.kind === "objective") {
                this.cameraShakeSeconds = Math.max(this.cameraShakeSeconds, 0.18);
                this.cameraShakeIntensity = Math.max(this.cameraShakeIntensity, 8);
            } else if (event.kind === "ability" && source?.character) {
                this.impactPulses.push({
                    id: `pulse-${this.nextFeedbackId}`,
                    position: copyVector(source.character.position),
                    color: "#dfe7f0",
                    ageSeconds: 0,
                    durationSeconds: 0.25,
                    radius: 26,
                });
                this.nextFeedbackId += 1;
            }
        }
    }

    /**
     * Invia al server selezioni, azioni e input continuo.
     * Il movimento viene mandato spesso, le abilita solo quando vengono richieste.
     */
    public flushMessages(): any[] {
        const messages = [...this.outgoingMessages];
        this.outgoingMessages = [];

        if (this.state?.phase === "play") {
            const useBasicAttack = this.basicAttackQueued || this.isPrimaryFireHeld();
            messages.push({
                kind: "herosurv_input",
                moveDirection: {
                    x: this.userInput.moveDirectionX,
                    y: this.userInput.moveDirectionY,
                },
                aimDirection: this.getAimDirection(),
                useBasicAttack,
                abilityIndex: this.selectedAbilityQueue.shift() ?? null,
                useUltimate: this.ultimateQueued,
            });
            this.basicAttackQueued = false;
            this.ultimateQueued = false;
        }

        return messages;
    }

    /**
     * Dice alla lobby quando il giocatore vuole uscire dalla schermata di gioco.
     * Il server puo aver concluso la partita, ma l'utente sceglie quando tornare.
     */
    public isFinished(): boolean {
        return this.userExited;
    }

    /**
     * Gestisce scorciatoie tastiera.
     * G/V votano la modalita, 1-4 selezionano in lobby, 1 usa l'abilita in partita.
     */
    private handleKeyDown(event: KeyboardEvent): void {
        if (event.repeat) {
            return;
        }

        if (this.state?.phase === "select") {
            if (this.state.lobbyStage === "modeVote" && event.code === "KeyG") {
                this.requestModeSelection("gemGrab");
                return;
            }

            if (this.state.lobbyStage === "modeVote" && event.code === "KeyV") {
                this.requestModeSelection("survival");
                return;
            }

            if (this.state.lobbyStage !== "characterSelect") {
                return;
            }

            if (event.code === "Enter") {
                this.requestReady();
                return;
            }

            const selectionIndex = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(event.code);
            const characterInfo = OURSPACE_CHARACTER_CATALOG[selectionIndex];

            if (characterInfo?.isImplemented) {
                this.requestCharacterSelection(characterInfo.kind);
            }

            return;
        }

        if (this.state?.phase !== "play") {
            return;
        }

        if (event.code === "Digit1") {
            this.selectedAbilityQueue.push(0);
        } else if (event.code === "Space") {
            this.ultimateQueued = true;
        }
    }

    /**
     * Mette in coda la selezione della modalita.
     * La scelta passa dal server per mantenere tutti i client sincronizzati.
     */
    private requestModeSelection(mode: OurSpaceMode): void {
        if (mode === "gemGrab" && !this.isGemGrabSelectable()) {
            this.outgoingMessages.push({
                kind: "herosurv_select_mode",
                mode: "survival",
            });
            return;
        }

        this.outgoingMessages.push({
            kind: "herosurv_select_mode",
            mode,
        });
    }

    /**
     * Mette in coda la selezione personaggio.
     * Usare una coda evita di inviare direttamente dal rendering.
     */
    private requestCharacterSelection(kind: CharacterKind): void {
        this.outgoingMessages.push({
            kind: "herosurv_select_character",
            characterKind: kind,
        });
    }

    /**
     * Mette in coda la conferma di pronto.
     * Il server parte subito solo se tutti i giocatori confermano.
     */
    private requestReady(): void {
        this.outgoingMessages.push({
            kind: "herosurv_ready",
        });
    }

    /**
     * Legge il mouse senza dipendere da modifiche esterne al tipo UserInput.
     */
    private isPrimaryFireHeld(): boolean {
        const input = this.userInput as UserInput & {
            isMousePressed?: (button?: string) => boolean;
            mousePressed?: boolean;
        };

        if (typeof input.isMousePressed === "function") {
            return this.primaryPointerHeld || input.isMousePressed("left");
        }

        return this.primaryPointerHeld || input.mousePressed === true;
    }

    /**
     * Calcola la direzione di mira dal centro del personaggio al mouse.
     * Il vettore viene normalizzato per essere usato dal server in modo stabile.
     */
    private getAimDirection(): Vector2 {
        if (!this.state) {
            return { x: 1, y: 0 };
        }

        const me = this.state.players[this.myId];

        if (!me?.character) {
            return { x: 1, y: 0 };
        }

        const view = this.getArenaView(this.userInput.screenW, this.userInput.screenH);
        const mouseWorldPosition = this.screenToWorld({
            x: this.userInput.mouseX,
            y: this.userInput.mouseY,
        }, view);

        return normalizeOrZero({
            x: mouseWorldPosition.x - me.character.position.x,
            y: mouseWorldPosition.y - me.character.position.y,
        });
    }

    /**
     * Disegna una schermata di attesa.
     * Appare solo per pochi istanti mentre arriva il primo update server.
     */
    private drawLoading(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        ctx.fillStyle = "#10151c";
        ctx.fillRect(0, 0, screenW, screenH);
        ctx.fillStyle = "#f2f4f8";
        ctx.font = "bold 26px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Caricamento Herosurv...", screenW / 2, screenH / 2);
    }

    /**
     * Disegna la lobby completa: scelta modalita, spiegazione comandi e quattro personaggi.
     * Ogni blocco usa misure calcolate, cosi i testi non finiscono uno sopra l'altro.
     */
    private drawCharacterSelection(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        if (!this.state) {
            return;
        }

        const me = this.state.players[this.myId];
        const safeW = Math.max(320, screenW);
        const safeH = Math.max(420, screenH);
        const margin = clamp(safeW * 0.035, 18, 42);
        const contentW = safeW - margin * 2;

        ctx.fillStyle = "#10151c";
        ctx.fillRect(0, 0, screenW, screenH);

        const lobbyGradient = ctx.createLinearGradient(0, 0, safeW, safeH);
        lobbyGradient.addColorStop(0, "rgba(45, 95, 128, 0.18)");
        lobbyGradient.addColorStop(0.5, "rgba(126, 86, 207, 0.14)");
        lobbyGradient.addColorStop(1, "rgba(50, 126, 86, 0.18)");
        ctx.fillStyle = lobbyGradient;
        ctx.fillRect(0, 0, screenW, screenH);

        ctx.fillStyle = "#f2f4f8";
        ctx.font = `bold ${clamp(safeW * 0.032, 24, 36)}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Herosurv", safeW / 2, 34);

        ctx.font = `${clamp(safeW * 0.014, 12, 16)}px Arial`;
        ctx.fillStyle = "#bac6d3";
        const helpText = this.state.lobbyStage === "modeVote"
            ? "Vota una modalita: Arraffagemme | Sopravvivenza"
            : "Scegli un eroe: 1-4 | Conferma con Enter | se non scegli, avrai Bull";
        ctx.fillText(helpText, safeW / 2, 64, contentW);

        const modeGap = 14;
        const modeY = 86;
        const modeH = clamp(safeH * 0.13, 78, 108);
        const modeW = (contentW - modeGap) / 2;

        OURSPACE_MODE_CATALOG.forEach((modeInfo, index) => {
            const x = margin + index * (modeW + modeGap);
            const gemGrabLocked = modeInfo.id === "gemGrab" && !this.isGemGrabSelectable();
            const isSelected = this.state?.selectedMode === modeInfo.id || me?.modeVote === modeInfo.id;
            const buttonW = clamp(modeW * 0.28, 66, 96);
            this.drawModeCard(ctx, modeInfo, x, modeY, modeW, modeH, isSelected, this.state.modeVotes[modeInfo.id], gemGrabLocked);
            this.modeButtons[index].setLabel(gemGrabLocked
                ? "No"
                : this.state.lobbyStage === "modeVote"
                    ? (me?.modeVote === modeInfo.id ? "Votata" : "Vota")
                    : (this.state.selectedMode === modeInfo.id ? "Scelta" : "Chiusa"));
            this.modeButtons[index].draw(ctx, x + modeW - buttonW - 12, modeY + 10, buttonW, 28);
        });

        const statusY = modeY + modeH + 22;
        const playerCount = Object.keys(this.state.players).length;
        const neededVotes = Math.floor(playerCount / 2) + 1;
        const selectedModeInfo = OURSPACE_MODE_CATALOG.find((mode) => mode.id === this.state?.selectedMode);
        const statusText = this.state.lobbyStage === "modeVote"
            ? this.state.modeVoteCountdownSeconds !== null
                ? `Maggioranza raggiunta: modalita bloccata tra ${Math.ceil(this.state.modeVoteCountdownSeconds)}s.`
                : `Serve la maggioranza: ${neededVotes} voti su ${playerCount}. Arraffagemme parte solo con 2/4/6 giocatori.`
            : `Modalita: ${selectedModeInfo?.title ?? "scelta"}. Conferma quando sei pronto: si parte tra ${Math.ceil(this.state.characterSelectCountdownSeconds ?? 0)}s.`;

        ctx.fillStyle = "#dfe7f0";
        ctx.font = `bold ${clamp(safeW * 0.014, 13, 16)}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.state.requiredPlayersMessage ?? statusText, safeW / 2, statusY, contentW);

        if (this.state.lobbyStage === "modeVote") {
            this.drawVoteList(ctx, margin, statusY + 26, contentW);
            return;
        }

        const cardGap = 12;
        const columns = safeW >= 920 ? 4 : 2;
        const rows = Math.ceil(OURSPACE_CHARACTER_CATALOG.length / columns);
        const cardsY = statusY + 24;
        const readyAreaH = 58;
        const availableCardH = Math.max(180, safeH - cardsY - readyAreaH - 18);
        const cardW = (contentW - cardGap * (columns - 1)) / columns;
        const cardH = Math.max(160, (availableCardH - cardGap * (rows - 1)) / rows);

        OURSPACE_CHARACTER_CATALOG.forEach((characterInfo, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            const x = margin + column * (cardW + cardGap);
            const y = cardsY + row * (cardH + cardGap);
            const isSelected = me?.selectedKind === characterInfo.kind;

            this.drawCharacterCard(ctx, characterInfo, x, y, cardW, cardH, isSelected);

            const buttonHeight = clamp(cardH * 0.11, 28, 34);
            this.selectionButtons[index].draw(
                ctx,
                x + 12,
                y + cardH - buttonHeight - 10,
                cardW - 24,
                buttonHeight
            );
        });

        this.drawReadyPanel(ctx, margin, safeH - readyAreaH - 10, contentW, readyAreaH, me);
    }

    /**
     * Disegna una carta modalita.
     * Il bordo chiaro indica quale modalita e stata selezionata dal server.
     */
    private drawModeCard(
        ctx: CanvasRenderingContext2D,
        modeInfo: (typeof OURSPACE_MODE_CATALOG)[number],
        x: number,
        y: number,
        w: number,
        h: number,
        isSelected: boolean,
        voteCount: number,
        isLocked: boolean
    ): void {
        ctx.fillStyle = isLocked ? "#2b3038" : "#16202a";
        ctx.fillRect(x, y, w, h);

        ctx.strokeStyle = isLocked ? "#727b86" : isSelected ? "#ffffff" : modeInfo.color;
        ctx.lineWidth = isSelected ? 4 : 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

        ctx.fillStyle = isLocked ? "#555f69" : modeInfo.color;
        ctx.fillRect(x, y, 8, h);

        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${clamp(w * 0.055, 15, 22)}px Arial`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(modeInfo.title, x + 18, y + 10, w - 122);

        ctx.fillStyle = "#d8e0ea";
        ctx.font = `${clamp(w * 0.031, 11, 14)}px Arial`;
        const nextY = this.drawWrappedText(ctx, modeInfo.description, x + 18, y + 36, w - 30, 15, 2);

        ctx.fillStyle = "#ffd65c";
        ctx.font = `bold ${clamp(w * 0.029, 10, 13)}px Arial`;
        this.drawWrappedText(ctx, modeInfo.objective, x + 18, nextY + 2, w - 30, 14, 2);

        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${clamp(w * 0.035, 12, 15)}px Arial`;
        ctx.textAlign = "right";
        ctx.fillText(`${voteCount} voti`, x + w - 14, y + h - 24, 92);

        if (isLocked) {
            ctx.fillStyle = "#ffb3b3";
            ctx.font = `bold ${clamp(w * 0.029, 10, 13)}px Arial`;
            ctx.textAlign = "left";
            ctx.fillText("Solo con 2/4/6 giocatori", x + 18, y + h - 24, w - 120);
        }
    }

    /**
     * Disegna il pannello di conferma personaggio.
     * Se tutti sono pronti, il server avvia la partita senza aspettare tutto il timer.
     */
    private drawReadyPanel(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        w: number,
        h: number,
        me: OurSpacePublicPlayerState | undefined
    ): void {
        if (!this.state) {
            return;
        }

        const players = Object.values(this.state.players);
        const readyCount = players.filter((player) => player.isReady).length;

        ctx.fillStyle = "rgba(15, 24, 34, 0.94)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "#3a5060";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 15px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(
            `Pronti ${readyCount}/${players.length} | Tempo rimanente: ${Math.ceil(this.state.characterSelectCountdownSeconds ?? 0)}s`,
            x + 14,
            y + h / 2,
            w - 180
        );

        const readyLabel = me?.isReady ? "Pronto" : "Conferma";
        this.readyButton.setLabel(readyLabel);
        this.readyButton.setColors({
            main: me?.isReady ? "#45515c" : "#27a85f",
            text: "#ffffff",
            shadow: "#092313",
        });
        this.readyButton.draw(ctx, x + w - 142, y + 10, 124, h - 20);
    }

    /**
     * Controlla lato client se Arraffagemme e votabile.
     * Il server fa lo stesso controllo autorevole, questa funzione serve solo per chiarezza grafica.
     */
    private isGemGrabSelectable(): boolean {
        if (!this.state) {
            return false;
        }

        const playerCount = Object.keys(this.state.players).length;
        return playerCount >= 2 && playerCount <= 6 && playerCount % 2 === 0;
    }

    /**
     * Mostra chi ha votato cosa nella lobby.
     * Questo rende chiara la maggioranza in una partita multiplayer.
     */
    private drawVoteList(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
        if (!this.state) {
            return;
        }

        const players = Object.values(this.state.players);
        const rowH = 24;
        const title = "Voti giocatori";

        ctx.fillStyle = "rgba(22, 32, 42, 0.9)";
        ctx.fillRect(x, y, w, Math.min(170, 42 + players.length * rowH));
        ctx.strokeStyle = "#314454";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, Math.min(170, 42 + players.length * rowH) - 2);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 16px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(title, x + 14, y + 12);

        ctx.font = "13px Arial";
        players.slice(0, 10).forEach((player, index) => {
            const voteName = player.modeVote === "gemGrab"
                ? "Arraffagemme"
                : player.modeVote === "survival"
                    ? "Sopravvivenza"
                    : "non ha votato";
            ctx.fillStyle = player.modeVote === null ? "#aeb8c5" : "#dfe7f0";
            ctx.fillText(`${player.name}: ${voteName}`, x + 14, y + 40 + index * rowH, w - 28);
        });
    }

    /**
     * Disegna una carta personaggio della selezione.
     * Ogni abilita ha una riga dedicata: chi sceglie sa subito cosa fanno kit e Ultimate.
     */
    private drawCharacterCard(
        ctx: CanvasRenderingContext2D,
        characterInfo: (typeof OURSPACE_CHARACTER_CATALOG)[number],
        x: number,
        y: number,
        w: number,
        h: number,
        isSelected: boolean
    ): void {
        const style = characterInfo.style;
        const compact = h < 260;
        const padding = clamp(w * 0.055, 9, 14);
        const portraitRadius = clamp(Math.min(w, h) * 0.095, 15, 26);

        ctx.fillStyle = "#17202a";
        ctx.fillRect(x, y, w, h);

        ctx.strokeStyle = isSelected ? "#ffffff" : style.accentColor;
        ctx.lineWidth = isSelected ? 4 : 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, Math.max(60, h - 50));
        ctx.clip();

        ctx.fillStyle = style.secondaryColor;
        ctx.fillRect(x, y, w, Math.max(42, h * 0.16));

        ctx.fillStyle = style.primaryColor;
        ctx.beginPath();
        ctx.arc(x + padding + portraitRadius, y + padding + portraitRadius, portraitRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#161616";
        ctx.beginPath();
        ctx.arc(x + padding + portraitRadius * 0.72, y + padding + portraitRadius * 0.86, portraitRadius * 0.12, 0, Math.PI * 2);
        ctx.arc(x + padding + portraitRadius * 1.28, y + padding + portraitRadius * 0.86, portraitRadius * 0.12, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${clamp(w * 0.07, 16, 22)}px Arial`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(characterInfo.displayName, x + padding * 2 + portraitRadius * 2, y + padding, w - padding * 3 - portraitRadius * 2);

        ctx.fillStyle = "#e9eef6";
        ctx.font = `${clamp(w * 0.04, 11, 14)}px Arial`;
        ctx.fillText(characterInfo.role, x + padding * 2 + portraitRadius * 2, y + padding + 25, w - padding * 3 - portraitRadius * 2);

        let textY = y + Math.max(58, h * 0.19);
        const lineH = compact ? 13 : 15;
        const bodyFont = compact ? 10 : clamp(w * 0.035, 11, 13);

        if (!compact) {
            textY = this.drawStatBars(ctx, characterInfo.statsPreview, x + padding, textY, w - padding * 2);
        }

        ctx.fillStyle = "#dce5ef";
        ctx.font = `${bodyFont}px Arial`;
        textY = this.drawWrappedText(ctx, characterInfo.description, x + padding, textY, w - padding * 2, lineH, compact ? 2 : 3);

        ctx.fillStyle = "#aee8ff";
        ctx.font = `bold ${bodyFont}px Arial`;
        textY = this.drawWrappedText(ctx, `Base: ${characterInfo.basicAttack.name} - ${characterInfo.basicAttack.description}`, x + padding, textY + 4, w - padding * 2, lineH, compact ? 1 : 2);

        ctx.fillStyle = "#f4cf6a";
        ctx.font = `bold ${bodyFont}px Arial`;
        textY = this.drawWrappedText(ctx, `Passiva: ${characterInfo.passive}`, x + padding, textY + 4, w - padding * 2, lineH, compact ? 2 : 3);

        ctx.fillStyle = "#f2f6fb";
        ctx.font = `bold ${bodyFont}px Arial`;
        const maxAbilityLines = compact ? 1 : 2;
        for (const ability of characterInfo.abilities) {
            textY = this.drawWrappedText(
                ctx,
                `${ability.key}. ${ability.name}: ${ability.description}`,
                x + padding,
                textY + 3,
                w - padding * 2,
                lineH,
                maxAbilityLines
            );
        }

        ctx.fillStyle = "#ffd65c";
        ctx.font = `bold ${bodyFont}px Arial`;
        this.drawWrappedText(
            ctx,
            `${characterInfo.ultimate.key}. Ult ${characterInfo.ultimate.name}: ${characterInfo.ultimate.description}`,
            x + padding,
            textY + 4,
            w - padding * 2,
            lineH,
            compact ? 2 : 3
        );

        ctx.restore();
    }

    /**
     * Disegna una piccola anteprima statistica nella carta personaggio.
     */
    private drawStatBars(
        ctx: CanvasRenderingContext2D,
        stats: (typeof OURSPACE_CHARACTER_CATALOG)[number]["statsPreview"],
        x: number,
        y: number,
        w: number
    ): number {
        const labels: Array<[string, number, string]> = [
            ["Vita", stats.health, "#6de07b"],
            ["Danno", stats.damage, "#ff9f68"],
            ["Range", stats.range, "#aee8ff"] 
        ];
        const barW = (w - 8) / 5;

        labels.forEach(([label, value, color], index) => {
            const barX = x + index * barW;
            ctx.fillStyle = "#273241";
            ctx.fillRect(barX, y + 16, barW - 5, 6);
            ctx.fillStyle = color;
            ctx.fillRect(barX, y + 16, (barW - 5) * clamp(value / 5, 0, 1), 6);
            ctx.fillStyle = "#dfe7f0";
            ctx.font = "10px Arial";
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillText(label, barX, y, barW - 5);
        });

        return y + 28;
    }

    /**
     * Disegna testo su piu righe rispettando una larghezza massima.
     * Restituisce la y successiva, cosi il blocco seguente parte sempre sotto.
     */
    private drawWrappedText(
        ctx: CanvasRenderingContext2D,
        text: string,
        x: number,
        y: number,
        maxWidth: number,
        lineHeight: number,
        maxLines: number
    ): number {
        const words = text.split(" ");
        const lines: string[] = [];
        let currentLine = "";

        for (const word of words) {
            const testLine = currentLine.length > 0 ? `${currentLine} ${word}` : word;

            if (ctx.measureText(testLine).width <= maxWidth || currentLine.length === 0) {
                currentLine = testLine;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }

        if (currentLine.length > 0) {
            lines.push(currentLine);
        }

        const visibleLines = lines.slice(0, Math.max(1, maxLines));

        if (lines.length > visibleLines.length) {
            const lastIndex = visibleLines.length - 1;
            visibleLines[lastIndex] = this.trimTextToWidth(ctx, `${visibleLines[lastIndex]}...`, maxWidth);
        }

        visibleLines.forEach((line, index) => {
            ctx.fillText(line, x, y + index * lineHeight, maxWidth);
        });

        return y + visibleLines.length * lineHeight;
    }

    /**
     * Accorcia una riga finche entra nello spazio disponibile.
     * Questo evita che parole lunghe o frasi compresse escano dalla carta.
     */
    private trimTextToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
        let result = text;

        while (result.length > 3 && ctx.measureText(result).width > maxWidth) {
            result = `${result.slice(0, -4)}...`;
        }

        return result;
    }

    /**
     * Disegna arena, personaggi, HUD ed eventi.
     * Le posizioni vengono interpolate per rendere il multiplayer piu fluido.
     */
    private drawArenaScene(ctx: CanvasRenderingContext2D, dt: number, screenW: number, screenH: number): void {
        if (!this.state) {
            return;
        }

        this.updateVisualPlayers(dt);
        this.updateFeedback(dt);
        this.updateCameraFocus(dt);

        ctx.fillStyle = "#0f141a";
        ctx.fillRect(0, 0, screenW, screenH);

        const view = this.getArenaView(screenW, screenH, this.cameraFocus ?? undefined);

        this.drawArenaBackground(ctx, view);
        this.drawModeObjects(ctx, view);
        this.drawAimIndicators(ctx, view);
        this.drawProjectiles(ctx, view);
        this.drawPlayers(ctx, view);
        this.drawFeedback(ctx, view);
        this.drawHud(ctx, screenW, screenH);
        this.drawEventLog(ctx, screenW);
    }

    /**
     * Aggiorna numeri danno, pulse e camera shake.
     */
    private updateFeedback(dt: number): void {
        const safeDt = safeDeltaTime(dt);

        this.cameraShakeSeconds = clamp(this.cameraShakeSeconds - safeDt, 0, Number.POSITIVE_INFINITY);
        if (this.cameraShakeSeconds <= EPSILON) {
            this.cameraShakeIntensity = 0;
        }

        for (const text of this.floatingTexts) {
            text.ageSeconds += safeDt;
            text.position.y -= text.riseSpeed * safeDt;
        }

        for (const pulse of this.impactPulses) {
            pulse.ageSeconds += safeDt;
        }

        this.floatingTexts = this.floatingTexts.filter((text) => text.ageSeconds < text.durationSeconds);
        this.impactPulses = this.impactPulses.filter((pulse) => pulse.ageSeconds < pulse.durationSeconds);
    }

    /**
     * Aggiorna le posizioni interpolate dei giocatori.
     * Questo rende morbidi gli update server a 20 tick al secondo.
     */
    private updateVisualPlayers(dt: number): void {
        if (!this.state) {
            return;
        }

        const smoothing = clamp(18 * safeDeltaTime(dt), 0, 1);

        for (const player of Object.values(this.state.players)) {
            if (!player.character) {
                continue;
            }

            const targetPosition = player.character.position;
            const visual = this.visualPlayers[player.id] ?? {
                x: targetPosition.x,
                y: targetPosition.y,
            };

            visual.x += (targetPosition.x - visual.x) * smoothing;
            visual.y += (targetPosition.y - visual.y) * smoothing;
            this.visualPlayers[player.id] = visual;
        }
    }

    /**
     * Ammorbidisce solo la camera: il server e i colpi restano invariati.
     */
    private updateCameraFocus(dt: number): void {
        if (!this.state || this.state.phase === "select") {
            this.cameraFocus = null;
            return;
        }

        const target = this.getCameraFocusTarget(true);

        if (this.cameraFocus === null) {
            this.cameraFocus = copyVector(target);
            return;
        }

        const smoothing = clamp(12 * safeDeltaTime(dt), 0, 1);
        this.cameraFocus.x += (target.x - this.cameraFocus.x) * smoothing;
        this.cameraFocus.y += (target.y - this.cameraFocus.y) * smoothing;
    }

    /**
     * Calcola il punto che la camera deve seguire.
     * In render usa la posizione interpolata; per l'input resta sulla posizione server.
     */
    private getCameraFocusTarget(useVisualPosition: boolean): Vector2 {
        const arenaWidth = this.state?.arena.width ?? OURSPACE_GAME_CONFIG.arenaWidth;
        const arenaHeight = this.state?.arena.height ?? OURSPACE_GAME_CONFIG.arenaHeight;
        const me = this.state?.players[this.myId];

        if (!me?.character) {
            return {
                x: arenaWidth / 2,
                y: arenaHeight / 2,
            };
        }

        const baseFocus = useVisualPosition
            ? this.visualPlayers[this.myId] ?? me.character.position
            : me.character.position;
        const aimLead = normalizeOrZero(me.aimDirection);

        return {
            x: baseFocus.x + aimLead.x * 90,
            y: baseFocus.y + aimLead.y * 90,
        };
    }

    /**
     * Calcola dove disegnare l'arena sullo schermo.
     * Mantiene le proporzioni corrette su qualsiasi risoluzione.
     */
    private getArenaView(screenW: number, screenH: number, focusOverride?: Vector2): OurSpaceArenaView {
        const topSpace = 14;
        const bottomSpace = 124;
        const margin = 0;
        const maxWidth = Math.max(200, screenW - margin * 2);
        const maxHeight = Math.max(160, screenH - topSpace - bottomSpace);
        const countdownZoom = this.state?.gemGrab?.countdownTeamId ? 1.04 : 1;
        const gameOverZoom = this.state?.phase === "gameOver" ? 0.94 : 1;
        const scale = clamp(Math.min(maxWidth / 840, maxHeight / 560) * countdownZoom * gameOverZoom, 0.65, 1.35);
        const visibleWorldWidth = maxWidth / scale;
        const visibleWorldHeight = maxHeight / scale;
        const focus = focusOverride ?? this.getCameraFocusTarget(false);
        const arenaWidth = this.state?.arena.width ?? OURSPACE_GAME_CONFIG.arenaWidth;
        const arenaHeight = this.state?.arena.height ?? OURSPACE_GAME_CONFIG.arenaHeight;
        const maxWorldX = Math.max(0, arenaWidth - visibleWorldWidth);
        const maxWorldY = Math.max(0, arenaHeight - visibleWorldHeight);
        const worldX = clamp(focus.x - visibleWorldWidth / 2, 0, maxWorldX);
        const worldY = clamp(focus.y - visibleWorldHeight / 2, 0, maxWorldY);
        const shakeRatio = this.cameraShakeSeconds > EPSILON ? clamp(this.cameraShakeSeconds / 0.25, 0, 1) : 0;
        const shakeX = Math.sin((this.state?.gameTime ?? 0) * 71) * this.cameraShakeIntensity * shakeRatio;
        const shakeY = Math.cos((this.state?.gameTime ?? 0) * 83) * this.cameraShakeIntensity * shakeRatio;

        return {
            x: margin + shakeX,
            y: topSpace + shakeY,
            w: maxWidth,
            h: maxHeight,
            scale,
            worldX,
            worldY,
            visibleWorldWidth,
            visibleWorldHeight,
        };
    }

    /**
     * Converte coordinate arena in coordinate schermo.
     * Questa funzione evita calcoli duplicati nel rendering.
     */
    private worldToScreen(position: Vector2, view: OurSpaceArenaView): Vector2 {
        return {
            x: view.x + (position.x - view.worldX) * view.scale,
            y: view.y + (position.y - view.worldY) * view.scale,
        };
    }

    /**
     * Converte coordinate schermo in coordinate mondo.
     * Serve per far puntare il personaggio verso il mouse anche con la camera mobile.
     */
    private screenToWorld(position: Vector2, view: OurSpaceArenaView): Vector2 {
        return {
            x: view.worldX + (position.x - view.x) / view.scale,
            y: view.worldY + (position.y - view.y) / view.scale,
        };
    }

    /**
     * Disegna il campo di battaglia con textura di terreno e overlay.
     */
    private drawArenaBackground(
        ctx: CanvasRenderingContext2D,
        view: OurSpaceArenaView
    ): void {
        ctx.save();
        ctx.beginPath();
        ctx.rect(view.x, view.y, view.w, view.h);
        ctx.clip();

        const groundImage = this.getAssetImage("groundTile");
        const tileW = groundImage.width * view.scale;
        const tileH = groundImage.height * view.scale;
        const startX = view.x - ((view.worldX % groundImage.width) * view.scale);
        const startY = view.y - ((view.worldY % groundImage.height) * view.scale);

        for (let x = startX - tileW; x < view.x + view.w + tileW; x += tileW) {
            for (let y = startY - tileH; y < view.y + view.h + tileH; y += tileH) {
                ctx.drawImage(groundImage, x, y, tileW, tileH);
            }
        }

        const baseGradient = ctx.createLinearGradient(view.x, view.y, view.x + view.w, view.y + view.h);

        if (this.state?.selectedMode === "survival") {
            baseGradient.addColorStop(0, "rgba(62, 81, 60, 0.45)");
            baseGradient.addColorStop(0.5, "rgba(91, 108, 69, 0.45)");
            baseGradient.addColorStop(1, "rgba(49, 72, 70, 0.45)");
        } else {
            baseGradient.addColorStop(0, "rgba(37, 61, 101, 0.45)");
            baseGradient.addColorStop(0.5, "rgba(50, 95, 127, 0.45)");
            baseGradient.addColorStop(1, "rgba(37, 59, 85, 0.45)");
        }

        ctx.fillStyle = baseGradient;
        ctx.fillRect(view.x, view.y, view.w, view.h);
        this.drawArenaDecoration(ctx, view);
        this.drawArenaWalls(ctx, view);

        const topLeft = this.worldToScreen({ x: 0, y: 0 }, view);
        const bottomRight = this.worldToScreen({
            x: this.state?.arena.width ?? OURSPACE_GAME_CONFIG.arenaWidth,
            y: this.state?.arena.height ?? OURSPACE_GAME_CONFIG.arenaHeight,
        }, view);

        ctx.strokeStyle = "#e8c45d";
        ctx.lineWidth = 5;
        ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
        ctx.restore();
    }

    /**
     * Disegna il cerchio centrale solo in Arraffagemme.
     * In Sopravvivenza resta visibile solo la zona sicura.
     */
    private drawArenaDecoration(ctx: CanvasRenderingContext2D, view: OurSpaceArenaView): void {
        if (this.state?.selectedMode !== "gemGrab") {
            return;
        }

        const arenaWidth = this.state?.arena.width ?? OURSPACE_GAME_CONFIG.arenaWidth;
        const arenaHeight = this.state?.arena.height ?? OURSPACE_GAME_CONFIG.arenaHeight;
        const centerWorldX = arenaWidth / 2;
        const centerWorldY = arenaHeight / 2;

        const center = this.worldToScreen({
            x: centerWorldX,
            y: centerWorldY,
        }, view);
        const mineRadius = 120 * view.scale;
        const gemSpawnImage = this.getAssetImage("gem");

        ctx.save();
        ctx.beginPath();
        ctx.arc(center.x, center.y, mineRadius, 0, Math.PI * 2);
        ctx.clip();

        const imageSize = mineRadius * 2;
        ctx.drawImage(gemSpawnImage, center.x - mineRadius, center.y - mineRadius, imageSize, imageSize);

        ctx.restore();
        ctx.strokeStyle = "rgba(255, 237, 142, 0.55)";
        ctx.lineWidth = Math.max(2, 4 * view.scale);
        ctx.beginPath();
        ctx.arc(center.x, center.y, mineRadius, 0, Math.PI * 2);
        ctx.stroke();
    }

    /**
     * Disegna i muri veri della mappa.
     * Questi rettangoli sono gli stessi usati dal server per collisioni e copertura.
     */
    private drawArenaWalls(ctx: CanvasRenderingContext2D, view: OurSpaceArenaView): void {
        const walls = this.state?.arena.walls ?? [];
        const wallImage = this.getAssetImage("wallTile");

        ctx.strokeStyle = this.state?.selectedMode === "survival" ? "#3d3025" : "#252d3d";
        ctx.lineWidth = Math.max(1, 3 * view.scale);

        for (const wall of walls) {
            const position = this.worldToScreen({ x: wall.x, y: wall.y }, view);
            const width = wall.w * view.scale;
            const height = wall.h * view.scale;

            ctx.drawImage(wallImage, position.x, position.y, width, height);
            ctx.beginPath();
            ctx.roundRect(position.x, position.y, width, height, 8 * view.scale);
            ctx.stroke();
        }
    }

    /**
     * Disegna gli oggetti specifici della modalita.
     * Le gemme e la zona sicura sono nello stato server, quindi tutti le vedono uguali.
     */
    private drawModeObjects(
        ctx: CanvasRenderingContext2D,
        view: OurSpaceArenaView
    ): void {
        if (!this.state) {
            return;
        }

        if (this.state.gemGrab) {
            for (const gem of this.state.gemGrab.gems) {
                const position = this.worldToScreen(gem.position, view);
                const size = 13 * view.scale;

                ctx.save();
                ctx.translate(position.x, position.y);
                ctx.rotate(Math.PI / 4);
                ctx.fillStyle = "#b46cff";
                ctx.fillRect(-size / 2, -size / 2, size, size);
                ctx.strokeStyle = "#fff0a8";
                ctx.lineWidth = Math.max(1.5, 2 * view.scale);
                ctx.strokeRect(-size / 2, -size / 2, size, size);
                ctx.restore();
            }

            if (this.state.gemGrab.countdownTeamId) {
                const center = this.worldToScreen({
                    x: this.state.arena.width / 2,
                    y: this.state.arena.height / 2,
                }, view);
                const pulse = 1 + Math.sin(this.state.gameTime * 8) * 0.08;
                ctx.strokeStyle = this.state.gemGrab.countdownTeamId === "red" ? "#ff6874" : "#62aaff";
                ctx.lineWidth = Math.max(4, 7 * view.scale);
                ctx.beginPath();
                ctx.arc(center.x, center.y, 150 * view.scale * pulse, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        if (this.state.survival) {
            const center = this.worldToScreen(this.state.survival.safeCenter, view);
            const radius = this.state.survival.safeRadius * view.scale;

            ctx.save();
            ctx.beginPath();
            ctx.rect(view.x, view.y, view.w, view.h);
            ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(7, 10, 14, 0.48)";
            ctx.fill("evenodd");
            ctx.restore();

            ctx.strokeStyle = "#45f09a";
            ctx.lineWidth = Math.max(3, 5 * view.scale);
            ctx.beginPath();
            ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            ctx.stroke();

            for (const box of this.state.survival.powerBoxes) {
                const position = this.worldToScreen(box.position, view);
                const boxSize = box.radius * 2 * view.scale;
                const healthRatio = clamp(box.health / box.maxHealth, 0, 1);
                const crateImage = this.getAssetImage("crate");

                ctx.drawImage(crateImage, position.x - boxSize / 2, position.y - boxSize / 2, boxSize, boxSize);
                ctx.fillStyle = "#f0d36a";
                ctx.fillRect(position.x - boxSize / 2, position.y - boxSize / 2 - 8 * view.scale, boxSize * healthRatio, 5 * view.scale);
            }

            for (const cube of this.state.survival.powerCubes) {
                const position = this.worldToScreen(cube.position, view);
                const size = 18 * view.scale;

                ctx.save();
                ctx.translate(position.x, position.y);
                ctx.rotate(Math.PI / 4);
                ctx.fillStyle = "#fff17a";
                ctx.fillRect(-size / 2, -size / 2, size, size);
                ctx.strokeStyle = "#a27600";
                ctx.lineWidth = Math.max(1.5, 2 * view.scale);
                ctx.strokeRect(-size / 2, -size / 2, size, size);
                ctx.restore();
            }
        }
    }

    /**
     * Disegna dove ogni giocatore sta puntando.
     * Il cono/linea di mira aiuta a capire subito direzione dei colpi e della Ultimate.
     */
    private drawAimIndicators(ctx: CanvasRenderingContext2D, view: OurSpaceArenaView): void {
        if (!this.state) {
            return;
        }

        for (const player of Object.values(this.state.players)) {
            const character = player.character;

            if (!character || player.isEliminated) {
                continue;
            }

            const start = this.worldToScreen(character.position, view);
            const localMouseWorld = player.id === this.myId
                ? this.screenToWorld({ x: this.userInput.mouseX, y: this.userInput.mouseY }, view)
                : null;
            const localAim = localMouseWorld
                ? normalizeOrZero({
                    x: localMouseWorld.x - character.position.x,
                    y: localMouseWorld.y - character.position.y,
                })
                : null;
            const aim = localAim && vectorLength(localAim) > EPSILON
                ? localAim
                : vectorLength(player.aimDirection) > EPSILON
                    ? normalizeOrZero(player.aimDirection)
                    : normalizeOrZero(character.facingDirection);
            const length = (player.id === this.myId ? 175 : 115) * view.scale;
            const endX = start.x + aim.x * length;
            const endY = start.y + aim.y * length;
            const color = player.id === this.myId
                ? "#ffffff"
                : player.teamId === "red"
                    ? "#ff7782"
                    : player.teamId === "blue"
                        ? "#75b5ff"
                        : "#ffd65c";

            ctx.strokeStyle = color;
            ctx.lineWidth = player.id === this.myId ? 3 : 2;
            ctx.globalAlpha = player.id === this.myId ? 0.9 : 0.55;
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(endX, endY);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(endX, endY, Math.max(4, 7 * view.scale), 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    /**
     * Disegna i proiettili base ricevuti dal server.
     */
    private drawProjectiles(ctx: CanvasRenderingContext2D, view: OurSpaceArenaView): void {
        if (!this.state) {
            return;
        }

        for (const projectile of this.state.projectiles) {
            const position = this.worldToScreen(projectile.position, view);
            const previous = this.worldToScreen(projectile.previousPosition, view);
            const radius = Math.max(3, projectile.radius * view.scale);

            ctx.strokeStyle = projectile.color;
            ctx.globalAlpha = 0.62;
            ctx.lineWidth = Math.max(2, radius * 0.7);
            ctx.beginPath();
            ctx.moveTo(previous.x, previous.y);
            ctx.lineTo(position.x, position.y);
            ctx.stroke();

            ctx.globalAlpha = 1;
            ctx.fillStyle = projectile.color;
            ctx.beginPath();
            ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
            ctx.beginPath();
            ctx.arc(position.x - radius * 0.25, position.y - radius * 0.25, radius * 0.35, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /**
     * Disegna numeri danno e onde d'impatto.
     */
    private drawFeedback(ctx: CanvasRenderingContext2D, view: OurSpaceArenaView): void {
        for (const pulse of this.impactPulses) {
            const progress = clamp(pulse.ageSeconds / pulse.durationSeconds, 0, 1);
            const position = this.worldToScreen(pulse.position, view);
            ctx.globalAlpha = 1 - progress;
            ctx.strokeStyle = pulse.color;
            ctx.lineWidth = Math.max(2, 4 * view.scale);
            ctx.beginPath();
            ctx.arc(position.x, position.y, pulse.radius * view.scale * (0.7 + progress), 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.globalAlpha = 1;
        for (const text of this.floatingTexts) {
            const progress = clamp(text.ageSeconds / text.durationSeconds, 0, 1);
            const position = this.worldToScreen(text.position, view);
            ctx.globalAlpha = 1 - progress * 0.8;
            ctx.fillStyle = text.color;
            ctx.font = "bold 18px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text.text, position.x, position.y);
        }
        ctx.globalAlpha = 1;
    }

    /**
     * Disegna tutti i giocatori presenti nello stato.
     * Il giocatore locale e le squadre hanno bordi diversi per essere riconoscibili.
     */
    private drawPlayers(
        ctx: CanvasRenderingContext2D,
        view: OurSpaceArenaView
    ): void {
        if (!this.state) {
            return;
        }

        for (const player of Object.values(this.state.players)) {
            if (!player.character) {
                continue;
            }

            const visual = this.visualPlayers[player.id] ?? player.character.position;
            const screenPosition = this.worldToScreen(visual, view);
            const radius = player.character.radius * view.scale;

            this.drawSinglePlayer(ctx, player, screenPosition, radius);
        }
    }

    /**
     * Disegna un singolo personaggio come avatar Canvas.
     * Usiamo forme semplici ma pulite: corpo, bordo, direzione, barre vita/scudo.
     */
    private drawSinglePlayer(
        ctx: CanvasRenderingContext2D,
        player: OurSpacePublicPlayerState,
        screenPosition: Vector2,
        radius: number
    ): void {
        const character = player.character;

        if (!character) {
            return;
        }

        const style = character.kind ? getOurSpaceCharacterStyle(character.kind) : OURSPACE_CHARACTER_STYLES.Bull;
        const isMe = player.id === this.myId;
        const isTitanFury = character.activeEffectIds.includes("bull-titan-fury");
        const isStunned = character.activeEffectIds.some((effectId) => {
            return effectId.includes("stun") || effectId.includes("lockdown");
        });
        const isInvulnerable = player.invulnerabilitySeconds > EPSILON;
        const teamOutline = player.teamId === "red"
            ? "#ff5a67"
            : player.teamId === "blue"
                ? "#5aa7ff"
                : style.outlineColor;

        ctx.save();
        ctx.translate(screenPosition.x, screenPosition.y);

        ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
        ctx.beginPath();
        ctx.ellipse(0, radius * 0.85, radius * 1.15, radius * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = player.isEliminated ? "#3b4047" : style.primaryColor;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
        ctx.beginPath();
        ctx.arc(-radius * 0.26, -radius * 0.28, radius * 0.34, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = isMe ? "#ffffff" : teamOutline;
        ctx.lineWidth = Math.max(2, radius * 0.12);
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.stroke();

        if (isTitanFury) {
            ctx.strokeStyle = "#ffd65c";
            ctx.lineWidth = Math.max(2, radius * 0.08);
            ctx.beginPath();
            ctx.arc(0, 0, radius * 1.28, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (isInvulnerable) {
            ctx.strokeStyle = "#aee8ff";
            ctx.lineWidth = Math.max(2, radius * 0.09);
            ctx.beginPath();
            ctx.arc(0, 0, radius * 1.18, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (isStunned) {
            ctx.fillStyle = "#d7f7ff";
            ctx.font = `bold ${Math.max(10, radius * 0.65)}px Arial`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("X", 0, -radius * 1.45);
        }

        ctx.fillStyle = "#161616";
        ctx.beginPath();
        ctx.arc(-radius * 0.33, -radius * 0.12, radius * 0.12, 0, Math.PI * 2);
        ctx.arc(radius * 0.33, -radius * 0.12, radius * 0.12, 0, Math.PI * 2);
        ctx.fill();

        this.drawCharacterEmblem(ctx, character.kind, radius);

        ctx.restore();

        this.drawNameAndBars(ctx, player, screenPosition, radius);
    }

    /**
     * Disegna un piccolo simbolo diverso per ogni ruolo.
     * Aiuta a riconoscere i personaggi anche quando in arena ci sono molti player.
     */
    private drawCharacterEmblem(ctx: CanvasRenderingContext2D, kind: CharacterKind, radius: number): void {
        ctx.strokeStyle = "#ffffff";
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = Math.max(2, radius * 0.08);

        if (kind === "Bull") {
            ctx.beginPath();
            ctx.moveTo(-radius * 0.28, radius * 0.28);
            ctx.lineTo(radius * 0.28, radius * 0.28);
            ctx.lineTo(radius * 0.12, radius * 0.5);
            ctx.lineTo(-radius * 0.12, radius * 0.5);
            ctx.closePath();
            ctx.fill();
        } else if (kind === "Sniper") {
            ctx.beginPath();
            ctx.moveTo(0, radius * 0.42);
            ctx.lineTo(radius * 0.32, radius * 0.12);
            ctx.lineTo(-radius * 0.32, radius * 0.12);
            ctx.closePath();
            ctx.stroke();
        } else if (kind === "Healer") {
            ctx.fillRect(-radius * 0.08, radius * 0.08, radius * 0.16, radius * 0.42);
            ctx.fillRect(-radius * 0.22, radius * 0.21, radius * 0.44, radius * 0.16);
        } else {
            ctx.beginPath();
            ctx.arc(0, radius * 0.28, radius * 0.22, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, radius * 0.28, radius * 0.08, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /**
     * Disegna il contatore dei power-up con un simbolo unico e leggibile.
     */
    private drawPowerUpBadge(ctx: CanvasRenderingContext2D, x: number, y: number, count: number, size: number): void {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = "#fff17a";
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.strokeStyle = "#7f6100";
        ctx.lineWidth = Math.max(1, size * 0.13);
        ctx.strokeRect(-size / 2, -size / 2, size, size);
        ctx.restore();

        ctx.fillStyle = "#1a1d22";
        ctx.font = `bold ${Math.max(10, size * 0.68)}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`x${count}`, x, y);
    }

    /**
     * Disegna nome, vita e scudo sopra al personaggio.
     * Le barre sono proporzionali, quindi restano leggibili a scale diverse.
     */
    private drawNameAndBars(
        ctx: CanvasRenderingContext2D,
        player: OurSpacePublicPlayerState,
        screenPosition: Vector2,
        radius: number
    ): void {
        const character = player.character;

        if (!character) {
            return;
        }

        const barWidth = Math.max(44, radius * 2.4);
        const barHeight = Math.max(5, radius * 0.22);
        const topY = screenPosition.y - radius - 26;
        const healthRatio = clamp(character.health / character.maxHealth, 0, 1);
        const shieldRatio = clamp(character.shieldPoints / Math.max(1, character.maxHealth), 0, 1);

        ctx.font = `bold ${Math.max(11, radius * 0.42)}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = "#f6f8fb";
        const teamLabel = player.teamId === "red" ? " R" : player.teamId === "blue" ? " B" : "";
        const gemLabel = player.heldGems > 0 ? ` G:${player.heldGems}` : "";
        const nameLabel = player.respawnRemainingSeconds > 0
            ? `Rientro ${Math.ceil(player.respawnRemainingSeconds)}s`
            : player.invulnerabilitySeconds > 0
                ? `${player.name} protetto`
            : `${player.name}${teamLabel}${gemLabel}`;
        ctx.fillText(nameLabel, screenPosition.x, topY - 4);

        ctx.fillStyle = "#1a1d22";
        ctx.fillRect(screenPosition.x - barWidth / 2, topY, barWidth, barHeight);

        ctx.fillStyle = healthRatio > 0.45 ? "#55c86a" : healthRatio > 0.2 ? "#e0a43a" : "#d94b4b";
        ctx.fillRect(screenPosition.x - barWidth / 2, topY, barWidth * healthRatio, barHeight);

        ctx.font = `bold ${Math.max(9, radius * 0.34)}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(`${Math.ceil(character.health)}/${character.maxHealth}`, screenPosition.x, topY + barHeight / 2);

        if (shieldRatio > EPSILON) {
            ctx.fillStyle = "#63c7ff";
            ctx.fillRect(screenPosition.x - barWidth / 2, topY + barHeight + 2, barWidth * shieldRatio, barHeight * 0.75);
        }

        if (player.powerCubes > 0) {
            this.drawPowerUpBadge(ctx, screenPosition.x + barWidth / 2 + 18, topY + barHeight / 2, player.powerCubes, 14);
        }
    }

    /**
     * Disegna la HUD in basso con cooldown e Ultimate.
     * I bottoni sono cliccabili e hanno anche scorciatoie da tastiera.
     */
    private drawHud(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        if (!this.state) {
            return;
        }

        const me = this.state.players[this.myId];
        const panelY = screenH - 118;

        ctx.fillStyle = "rgba(10, 13, 18, 0.86)";
        ctx.fillRect(0, panelY, screenW, 118);

        ctx.fillStyle = "#f4f6fa";
        ctx.font = "bold 17px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const mapText = this.state.selectedMapName ? ` | ${this.state.selectedMapName}` : "";
        ctx.fillText(`${this.getObjectiveText()}${mapText}`, 22, panelY + 20, Math.max(180, screenW - 170));

        ctx.fillStyle = "#cbd6e2";
        ctx.font = "13px Arial";
        const hasRespawnNotice = Boolean(me?.respawnRemainingSeconds && me.respawnRemainingSeconds > 0);
        ctx.fillText(
            "Mouse attacca | WASD muovi | 1 abilita | Spazio Ultimate",
            22,
            panelY + 43,
            hasRespawnNotice ? Math.max(260, screenW - 300) : screenW - 44
        );

        if (hasRespawnNotice) {
            ctx.fillStyle = "#ffd65c";
            ctx.font = "bold 15px Arial";
            ctx.textAlign = "right";
            ctx.fillText(`Rientro ${Math.ceil(me!.respawnRemainingSeconds)}s`, screenW - 22, panelY + 43);
        }

        if (this.state.selectedMode === "survival" && me) {
            this.drawPowerUpBadge(ctx, screenW - 116, panelY + 22, me.powerCubes, 16);
            ctx.fillStyle = "#f6f0b4";
            ctx.font = "bold 13px Arial";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText("Power-up", screenW - 92, panelY + 22, 70);
        }

        if (me?.character) {
            this.drawAbilityButtons(ctx, me, screenW, panelY + 55);
        }
    }

    /**
     * Prepara una riga obiettivo leggibile per la HUD.
     * La frase cambia in base alla modalita, senza esporre dati tecnici al giocatore.
     */
    private getObjectiveText(): string {
        if (!this.state) {
            return "Herosurv";
        }

        if (this.state.gemGrab) {
            const countdownText = this.state.gemGrab.countdownTeamId
                ? ` | Countdown ${this.getTeamDisplayName(this.state.gemGrab.countdownTeamId)}: ${Math.ceil(this.state.gemGrab.countdownRemainingSeconds)}s`
                : "";
            return `Arraffagemme | Rosse ${this.state.gemGrab.redGems}/${this.state.gemGrab.targetGems} - Blu ${this.state.gemGrab.blueGems}/${this.state.gemGrab.targetGems}${countdownText}`;
        }

        if (this.state.survival) {
            const aliveCount = Object.values(this.state.players).filter((player) => !player.isEliminated).length;
            const shrinkText = this.state.survival.nextShrinkHintSeconds > 0
                ? ` | Zona chiude tra ${Math.ceil(this.state.survival.nextShrinkHintSeconds)}s`
                : ` | Raggio sicuro ${Math.round(this.state.survival.safeRadius)}`;
            return `Sopravvivenza | Vivi ${aliveCount}${shrinkText}`;
        }

        return "Scegli una modalita per iniziare.";
    }

    /**
     * Converte l'id squadra in un nome breve da HUD.
     * La UI non deve mostrare parole inglesi come red/blue.
     */
    private getTeamDisplayName(teamId: string): string {
        return teamId === "red" ? "Rosse" : "Blu";
    }

    /**
     * Disegna i bottoni delle abilita con overlay del cooldown.
     * Un overlay scuro indica quanta ricarica manca.
     */
    private drawAbilityButtons(
        ctx: CanvasRenderingContext2D,
        me: OurSpacePublicPlayerState,
        screenW: number,
        panelY: number
    ): void {
        const buttonSize = 46;
        const gap = 10;
        const ultWidth = buttonSize + 24;
        const totalWidth = buttonSize + gap + buttonSize + gap + ultWidth;
        const startX = screenW / 2 - totalWidth / 2;
        const buttonY = panelY + 6;

        this.basicAttackButton.setLabel("M1");
        this.basicAttackButton.setColors({
            main: me.basicAttackCooldownReadyPercent >= 100 ? "#2d8f94" : "#31535b",
            text: "#ffffff",
            shadow: "#082329",
        });
        this.basicAttackButton.draw(ctx, startX, buttonY, buttonSize, buttonSize);
        const basicBlockedHeight = buttonSize * (1 - me.basicAttackCooldownReadyPercent / 100);
        if (basicBlockedHeight > 1) {
            ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
            ctx.fillRect(startX, buttonY, buttonSize, basicBlockedHeight);
        }
        ctx.fillStyle = "#dfe6ef";
        ctx.font = "11px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(
            this.trimTextToWidth(ctx, me.basicAttackName ?? "Attacco", buttonSize + 32),
            startX + buttonSize / 2,
            panelY + 55,
            buttonSize + 32
        );

        this.abilityButtons.forEach((button, index) => {
            const x = startX + buttonSize + gap + index * (buttonSize + gap);
            button.setLabel(`${index + 1}`);
            button.draw(ctx, x, buttonY, buttonSize, buttonSize);

            const readyPercent = me.abilityCooldownReadyPercents[index] ?? 100;
            const blockedHeight = buttonSize * (1 - readyPercent / 100);

            if (blockedHeight > 1) {
                ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
                ctx.fillRect(x, buttonY, buttonSize, blockedHeight);
            }

            ctx.fillStyle = "#dfe6ef";
            ctx.font = "11px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            const abilityName = this.trimTextToWidth(ctx, me.abilityNames[index] ?? "", buttonSize + 18);
            ctx.fillText(abilityName, x + buttonSize / 2, panelY + 55, buttonSize + 18);
        });

        const ultX = startX + buttonSize + gap + buttonSize + gap;
        const ultimateReady = me.character?.ultimateChargePercent ?? 0;
        this.ultimateButton.setColors({
            main: ultimateReady >= 100 ? "#d89b24" : "#5a4930",
            text: "#ffffff",
            shadow: "#1b1204",
        });
        this.ultimateButton.draw(ctx, ultX, buttonY, ultWidth, buttonSize);

        ctx.fillStyle = "rgba(255, 214, 92, 0.28)";
        ctx.fillRect(ultX, buttonY + buttonSize - buttonSize * clamp(ultimateReady / 100, 0, 1), ultWidth, buttonSize * clamp(ultimateReady / 100, 0, 1));

        ctx.fillStyle = "#ffffff";
        ctx.font = "12px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(`${Math.floor(ultimateReady)}%`, ultX + ultWidth / 2, panelY + 55);
    }

    /**
     * Disegna gli ultimi eventi di combattimento.
     * Manteniamo poche righe per non coprire l'arena.
     */
    private drawEventLog(ctx: CanvasRenderingContext2D, screenW: number): void {
        const x = 22;
        let y = 22;

        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.font = "14px Arial";

        for (const event of this.visibleEvents) {
            ctx.fillStyle = event.kind === "damage"
                ? "#ffd1a6"
                : event.kind === "elimination"
                    ? "#ff8fa0"
                    : event.kind === "objective"
                        ? "#ffd65c"
                        : "#dfe7f0";
            ctx.fillText(event.message, x, y, Math.max(240, screenW * 0.42));
            y += 20;
        }
    }

    /**
     * Prepara un messaggio finale diverso per vittoria, sconfitta e pareggio.
     */
    private getGameOverCopy(): { title: string; subtitle: string; color: string } {
        if (!this.state) {
            return { title: "Partita conclusa", subtitle: "", color: "#ffffff" };
        }

        const me = this.state.players[this.myId];
        const winner = this.state.winnerId ? this.state.players[this.state.winnerId] : null;

        if (!winner) {
            return {
                title: "Pareggio",
                subtitle: "Nessuno ha chiuso la partita: bella lotta.",
                color: "#dfe7f0",
            };
        }

        const didWin = this.state.selectedMode === "gemGrab"
            ? me?.teamId !== null && me?.teamId === winner.teamId
            : this.state.winnerId === this.myId;

        if (didWin) {
            return {
                title: "Vittoria!",
                subtitle: this.state.selectedMode === "gemGrab"
                    ? `${this.getTeamNameForUi(winner.teamId)} ha tenuto le gemme fino alla fine.`
                    : "Sei rimasto l'ultimo in piedi.",
                color: "#ffd65c",
            };
        }

        return {
            title: "Sconfitta",
            subtitle: this.state.selectedMode === "gemGrab"
                ? `${this.getTeamNameForUi(winner.teamId)} ha completato il countdown.`
                : `${winner.name} ha vinto la Sopravvivenza.`,
            color: "#ff8fa0",
        };
    }

    private getTeamNameForUi(teamId: string | null): string {
        if (teamId === "red") {
            return "La squadra rossa";
        }

        if (teamId === "blue") {
            return "La squadra blu";
        }

        return "Il vincitore";
    }

    /**
     * Disegna la schermata finale sopra l'arena.
     * Il bottone exit riporta alla lobby principale.
     */
    private drawGameOver(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
        if (!this.state) {
            return;
        }

        ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
        ctx.fillRect(0, 0, screenW, screenH);

        const resultCopy = this.getGameOverCopy();

        ctx.fillStyle = resultCopy.color;
        ctx.font = "bold 42px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(resultCopy.title, screenW / 2, screenH / 2 - 72);

        ctx.font = "bold 21px Arial";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(resultCopy.subtitle, screenW / 2, screenH / 2 - 28, Math.max(280, screenW - 80));

        const players = Object.values(this.state.players).sort((a, b) => {
            return b.roundStats.eliminations - a.roundStats.eliminations
                || b.roundStats.damageDealt - a.roundStats.damageDealt
                || b.heldGems - a.heldGems
                || b.powerCubes - a.powerCubes;
        });
        const tableW = Math.min(620, screenW - 44);
        const tableX = screenW / 2 - tableW / 2;
        let tableY = screenH / 2 + 18;

        ctx.fillStyle = "rgba(15, 20, 28, 0.88)";
        ctx.fillRect(tableX, tableY, tableW, Math.min(190, 34 + players.length * 24));
        ctx.strokeStyle = "#556171";
        ctx.strokeRect(tableX + 1, tableY + 1, tableW - 2, Math.min(190, 34 + players.length * 24) - 2);

        ctx.fillStyle = "#cbd6e2";
        ctx.font = "bold 13px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("Giocatore", tableX + 14, tableY + 12);
        ctx.fillText("KO", tableX + tableW * 0.42, tableY + 12);
        ctx.fillText("Danni", tableX + tableW * 0.54, tableY + 12);
        ctx.fillText(this.state.selectedMode === "gemGrab" ? "Gemme" : "Power-up", tableX + tableW * 0.72, tableY + 12);
        ctx.fillText("Hit", tableX + tableW * 0.86, tableY + 12);

        tableY += 34;
        ctx.font = "13px Arial";
        players.slice(0, 6).forEach((player, index) => {
            const y = tableY + index * 24;
            const hitRate = player.roundStats.shotsFired > 0
                ? Math.round((player.roundStats.shotsHit / player.roundStats.shotsFired) * 100)
                : 0;
            ctx.fillStyle = player.id === this.myId ? "#ffffff" : "#dfe7f0";
            ctx.fillText(player.name, tableX + 14, y);
            ctx.fillText(`${player.roundStats.eliminations}`, tableX + tableW * 0.42, y);
            ctx.fillText(`${Math.round(player.roundStats.damageDealt)}`, tableX + tableW * 0.54, y);
            ctx.fillText(
                `${this.state.selectedMode === "gemGrab" ? player.roundStats.gemsCollected : player.powerCubes}`,
                tableX + tableW * 0.72,
                y
            );
            ctx.fillText(`${hitRate}%`, tableX + tableW * 0.86, y);
        });

        this.exitButton.draw(ctx, screenW / 2 - 58, screenH - 74, 116, 42);
    }

}
