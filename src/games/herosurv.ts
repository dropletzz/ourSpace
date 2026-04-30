/**
 * ============================================================
 * HEROSURV ARENA - ourSpace
 * ============================================================
 * Gioco arena multiplayer con personaggi e abilità.
 * 
 * La selezione del personaggio avviene DENTRO il gioco,
 * non nella lobby generale.
 * 
 * Il codice è commentato per essere didattico e comprensibile.
 * ============================================================
 */

import { Player, Rectangle, getCollisionSide, CollisionSide, mod } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameServer, GameClient } from './game';
import { UserInput } from '../client/user-input';
import { Button } from '../client/ui-elements';
// Import del sistema personaggi
import { 
    Character, 
    CharacterType, 
    createCharacter, 
    isAlive, 
    applyDamage,
    canUseAbility,
    useAbility,
    UltimateManager,
    BrawlerUltimate,
    SniperUltimate,
    HealerUltimate,
    ControllerUltimate
} from './character-system';

// ============================================================
// MESSAGGI DI RETE
// ============================================================

/**
 * Messaggio dal server al client con lo stato del gioco.
 */
type HeroSurvServerMsg = {
    kind: "herosurv_update";
    gameState: HeroSurvGameState;
    events: HeroSurvEvent[];
};

/**
 * Messaggio dal client al server con l'input di gioco.
 */
type HeroSurvClientMsg = {
    kind: "herosurv_input";
    moveX: number;      // -1, 0, 1 (direzione movimento)
    moveY: number;      // -1, 0, 1
    abilityIndex: number;  // 0-3 (abilità da usare)
    useUltimate: boolean;  // true per usare la ultimate
};

/**
 * Messaggio per selezionare il personaggio.
 */
type HeroSurvSelectCharacterMsg = {
    kind: "herosurv_select_character";
    characterType: CharacterType;  // Tipo di personaggio scelto
};

/**
 * Eventi di gioco da mostrare al client.
 */
type HeroSurvEvent = {
    type: "damage" | "death" | "ability" | "ult" | "respawn";
    playerId: string;
    value?: number;
    targetId?: string;
    message?: string;
};

// ============================================================
// STATO DEL GIOCO
// ============================================================

/**
 * Stato completo del gioco HeroSurv.
 */
type HeroSurvGameState = {
    // Fase del gioco: "select" = selezione personaggio, "play" = in gioco
    gamePhase: "select" | "play";
    
    // Informazioni sulla arena
    arenaWidth: number;
    arenaHeight: number;
    
    // Giocatori nel gioco
    players: Record<string, HeroSurvPlayer>;
    
    // Indica se la partita è finita
    gameOver: boolean;
    
    // ID del vincitore
    winnerId?: string;
    
    // Tempo di gioco trascorso (in secondi)
    gameTime: number;
};

/**
 * Informazioni di un giocatore nel gioco.
 */
type HeroSurvPlayer = {
    // Dati base del giocatore
    id: string;
    name: string;
    characterType: CharacterType;
    
    // Posizione nella arena
    x: number;
    y: number;
    
    // Personaggio (contiene statistiche, abilità, ultimate)
    character: Character;
    
    // Manager per la ultimate
    ultimateManager: UltimateManager;
    
    // Stato del giocatore
    isDead: boolean;
    respawnTime: number;  // Tempo fino al respawn (0 se vivo)
    
    // Input corrente
    moveX: number;
    moveY: number;
    lastAbilityUsed: number;  // Indice dell'ultima abilità usata
};

// ============================================================
// COSTANTI DI GIOCO
// ============================================================

const ARENA_WIDTH = 800;      // Larghezza arena
const ARENA_HEIGHT = 600;     // Altezza arena
const RESPAWN_TIME = 5;       // Tempo di respawn in secondi
const MAX_GAME_TIME = 600;    // Tempo massimo di gioco (10 minuti)

// ============================================================
// SERVER
// ============================================================

/**
 * Server del gioco HeroSurv.
 * Gestisce la logica di gioco lato server.
 */
export class HeroSurvGameServer extends GameServer {
    // Stato del gioco
    private gameState: HeroSurvGameState;
    
    // Mappa dei giocatori
    private gamePlayers: Record<string, HeroSurvPlayer> = {};
    
    // Messaggio iniziale da inviare
    private initMessage: HeroSurvServerMsg | null = null;
    
    // Eventi accumulati da inviare
    private pendingEvents: HeroSurvEvent[] = [];

    constructor() {
        super();
        
        // Inizializza lo stato del gioco
        this.gameState = {
            gamePhase: "select",  // Inizia con selezione personaggio
            arenaWidth: ARENA_WIDTH,
            arenaHeight: ARENA_HEIGHT,
            players: {},
            gameOver: false,
            gameTime: 0
        };
    }

    /**
     * Inizializza il gioco con i giocatori.
     * I giocatori selezioneranno il personaggio DENTRO il gioco.
     */
    init(players: Record<string, Player>) {
        this.gamePlayers = {};
        
        // Crea i giocatori SENZA personaggio (selezione in-game)
        Object.entries(players).forEach(([id, player]) => {
            this.gamePlayers[id] = {
                id,
                name: player.name,
                characterType: "brawler" as CharacterType, // Default temporaneo
                x: 0,
                y: 0,
                character: null as any, // Non creato ancora
                ultimateManager: null as any,
                isDead: false,
                respawnTime: 0,
                moveX: 0,
                moveY: 0,
                lastAbilityUsed: -1
            };
        });
        
        // Inizia nella fase di selezione personaggio
        this.gameState.gamePhase = "select";
        this.gameState.players = this.gamePlayers;
        
        // Prepara il messaggio iniziale
        this.initMessage = {
            kind: "herosurv_update",
            gameState: this.gameState,
            events: []
        };
    }

    /**
     * Seleziona il personaggio per un giocatore.
     * Chiamato quando il giocatore sceglie dentro il gioco.
     */
    selectCharacter(playerId: string, characterType: CharacterType) {
        const player = this.gamePlayers[playerId];
        if (!player) return;
        
        // Crea il personaggio
        const character = createCharacter(characterType, playerId);
        
        // Posiziona il giocatore in una posizione casuale
        const x = Math.random() * (ARENA_WIDTH - 100) + 50;
        const y = Math.random() * (ARENA_HEIGHT - 100) + 50;
        
        // Crea il manager per la ultimate
        const ultimateManager = new UltimateManager(character);
        this.setupUltimate(characterType, character, ultimateManager);
        
        // Aggiorna il giocatore
        player.characterType = characterType;
        player.character = character;
        player.ultimateManager = ultimateManager;
        player.x = x;
        player.y = y;
        
        // Registra l'evento
        this.pendingEvents.push({
            type: "ability",
            playerId: playerId,
            message: `${player.name} ha scelto ${character.name}!`
        });
        
        // Controlla se tutti hanno selezionato
        this.checkAllSelected();
    }

    /**
     * Controlla se tutti i giocatori hanno selezionato il personaggio.
     */
    private checkAllSelected() {
        const allSelected = Object.values(this.gamePlayers).every(p => p.character !== null);
        
        if (allSelected) {
            // Tutti hanno selezionato, inizia il gioco
            this.gameState.gamePhase = "play";
            this.pendingEvents.push({
                type: "ability",
                playerId: "",
                message: "Tutti i giocatori sono pronti! Via!"
            });
        }
    }

    /**
     * Determina il tipo di personaggio dal nome.
     */
    private getCharacterTypeFromName(characterName: string): CharacterType {
        const nameLower = characterName.toLowerCase();
        if (nameLower.includes("briar") || nameLower.includes("brawler")) {
            return "brawler";
        } else if (nameLower.includes("mira") || nameLower.includes("sniper")) {
            return "sniper";
        } else if (nameLower.includes("lumina") || nameLower.includes("healer")) {
            return "healer";
        } else if (nameLower.includes("vortice") || nameLower.includes("controller")) {
            return "controller";
        }
        // Default: Brawler
        return "brawler";
    }

    /**
     * Configura la ultimate per il tipo di personaggio.
     */
    private setupUltimate(type: CharacterType, character: Character, manager: UltimateManager) {
        switch (type) {
            case "brawler":
                manager.setUltimate(new BrawlerUltimate(character as any));
                break;
            case "sniper":
                manager.setUltimate(new SniperUltimate(character as any));
                break;
            case "healer":
                manager.setUltimate(new HealerUltimate(character as any));
                break;
            case "controller":
                manager.setUltimate(new ControllerUltimate(character as any));
                break;
        }
    }

    /**
     * Loop principale del gioco.
     * Aggiorna la logica di gioco ogni tick.
     */
    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        const outgoingMessages: OutgoingMsg[] = [];
        
        // Invia il messaggio iniziale se presente
        if (this.initMessage) {
            outgoingMessages.push({ payload: this.initMessage });
            this.initMessage = null;
        }
        
        // Se il gioco è finito, non fare nulla
        if (this.gameState.gameOver) {
            return outgoingMessages;
        }
        
        // Aggiorna il tempo di gioco
        this.gameState.gameTime += dt;
        
        // Controlla se il tempo massimo è scaduto
        if (this.gameState.gameTime >= MAX_GAME_TIME) {
            this.endGameByTime();
            return outgoingMessages;
        }
        
        // Processa i messaggi in ingresso
        this.processIncomingMessages(incomingMessages);
        
        // Aggiorna la logica di gioco
        this.updateGameLogic(dt);
        
        // Controlla le condizioni di vittoria
        this.checkWinCondition();
        
        // Invia lo stato aggiornato
        const updateMsg: HeroSurvServerMsg = {
            kind: "herosurv_update",
            gameState: this.gameState,
            events: [...this.pendingEvents]
        };
        outgoingMessages.push({ payload: updateMsg });
        
        // Pulisci gli eventi pendenti
        this.pendingEvents = [];
        
        return outgoingMessages;
    }

    /**
     * Processa i messaggi in ingresso dai client.
     */
    private processIncomingMessages(messages: IncomingMsg[]) {
        messages.forEach(message => {
            const clientId = message.clientId;
            const payload = message.payload;
            
            // Trova il giocatore
            const player = this.gamePlayers[clientId];
            if (!player) return;
            
            // FASE 1: Selezione personaggio
            if (this.gameState.gamePhase === "select") {
                if (payload.kind === "herosurv_select_character") {
                    this.selectCharacter(clientId, payload.characterType);
                }
                return;
            }
            
            // FASE 2: Gioco (solo se il giocatore ha selezionato e non è morto)
            if (player.isDead || !player.character) return;
            
            // Processa l'input di movimento
            if (payload.kind === "herosurv_input") {
                player.moveX = payload.moveX;
                player.moveY = payload.moveY;
                
                // Processa l'uso delle abilità
                if (payload.abilityIndex >= 0 && payload.abilityIndex < 4) {
                    this.useAbility(player, payload.abilityIndex);
                }
                
                // Processa l'uso della ultimate
                if (payload.useUltimate) {
                    this.useUltimate(player);
                }
            }
        });
    }

    /**
     * Usa un'abilità del giocatore.
     */
    private useAbility(player: HeroSurvPlayer, abilityIndex: number) {
        // Controlla se l'abilità è disponibile
        if (!canUseAbility(player.character, abilityIndex)) {
            return;
        }
        
        // Usa l'abilità
        useAbility(player.character, abilityIndex);
        
        // Registra l'evento
        const ability = player.character.abilities[abilityIndex];
        this.pendingEvents.push({
            type: "ability",
            playerId: player.id,
            message: `${player.name} usa ${ability.name}`
        });
        
        // Applica l'effetto dell'abilità
        this.applyAbilityEffect(player, abilityIndex);
        
        // Registra l'ultima abilità usata
        player.lastAbilityUsed = abilityIndex;
    }

    /**
     * Applica l'effetto di un'abilità.
     */
    private applyAbilityEffect(user: HeroSurvPlayer, abilityIndex: number) {
        const ability = user.character.abilities[abilityIndex];
        
        // Trova i bersagli nell'area
        const targets = this.getTargetsInRange(user, 150);
        
        switch (user.characterType) {
            case "brawler":
                this.applyBrawlerAbility(user, abilityIndex, targets);
                break;
            case "sniper":
                this.applySniperAbility(user, abilityIndex);
                break;
            case "healer":
                this.applyHealerAbility(user, abilityIndex, targets);
                break;
            case "controller":
                this.applyControllerAbility(user, abilityIndex, targets);
                break;
        }
    }

    /**
     * Applica gli effetti delle abilità del Brawler.
     */
    private applyBrawlerAbility(user: HeroSurvPlayer, abilityIndex: number, targets: HeroSurvPlayer[]) {
        switch (abilityIndex) {
            case 1: // Colpo Devastante
                if (targets.length > 0) {
                    const target = targets[0];
                    const damage = applyDamage(user.character, target.character, 50);
                    this.pendingEvents.push({
                        type: "damage",
                        playerId: user.id,
                        targetId: target.id,
                        value: damage
                    });
                }
                break;
            case 2: // Scudo Temporaneo (gestito lato client)
                break;
            case 3: // Carica (gestito lato client)
                break;
        }
    }

    /**
     * Applica gli effetti delle abilità dello Sniper.
     */
    private applySniperAbility(user: HeroSurvPlayer, abilityIndex: number) {
        switch (abilityIndex) {
            case 1: // Tiro Preciso (gestito lato client con flag)
                break;
            case 2: // Distrazione (gestito lato client)
                break;
            case 3: // Bomba Fumogena (gestito lato client)
                break;
        }
    }

    /**
     * Applica gli effetti delle abilità dell'Healer.
     */
    private applyHealerAbility(user: HeroSurvPlayer, abilityIndex: number, targets: HeroSurvPlayer[]) {
        switch (abilityIndex) {
            case 1: // Cura
                // Cura il giocatore stesso o un alleato vicino
                const healAmount = user.character.heal(50);
                this.pendingEvents.push({
                    type: "ability",
                    playerId: user.id,
                    value: healAmount,
                    message: `${user.name} si cura di ${healAmount}`
                });
                break;
            case 2: // Barriera (gestito lato client)
                break;
            case 3: // Rianimazione (gestito lato client)
                break;
        }
    }

    /**
     * Applica gli effetti delle abilità del Controller.
     */
    private applyControllerAbility(user: HeroSurvPlayer, abilityIndex: number, targets: HeroSurvPlayer[]) {
        switch (abilityIndex) {
            case 1: // Gelamento
                targets.forEach(target => {
                    const damage = applyDamage(user.character, target.character, 15);
                    this.pendingEvents.push({
                        type: "damage",
                        playerId: user.id,
                        targetId: target.id,
                        value: damage
                    });
                });
                break;
            case 2: // Catenaccio (gestito lato client)
                break;
            case 3: // Tempesta
                targets.forEach(target => {
                    const damage = applyDamage(user.character, target.character, 30);
                    this.pendingEvents.push({
                        type: "damage",
                        playerId: user.id,
                        targetId: target.id,
                        value: damage
                    });
                });
                break;
        }
    }

    /**
     * Usa la ultimate del giocatore.
     */
    private useUltimate(player: HeroSurvPlayer) {
        if (!player.ultimateManager.isReady()) {
            return;
        }
        
        // Attiva la ultimate
        const success = player.ultimateManager.activate();
        
        if (success) {
            this.pendingEvents.push({
                type: "ult",
                playerId: player.id,
                message: `${player.name} usa la Ultimate!`
            });
            
            // Applica l'effetto della ultimate
            this.applyUltimateEffect(player);
        }
    }

    /**
     * Applica l'effetto della ultimate.
     */
    private applyUltimateEffect(user: HeroSurvPlayer) {
        switch (user.characterType) {
            case "brawler":
                // Furia del Titano: danno x2 per 5 secondi (gestito nel personaggio)
                break;
            case "sniper":
                // Colpo del Destino: danno garantito (gestito lato client)
                break;
            case "healer":
                // Resurrezione di Massa: cura tutti
                Object.values(this.gamePlayers).forEach(p => {
                    if (!p.isDead && p.id !== user.id) {
                        p.character.heal(100);
                    }
                });
                break;
            case "controller":
                // Buco Nero: danno area (gestito lato client)
                break;
        }
    }

    /**
     * Ottiene i bersagli nell'area.
     */
    private getTargetsInRange(user: HeroSurvPlayer, range: number): HeroSurvPlayer[] {
        const targets: HeroSurvPlayer[] = [];
        
        Object.values(this.gamePlayers).forEach(p => {
            if (p.id === user.id || p.isDead) return;
            
            // Calcola la distanza
            const dx = p.x - user.x;
            const dy = p.y - user.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance <= range) {
                targets.push(p);
            }
        });
        
        return targets;
    }

    /**
     * Aggiorna la logica di gioco.
     */
    private updateGameLogic(dt: number) {
        // Aggiorna ogni giocatore
        Object.values(this.gamePlayers).forEach(player => {
            if (player.isDead) {
                // Aggiorna il timer di respawn
                if (player.respawnTime > 0) {
                    player.respawnTime -= dt;
                    if (player.respawnTime <= 0) {
                        this.respawnPlayer(player);
                    }
                }
                return;
            }
            
            // Aggiorna il movimento
            this.updatePlayerMovement(player, dt);
            
            // Aggiorna i cooldown delle abilità
            player.character.tick(dt);
            
            // Aggiorna la ultimate
            player.ultimateManager.tick(dt);
            
            // Attacco base automatico (se vicino a un nemico)
            this.handleAutoAttack(player, dt);
        });
    }

    /**
     * Aggiorna il movimento del giocatore.
     */
    private updatePlayerMovement(player: HeroSurvPlayer, dt: number) {
        // Calcola la nuova posizione
        const newX = player.x + player.moveX * player.character.moveSpeed * dt;
        const newY = player.y + player.moveY * player.character.moveSpeed * dt;
        
        // Limita la posizione all'interno dell'arena
        const halfWidth = player.character.width / 2;
        const halfHeight = player.character.height / 2;
        
        player.x = Math.max(halfWidth, Math.min(ARENA_WIDTH - halfWidth, newX));
        player.y = Math.max(halfHeight, Math.min(ARENA_HEIGHT - halfHeight, newY));
    }

    /**
     * Gestisce l'attacco automatico.
     */
    private handleAutoAttack(player: HeroSurvPlayer, dt: number) {
        // Trova il nemico più vicino
        let closestEnemy: HeroSurvPlayer | null = null;
        let closestDistance = Infinity;
        
        Object.values(this.gamePlayers).forEach(p => {
            if (p.id === player.id || p.isDead) return;
            
            const dx = p.x - player.x;
            const dy = p.y - player.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < closestDistance) {
                closestDistance = distance;
                closestEnemy = p;
            }
        });
        
        // Se c'è un nemico abbastanza vicino, attacca
        if (closestEnemy && closestDistance < 50) {
            const damage = applyDamage(player.character, closestEnemy!.character, player.character.baseDamage * dt);
            if (damage > 0) {
                this.pendingEvents.push({
                    type: "damage",
                    playerId: player.id,
                    targetId: closestEnemy!.id,
                    value: damage
                });
            }
        }
    }

    /**
     * Fa respawnare un giocatore.
     */
    private respawnPlayer(player: HeroSurvPlayer) {
        // Nuova posizione casuale
        player.x = Math.random() * (ARENA_WIDTH - 100) + 50;
        player.y = Math.random() * (ARENA_HEIGHT - 100) + 50;
        
        // Ripristina la salute
        player.character.currentHealth = player.character.maxHealth;
        
        // Ripristina lo stato
        player.isDead = false;
        player.respawnTime = 0;
        
        this.pendingEvents.push({
            type: "respawn",
            playerId: player.id,
            message: `${player.name} è tornato in gioco!`
        });
    }

    /**
     * Termina il gioco per tempo scaduto.
     */
    private endGameByTime() {
        this.gameState.gameOver = true;
        
        // Trova il giocatore con più salute
        let winner: HeroSurvPlayer | null = null;
        let maxHealth = 0;
        
        Object.values(this.gamePlayers).forEach(p => {
            if (p.character.currentHealth > maxHealth) {
                maxHealth = p.character.currentHealth;
                winner = p;
            }
        });
        
        if (winner) {
            this.gameState.winnerId = winner.id;
        }
    }

    /**
     * Controlla le condizioni di vittoria.
     */
    private checkWinCondition() {
        // Conta i giocatori vivi
        const alivePlayers = Object.values(this.gamePlayers).filter(p => !p.isDead);
        
        // Se rimane un solo giocatore, vince
        if (alivePlayers.length === 1) {
            this.gameState.gameOver = true;
            this.gameState.winnerId = alivePlayers[0].id;
            
            this.pendingEvents.push({
                type: "death",
                playerId: alivePlayers[0].id,
                message: `${alivePlayers[0].name} vince la partita!`
            });
        }
        
        // Se rimangono 0 giocatori, pareggio
        if (alivePlayers.length === 0) {
            this.gameState.gameOver = true;
        }
    }

    /**
     * Controlla se il gioco è finito.
     */
    isFinished(): boolean {
        return this.gameState.gameOver;
    }
}

// ============================================================
// CLIENT
// ============================================================

/**
 * Client del gioco HeroSurv.
 * Gestisce il rendering e l'input lato client.
 */
export class HeroSurvGameClient extends GameClient {
    // Stato del gioco
    private gameState: HeroSurvGameState | null = null;
    
    // Eventi da visualizzare
    private events: HeroSurvEvent[] = [];
    
    // Messaggi da inviare
    private messages: any[] = [];
    
    // Bottoni per le abilità
    private abilityButtons: Button[] = [];
    private ultimateButton: Button;
    
    // Bottoni per selezione personaggio
    private characterButtons: Button[] = [];
    private selectedCharacterIndex: number = 0;
    
    // Input del giocatore
    private moveX: number = 0;
    private moveY: number = 0;

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
        
        // Nomi dei personaggi disponibili
        const characterNames = ["Briar", "Mira", "Lumina", "Vortice"];
        const characterTypes: CharacterType[] = ["brawler", "sniper", "healer", "controller"];
        
        // Crea i bottoni per selezionare il personaggio
        for (let i = 0; i < 4; i++) {
            const type = characterTypes[i];
            this.characterButtons.push(new Button(characterNames[i], userInput, () => {
                this.selectCharacter(i);
            }));
        }
        
        // Crea i bottoni per le abilità
        for (let i = 0; i < 4; i++) {
            this.abilityButtons.push(new Button(`Ability ${i + 1}`, userInput, () => {
                this.useAbility(i);
            }));
        }
        
        // Crea il bottone per la ultimate
        this.ultimateButton = new Button("ULT", userInput, () => {
            this.useUltimate();
        });
    }

    /**
     * Seleziona un personaggio e invia al server.
     */
    private selectCharacter(index: number) {
        this.selectedCharacterIndex = index;
        
        const characterTypes: CharacterType[] = ["brawler", "sniper", "healer", "controller"];
        
        // Invia la selezione al server
        this.messages.push({
            kind: "herosurv_select_character",
            characterType: characterTypes[index]
        });
    }

    /**
     * Inizializza il gioco con i giocatori.
     */
    init(players: Record<string, Player>) {
        // Già inizializzato dal server
    }

    /**
     * Loop di rendering del gioco.
     */
    draw(ctx: CanvasRenderingContext2D, dt: number) {
        if (!this.gameState) return;
        
        const { screenW, screenH } = this.userInput;
        
        // FASE 1: Schermata di selezione personaggio
        if (this.gameState.gamePhase === "select") {
            this.drawCharacterSelection(ctx, screenW, screenH);
            return;
        }
        
        // FASE 2: Gioco normale
        // Sfondo dell'arena
        ctx.fillStyle = "#1a1a2e";
        ctx.fillRect(0, 0, screenW, screenH);
        
        // Disegna l'arena
        this.drawArena(ctx, screenW, screenH);
        
        // Disegna i giocatori
        this.drawPlayers(ctx, screenW, screenH);
        
        // Disegna l'UI
        this.drawUI(ctx, screenW, screenH);
        
        // Disegna gli eventi
        this.drawEvents(ctx, screenW, screenH);
    }

    /**
     * Disegna la schermata di selezione personaggio.
     */
    private drawCharacterSelection(ctx: CanvasRenderingContext2D, screenW: number, screenH: number) {
        // Sfondo
        ctx.fillStyle = "#1a1a2e";
        ctx.fillRect(0, 0, screenW, screenH);
        
        // Titolo
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 32px Arial";
        ctx.textAlign = "center";
        ctx.fillText("SCEGLI IL TUO PERSONAGGIO", screenW / 2, 80);
        
        // Descrizione ruoli
        ctx.font = "18px Arial";
        ctx.fillText("Briar = Tank  |  Mira = DPS  |  Lumina = Healer  |  Vortice = Controller", screenW / 2, 120);
        
        // Colori per ogni personaggio
        const colors = ["#e53935", "#43a047", "#1e88e5", "#8e24aa"];
        const names = ["BRIAR", "MIRA", "LUMINA", "VORTICE"];
        const roles = ["Tank - Alta vita, basso danno", "DPS - Bassa vita, alto danno", "Support - Cura gli alleati", "Controller - Rallenta i nemici"];
        
        // Disegna i 4 personaggi come opzioni
        const cardWidth = 150;
        const cardHeight = 200;
        const spacing = 30;
        const startX = screenW / 2 - (4 * cardWidth + 3 * spacing) / 2;
        
        for (let i = 0; i < 4; i++) {
            const x = startX + i * (cardWidth + spacing);
            const y = screenH / 2 - cardHeight / 2;
            
            // Sfondo della carta (evidenzia se selezionato)
            if (i === this.selectedCharacterIndex) {
                ctx.fillStyle = "#FFD700"; // Oro per selezionato
                ctx.fillRect(x - 5, y - 5, cardWidth + 10, cardHeight + 10);
            }
            
            ctx.fillStyle = colors[i];
            ctx.fillRect(x, y, cardWidth, cardHeight);
            
            // Nome
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 20px Arial";
            ctx.textAlign = "center";
            ctx.fillText(names[i], x + cardWidth / 2, y + 40);
            
            // Ruolo
            ctx.font = "14px Arial";
            ctx.fillText(roles[i], x + cardWidth / 2, y + 80);
            
            // Pulsante (visivo)
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(x + 25, y + cardHeight - 50, cardWidth - 50, 30);
            ctx.fillStyle = "#000000";
            ctx.font = "bold 14px Arial";
            ctx.fillText("SELEZIONA", x + cardWidth / 2, y + cardHeight - 30);
        }
        
        // Istruzioni
        ctx.fillStyle = "#aaaaaa";
        ctx.font = "16px Arial";
        ctx.fillText("Usa i tasti 1-4 per selezionare, poi clicca il pulsante", screenW / 2, screenH - 50);
    }

    /**
     * Disegna l'arena.
     */
    private drawArena(ctx: CanvasRenderingContext2D, screenW: number, screenH: number) {
        // Bordo dell'arena
        ctx.strokeStyle = "#4a4a6a";
        ctx.lineWidth = 4;
        ctx.strokeRect(50, 50, screenW - 100, screenH - 100);
        
        // Griglia dell'arena
        ctx.strokeStyle = "#2a2a4a";
        ctx.lineWidth = 1;
        for (let x = 100; x < screenW - 50; x += 100) {
            ctx.beginPath();
            ctx.moveTo(x, 50);
            ctx.lineTo(x, screenH - 50);
            ctx.stroke();
        }
        for (let y = 100; y < screenH - 50; y += 100) {
            ctx.beginPath();
            ctx.moveTo(50, y);
            ctx.lineTo(screenW - 50, y);
            ctx.stroke();
        }
    }

    /**
     * Disegna i giocatori.
     */
    private drawPlayers(ctx: CanvasRenderingContext2D, screenW: number, screenH: number) {
        if (!this.gameState) return;
        
        Object.values(this.gameState.players).forEach(player => {
            if (player.isDead) return;
            
            // Posizione del giocatore (mappata da coordinate arena a schermo)
            const x = 50 + (player.x / this.gameState.arenaWidth) * (screenW - 100);
            const y = 50 + (player.y / this.gameState.arenaHeight) * (screenH - 100);
            
            // Colore del giocatore basato sul tipo
            const color = this.getCharacterColor(player.characterType);
            
            // Disegna il giocatore
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, 20, 0, Math.PI * 2);
            ctx.fill();
            
            // Bordo del giocatore
            ctx.strokeStyle = player.id === this.myId ? "#ffffff" : "#000000";
            ctx.lineWidth = player.id === this.myId ? 3 : 2;
            ctx.stroke();
            
            // Nome del giocatore
            ctx.fillStyle = "#ffffff";
            ctx.font = "12px Arial";
            ctx.textAlign = "center";
            ctx.fillText(player.name, x, y - 30);
            
            // Barra della vita
            const healthPercent = player.character.currentHealth / player.character.maxHealth;
            ctx.fillStyle = "#333333";
            ctx.fillRect(x - 25, y - 25, 50, 6);
            ctx.fillStyle = healthPercent > 0.5 ? "#4CAF50" : healthPercent > 0.25 ? "#FF9800" : "#f44336";
            ctx.fillRect(x - 25, y - 25, 50 * healthPercent, 6);
            
            // Indicatore della ultimate
            if (player.ultimateManager.isReady()) {
                ctx.fillStyle = "#FFD700";
                ctx.beginPath();
                ctx.arc(x + 20, y - 20, 8, 0, Math.PI * 2);
                ctx.fill();
            }
        });
    }

    /**
     * Ottiene il colore per un tipo di personaggio.
     */
    private getCharacterColor(type: CharacterType): string {
        switch (type) {
            case "brawler": return "#e53935";
            case "sniper": return "#43a047";
            case "healer": return "#1e88e5";
            case "controller": return "#8e24aa";
            default: return "#888888";
        }
    }

    /**
     * Disegna l'interfaccia utente.
     */
    private drawUI(ctx: CanvasRenderingContext2D, screenW: number, screenH: number) {
        // Tempo di gioco
        if (this.gameState) {
            const minutes = Math.floor(this.gameState.gameTime / 60);
            const seconds = Math.floor(this.gameState.gameTime % 60);
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 20px Arial";
            ctx.textAlign = "center";
            ctx.fillText(`${minutes}:${seconds.toString().padStart(2, '0')}`, screenW / 2, 30);
        }
        
        // Bottoni delle abilità (in basso a sinistra)
        const abilityY = screenH - 80;
        for (let i = 0; i < 4; i++) {
            this.abilityButtons[i].draw(ctx, 100 + i * 60, abilityY, 50, 40);
        }
        
        // Bottone della ultimate (in basso a destra)
        this.ultimateButton.draw(ctx, screenW - 100, abilityY, 80, 40);
    }

    /**
     * Disegna gli eventi di gioco.
     */
    private drawEvents(ctx: CanvasRenderingContext2D, screenW: number, screenH: number) {
        let y = 60;
        
        this.events.forEach(event => {
            if (!event.message) return;
            
            ctx.fillStyle = "#ffffff";
            ctx.font = "14px Arial";
            ctx.textAlign = "left";
            ctx.fillText(event.message, 60, y);
            y += 20;
        });
    }

    /**
     * Usa un'abilità.
     */
    private useAbility(index: number) {
        this.messages.push({
            kind: "herosurv_input",
            moveX: this.moveX,
            moveY: this.moveY,
            abilityIndex: index,
            useUltimate: false
        });
    }

    /**
     * Usa la ultimate.
     */
    private useUltimate() {
        this.messages.push({
            kind: "herosurv_input",
            moveX: this.moveX,
            moveY: this.moveY,
            abilityIndex: -1,
            useUltimate: true
        });
    }

    /**
     * Gestisce un messaggio dal server.
     */
    handleMessage(message: any) {
        if (message.kind === "herosurv_update") {
            this.gameState = message.gameState;
            this.events = message.events;
        }
    }

    /**
     * Invia i messaggi pendenti.
     */
    flushMessages(): any[] {
        const msgs = [...this.messages];
        this.messages = [];
        return msgs;
    }

    /**
     * Controlla se il gioco è finito.
     */
    isFinished(): boolean {
        return this.gameState?.gameOver ?? false;
    }
}