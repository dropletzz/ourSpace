// ============ IMPORT ============
// Importa i tipi base dal server e dal sistema di gioco comune
import type { Player } from '../common';
import type { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer } from './game';
import { UserInput } from '../client/user-input';
import { PacmanUserInput } from './pacman-input';

// ============ TIPI (TYPE) ============
// Define il tipo per le direzioni: frecce direzionali (sinistra, su, destra, giù)
type DirectionName = 'ArrowLeft' | 'ArrowUp' | 'ArrowRight' | 'ArrowDown';

// Definisce una direzione con il nome, il movimento in numero di celle e la rotazione in gradi
type Direction = {
    name: DirectionName;
    movement: number;
    rotation: number;
};

// Messaggio dal client: invia la direzione scelta dal giocatore
type PacmanClientMsg = {
    kind: 'pacmanInput';
    direction: DirectionName;
};

// Lo stato completo di un giocatore Pac-Man nel server
// Include posizione, direzione, vite, punteggio, stato di power-up, timer di movimento e respawn
type PacmanPlayerState = Player & {
    id: string;
    color: string;
    position: number;
    startPosition: number;
    direction: DirectionName | null;
    queuedDirection: DirectionName | null;
    lives: number;
    score: number;
    poweredUntil: number;
    respawnUntil: number;
    eliminated: boolean;
    moveTimer: number;
};

// Versione "pubblica" dello stato del giocatore (senza info sensibili come queuedDirection)
type PacmanPublicPlayer = Omit<PacmanPlayerState, 'queuedDirection' | 'moveTimer'> & {
    powered: boolean;
    respawning: boolean;
};

// Nomi dei 4 fantasmi classici del gioco Pac-Man
type GhostName = 'blinky' | 'pinky' | 'inky' | 'clyde';

// Lo stato interno di un fantasma nel server
// Include IA per seguire i giocatori (target, focusOn) e timer di movimento
type GhostState = {
    name: GhostName;
    color: string;
    startPosition: number;
    position: number;
    direction: DirectionName;
    focusOn: number;
    target: number;
    moveTimer: number;
};

// Versione "pubblica" del fantasma per il client (aggiunge lo stato "scared" quando power-up è attivo)
type GhostPublicState = Omit<GhostState, 'moveTimer'> & {
    scared: boolean;
};

// Una riga della classifica finale (nome, punteggio, vite, colore)
type LeaderboardRow = {
    id: string;
    name: string;
    score: number;
    lives: number;
    color: string;
    eliminated: boolean;
    winner: boolean;
};

// Messaggio di stato inviato dal server al client con tutte le info della partita
type PacmanStateMsg = {
    kind: 'pacmanState';
    players: Record<string, PacmanPublicPlayer>;
    playerOrder: string[];
    ghosts: GhostPublicState[];
    collectibles: number[];
    collectiblesLeft: number;
    gameTime: number;
    powerTimeLeft: number;
    gameOver: boolean;
    gameOverReason: string;
    finalTimeLeft: number;
    leaderboard: LeaderboardRow[];
};

// ============ COSTANTI DEL GIOCO ============
// Dimensioni della mappa (20x23 celle)
const BOARD_WIDTH = 20;
const BOARD_HEIGHT = 23;
// Numero massimo di giocatori (4)
const MAX_PLAYERS = 4;
// Vite iniziali di ogni giocatore
const PLAYER_LIVES = 3;

// VELOCITÀ DI MOVIMENTO (in secondi tra un movimento e il successivo)
const PACMAN_STEP_SECONDS = 0.35;          // Pac-Man si muove ogni 0.35 secondi
const GHOST_STEP_SECONDS = 0.45;           // I fantasmi si muovono ogni 0.45 secondi (più lenti di Pac-Man!)
const GHOST_SCARED_STEP_SECONDS = 0.55;    // Fantasmi spaventati ancora più lenti quando power-up è attivo

// DURATE DEGLI EFFETTI
const POWER_SECONDS = 8;            // Il power-up dura 8 secondi
const RESPAWN_SECONDS = 1.6;        // Tempo di respawn dopo la morte
const FINAL_DISPLAY_SECONDS = 8;    // Tempo di visualizzazione della schermata finale

// PUNTI
const DOT_SCORE = 10;       // Punti per mangiare un pallino
const PILL_SCORE = 50;      // Punti per mangiare una pillola (power-up)
const GHOST_SCORE = 200;    // Punti per mangiare un fantasma quando è spaventato

// Costanti per i tipi di tile della mappa
const TILE = {
    blank: 0,   // Spazio vuoto
    wall: 1,    // Muro
    dot: 2,     // Pallino (cibo)
    pill: 7,    // Pillola (power-up)
    lair: 9     // Tana dei fantasmi
} as const;

// ============ STRUTTURE DI GIOCO ============
// Mappa delle direzioni: collega il nome della direzione a movimento e rotazione
// movement: numero di celle da muovere (negativo = sinistra/su, positivo = destra/giù)
// rotation: rotazione dell'immagine in gradi (0=destra, 90=giù, 180=sinistra, 270=su)
const DIRECTIONS: Record<DirectionName, Direction> = {
    ArrowLeft: { name: 'ArrowLeft', movement: -1, rotation: 180 },
    ArrowUp: { name: 'ArrowUp', movement: -BOARD_WIDTH, rotation: 270 },
    ArrowRight: { name: 'ArrowRight', movement: 1, rotation: 0 },
    ArrowDown: { name: 'ArrowDown', movement: BOARD_WIDTH, rotation: 90 }
};

// Lista ordinata delle direzioni (usata per la logica IA dei fantasmi)
const DIRECTION_NAMES: DirectionName[] = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];

// Posizioni iniziali dei 4 giocatori Pac-Man
const PLAYER_STARTS = [287, 292, 221, 238];

// Colori dei 4 giocatori Pac-Man (giallo, azzurro, rosa, verde)
const PLAYER_COLORS = ['#ffd84d', '#7de2ff', '#ff7ab6', '#8cff8a'];

// Colori dei 4 fantasmi (rosso, rosa, azzurro, arancione)
const GHOST_COLORS: Record<GhostName, string> = {
    blinky: '#ff4a4a',
    pinky: '#ff9bd7',
    inky: '#56e7ff',
    clyde: '#ffad45'
};

// La mappa del gioco rappresentata come array di numeri (20x23)
// Mappa originale dal progetto PacMan classico
const LEVEL: number[] = [
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1,
    1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1,
    1, 7, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 7, 1,
    1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1,
    1, 2, 1, 1, 2, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 2, 1, 1, 2, 1,
    1, 2, 2, 2, 2, 1, 2, 2, 2, 1, 1, 2, 2, 2, 1, 2, 2, 2, 2, 1,
    1, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 1,
    0, 0, 0, 1, 2, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 2, 1, 0, 0, 0,
    0, 0, 0, 1, 2, 1, 2, 1, 9, 9, 9, 9, 1, 2, 1, 2, 1, 0, 0, 0,
    1, 1, 1, 1, 2, 1, 2, 1, 9, 9, 9, 9, 1, 2, 1, 2, 1, 1, 1, 1,
    1, 0, 0, 0, 2, 2, 2, 1, 9, 9, 9, 9, 1, 2, 2, 2, 0, 0, 0, 1,
    1, 1, 1, 1, 2, 1, 2, 1, 9, 9, 9, 9, 1, 2, 1, 2, 1, 1, 1, 1,
    0, 0, 0, 1, 2, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 2, 1, 0, 0, 0,
    0, 0, 0, 1, 2, 1, 2, 0, 0, 0, 0, 0, 0, 2, 1, 2, 1, 0, 0, 0,
    1, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 1,
    1, 2, 2, 2, 2, 1, 2, 2, 2, 1, 1, 2, 2, 2, 1, 2, 2, 2, 2, 1,
    1, 2, 1, 1, 2, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 2, 1, 1, 2, 1,
    1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1,
    1, 7, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 7, 1,
    1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1,
    1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
];

// ============ FUNZIONI DI SUPPORTO ============
// Controlla se un valore è una direzione valida
const isDirectionName = (value: any): value is DirectionName => value in DIRECTIONS;

// Ritorna la direzione opposta (usato per l'IA dei fantasmi)
const oppositeDirection = (direction: DirectionName): DirectionName => {
    if (direction === 'ArrowLeft') return 'ArrowRight';
    if (direction === 'ArrowRight') return 'ArrowLeft';
    if (direction === 'ArrowUp') return 'ArrowDown';
    return 'ArrowUp';
};

// Limita un numero tra min e max
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// Converte una posizione da indice singolo (0-459) a coordinate X,Y sulla mappa
const posToXY = (pos: number) => ({ x: pos % BOARD_WIDTH, y: Math.floor(pos / BOARD_WIDTH) });

// Calcola la distanza al quadrato tra due posizioni (usato per l'IA dei fantasmi)
const distanceSq = (a: number, b: number) => {
    const ap = posToXY(a);
    const bp = posToXY(b);
    const dx = ap.x - bp.x;
    const dy = ap.y - bp.y;
    return dx * dx + dy * dy;
};

// ============ CLASSE SERVER ============
export class PacmanServer extends GameServer {
    private players: Record<string, PacmanPlayerState> = {};
    private playerOrder: string[] = [];
    private ghosts: GhostState[] = [];
    private collectibles: number[] = [];
    private collectiblesLeft: number = 0;
    private gameTime: number = 0;
    private gameOver: boolean = false;
    private gameOverReason: string = '';
    private finalDisplayElapsed: number = 0;

    // Inizializza la partita: crea i giocatori, i fantasmi e la mappa di cibo
    init(players: Record<string, Player>) {
        this.players = {};
        this.playerOrder = Object.keys(players).slice(0, MAX_PLAYERS);
        this.gameTime = 0;
        this.gameOver = false;
        this.gameOverReason = '';
        this.finalDisplayElapsed = 0;
        this.resetCollectibles();

        // Crea ogni giocatore Pac-Man con il suo colore e posizione di partenza
        this.playerOrder.forEach((id, index) => {
            const startPosition = PLAYER_STARTS[index] ?? PLAYER_STARTS[0];
            this.players[id] = {
                ...players[id],
                id,
                color: PLAYER_COLORS[index % PLAYER_COLORS.length],
                position: startPosition,
                startPosition,
                direction: null,
                queuedDirection: null,
                lives: PLAYER_LIVES,
                score: 0,
                poweredUntil: 0,
                respawnUntil: 0,
                eliminated: false,
                moveTimer: 0
            };
        });

        // Crea i 4 fantasmi del gioco classico con diverse strategie di IA
        this.ghosts = [
            this.createGhost('blinky', 188, 19),
            this.createGhost('pinky', 209, 0),
            this.createGhost('inky', 230, 459),
            this.createGhost('clyde', 251, 440)
        ];
    }

    // Metodo principale: viene chiamato ogni frame (tick) per aggiornare lo stato del gioco
    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        if (this.gameOver) {
            // Se la partita è finita, semplicemente accumula il tempo di visualizzazione
            this.finalDisplayElapsed += dt;
            return [{ payload: this.makeState() }];
        }

        // Incrementa il tempo di gioco e processa i messaggi dal client
        this.gameTime += dt;
        incomingMessages.forEach(message => this.handleClientMessage(message));

        // Aggiorna posizioni e logica di gioco
        this.updatePacmen(dt);           // Muove i Pac-Man
        this.handleCollisions();          // Controlla collisioni con fantasmi
        this.updateGhosts(dt);            // Muove i fantasmi con IA
        this.handleCollisions();          // Ricontrolla collisioni (fantasmi potrebbero mangiare pill)
        this.checkEndConditions();        // Verifica se il gioco è finito

        return [{ payload: this.makeState() }];
    }

    // Verifica se la partita deve concludersi
    isFinished(): boolean {
        return this.gameOver && this.finalDisplayElapsed >= FINAL_DISPLAY_SECONDS;
    }

    // Crea un nuovo fantasma con posizione e strategia di follow iniziale
    private createGhost(name: GhostName, startPosition: number, focusOn: number): GhostState {
        return {
            name,
            color: GHOST_COLORS[name],
            startPosition,
            position: startPosition,
            direction: 'ArrowUp',
            focusOn,
            target: focusOn,
            moveTimer: 0
        };
    }

    // Inizializza i collectibles (pallini e pillole) da mangiare
    private resetCollectibles(): void {
        this.collectibles = LEVEL.map(tile => tile === TILE.dot || tile === TILE.pill ? tile : TILE.blank);
        this.collectiblesLeft = this.collectibles.filter(tile => tile === TILE.dot || tile === TILE.pill).length;
    }

    // Riceve i messaggi dal client e estrae la direzione desiderata del giocatore
    private handleClientMessage(message: IncomingMsg): void {
        const payload = message.payload as PacmanClientMsg;
        if (payload.kind !== 'pacmanInput' || !isDirectionName(payload.direction)) return;

        const player = this.players[message.clientId];
        if (!player || player.eliminated) return;
        // Salva la direzione per il prossimo movimento (coda di direzione)
        player.queuedDirection = payload.direction;
    }

    // Aggiorna la posizione di tutti i Pac-Man in base alla loro velocità e direzione
    private updatePacmen(dt: number): void {
        this.playerOrder.forEach(id => {
            const player = this.players[id];
            if (!player || player.eliminated || player.respawnUntil > this.gameTime) return;

            // Timer per controllare la velocità di movimento (PACMAN_STEP_SECONDS)
            player.moveTimer += dt;
            if (player.moveTimer < PACMAN_STEP_SECONDS) return;
            player.moveTimer %= PACMAN_STEP_SECONDS;

            // Se c'è una direzione in coda e può muoversi in quella direzione, cambia direzione
            if (player.queuedDirection && this.canPacmanMove(player.position, player.queuedDirection)) {
                player.direction = player.queuedDirection;
            }

            // Se può muoversi nella direzione attuale, muoviti
            if (player.direction && this.canPacmanMove(player.position, player.direction)) {
                player.position += DIRECTIONS[player.direction].movement;
            }

            // Controlla se hai mangiato un pallino o una pillola
            this.collectAtPlayerPosition(player);
        });
    }

    // Quando un giocatore arriva su una posizione, controlla se mangia un pallino/pillola
    private collectAtPlayerPosition(player: PacmanPlayerState): void {
        const tile = this.collectibles[player.position];
        if (tile !== TILE.dot && tile !== TILE.pill) return;

        this.collectibles[player.position] = TILE.blank;
        this.collectiblesLeft -= 1;

        if (tile === TILE.dot) {
            // Pallino: +10 punti
            player.score += DOT_SCORE;
        } else {
            // Pillola: +50 punti e attiva il power-up per 8 secondi
            player.score += PILL_SCORE;
            player.poweredUntil = this.gameTime + POWER_SECONDS;
        }
    }

    private updateGhosts(dt: number): void {
        const scared = this.areGhostsScared();
        const stepSeconds = scared ? GHOST_SCARED_STEP_SECONDS : GHOST_STEP_SECONDS;

        this.ghosts.forEach(ghost => {
            ghost.moveTimer += dt;
            if (ghost.moveTimer < stepSeconds) return;
            ghost.moveTimer %= stepSeconds;

            if (scared) {
                const movement = this.randomGhostMove(ghost);
                ghost.position = movement.nextMove;
                ghost.direction = movement.direction;
                return;
            }

            ghost.target = this.chooseGhostTarget(ghost);
            const movement = this.findGhostPath(ghost);
            ghost.position = movement.nextMove;
            ghost.direction = movement.direction;
        });
    }

    private chooseGhostTarget(ghost: GhostState): number {
        const activePlayers = this.getActivePlayers();
        if (activePlayers.length === 0) return ghost.focusOn;

        const nearest = activePlayers.reduce((best, player) =>
            distanceSq(player.position, ghost.position) < distanceSq(best.position, ghost.position) ? player : best
        );
        const leader = activePlayers.reduce((best, player) => player.score > best.score ? player : best);

        if (ghost.name === 'blinky') return nearest.position;
        if (ghost.name === 'pinky') return this.targetAheadOfPlayer(leader, 4);
        if (ghost.name === 'inky') return this.targetAheadOfPlayer(nearest, 2);
        if (distanceSq(ghost.position, nearest.position) > 64) return nearest.position;
        return ghost.focusOn;
    }

    private targetAheadOfPlayer(player: PacmanPlayerState, cellsAhead: number): number {
        if (!player.direction) return player.position;

        const direction = DIRECTIONS[player.direction];
        const pos = posToXY(player.position);
        let x = pos.x;
        let y = pos.y;

        if (direction.movement === -1) x -= cellsAhead;
        else if (direction.movement === 1) x += cellsAhead;
        else if (direction.movement === -BOARD_WIDTH) y -= cellsAhead;
        else y += cellsAhead;

        x = clamp(x, 0, BOARD_WIDTH - 1);
        y = clamp(y, 0, BOARD_HEIGHT - 1);
        const target = y * BOARD_WIDTH + x;
        return this.isBlockedForGhost(target) ? player.position : target;
    }

    private findGhostPath(ghost: GhostState): { nextMove: number; direction: DirectionName } {
        let possibleDirections: DirectionName[] = [];
        const opposite = oppositeDirection(ghost.direction);

        if (this.isLair(ghost.position)) {
            possibleDirections.push('ArrowUp');
        } else {
            DIRECTION_NAMES.forEach(directionName => {
                const nextMove = ghost.position + DIRECTIONS[directionName].movement;
                if (directionName === opposite) return;
                if (this.isBlockedForGhost(nextMove)) return;
                possibleDirections.push(directionName);
            });
        }

        if (possibleDirections.length === 0) possibleDirections.push(opposite);

        let bestDirection = possibleDirections[0];
        let bestPosition = ghost.position + DIRECTIONS[bestDirection].movement;
        let bestDistance = distanceSq(bestPosition, ghost.target);

        possibleDirections.forEach(directionName => {
            const nextMove = ghost.position + DIRECTIONS[directionName].movement;
            const nextDistance = distanceSq(nextMove, ghost.target);
            const winsTie = nextDistance === bestDistance
                && DIRECTION_NAMES.indexOf(directionName) < DIRECTION_NAMES.indexOf(bestDirection);

            if (nextDistance < bestDistance || winsTie) {
                bestDirection = directionName;
                bestPosition = nextMove;
                bestDistance = nextDistance;
            }
        });

        if (!this.isLair(ghost.position) && this.isBlockedForGhost(bestPosition)) bestPosition = ghost.position;
        return { nextMove: bestPosition, direction: bestDirection };
    }

    private randomGhostMove(ghost: GhostState): { nextMove: number; direction: DirectionName } {
        if (this.isLair(ghost.position)) {
            return { nextMove: ghost.position + DIRECTIONS.ArrowUp.movement, direction: 'ArrowUp' };
        }

        const options = DIRECTION_NAMES.filter(directionName => {
            const nextMove = ghost.position + DIRECTIONS[directionName].movement;
            return !this.isBlockedForGhost(nextMove);
        });

        if (options.length === 0) return { nextMove: ghost.position, direction: ghost.direction };

        const seed = Math.abs(Math.sin((this.gameTime + ghost.position) * 12.9898) * 43758.5453);
        const direction = options[Math.floor(seed % options.length)];
        return { nextMove: ghost.position + DIRECTIONS[direction].movement, direction };
    }

    private handleCollisions(): void {
        const scared = this.areGhostsScared();

        this.ghosts.forEach(ghost => {
            const collidingPlayers = this.getActivePlayers().filter(player => player.position === ghost.position);
            if (collidingPlayers.length === 0) return;

            if (scared) {
                const eater = collidingPlayers.find(player => player.poweredUntil > this.gameTime) ?? collidingPlayers[0];
                eater.score += GHOST_SCORE;
                ghost.position = ghost.startPosition;
                ghost.direction = 'ArrowUp';
                ghost.moveTimer = 0;
            } else {
                collidingPlayers.forEach(player => this.knockOutPlayer(player));
            }
        });
    }

    private knockOutPlayer(player: PacmanPlayerState): void {
        if (player.eliminated || player.respawnUntil > this.gameTime) return;

        player.lives -= 1;
        player.poweredUntil = 0;
        player.direction = null;
        player.queuedDirection = null;
        player.moveTimer = 0;
        player.position = player.startPosition;

        if (player.lives <= 0) {
            player.eliminated = true;
        } else {
            player.respawnUntil = this.gameTime + RESPAWN_SECONDS;
        }
    }

    private checkEndConditions(): void {
        if (this.collectiblesLeft <= 0) {
            this.endGame('maze-clear');
            return;
        }

        if (this.playerOrder.every(id => this.players[id].eliminated)) {
            this.endGame('all-out');
        }
    }

    private endGame(reason: string): void {
        if (this.gameOver) return;
        this.gameOver = true;
        this.gameOverReason = reason;
        this.finalDisplayElapsed = 0;
    }

    private makeState(): PacmanStateMsg {
        const players: Record<string, PacmanPublicPlayer> = {};
        this.playerOrder.forEach(id => {
            const player = this.players[id];
            players[id] = {
                id: player.id,
                name: player.name,
                character: player.character,
                color: player.color,
                position: player.position,
                startPosition: player.startPosition,
                direction: player.direction,
                lives: player.lives,
                score: player.score,
                poweredUntil: player.poweredUntil,
                respawnUntil: player.respawnUntil,
                eliminated: player.eliminated,
                powered: player.poweredUntil > this.gameTime,
                respawning: player.respawnUntil > this.gameTime
            };
        });

        return {
            kind: 'pacmanState',
            players,
            playerOrder: this.playerOrder,
            ghosts: this.ghosts.map(ghost => ({
                name: ghost.name,
                color: ghost.color,
                startPosition: ghost.startPosition,
                position: ghost.position,
                direction: ghost.direction,
                focusOn: ghost.focusOn,
                target: ghost.target,
                scared: this.areGhostsScared()
            })),
            collectibles: this.collectibles,
            collectiblesLeft: this.collectiblesLeft,
            gameTime: this.gameTime,
            powerTimeLeft: this.getPowerTimeLeft(),
            gameOver: this.gameOver,
            gameOverReason: this.gameOverReason,
            finalTimeLeft: this.gameOver ? Math.max(0, FINAL_DISPLAY_SECONDS - this.finalDisplayElapsed) : FINAL_DISPLAY_SECONDS,
            leaderboard: this.getLeaderboard()
        };
    }

    private getLeaderboard(): LeaderboardRow[] {
        const sorted = this.playerOrder
            .map(id => this.players[id])
            .sort((a, b) => b.score - a.score || b.lives - a.lives || a.name.localeCompare(b.name));
        const bestScore = sorted[0]?.score ?? 0;

        return sorted.map(player => ({
            id: player.id,
            name: player.name,
            score: player.score,
            lives: player.lives,
            color: player.color,
            eliminated: player.eliminated,
            winner: this.gameOver && player.score === bestScore
        }));
    }

    private getActivePlayers(): PacmanPlayerState[] {
        return this.playerOrder
            .map(id => this.players[id])
            .filter(player => player && !player.eliminated && player.respawnUntil <= this.gameTime);
    }

    private areGhostsScared(): boolean {
        return this.getPowerTimeLeft() > 0;
    }

    private getPowerTimeLeft(): number {
        const poweredUntil = Math.max(0, ...this.playerOrder.map(id => this.players[id].poweredUntil));
        return Math.max(0, poweredUntil - this.gameTime);
    }

    private canPacmanMove(position: number, direction: DirectionName): boolean {
        const nextMove = position + DIRECTIONS[direction].movement;
        return !this.isBlockedForPacman(nextMove);
    }

    private isBlockedForPacman(position: number): boolean {
        return !this.isInsideBoard(position) || this.isWall(position) || this.isLair(position);
    }

    private isBlockedForGhost(position: number): boolean {
        return !this.isInsideBoard(position) || this.isWall(position) || this.isLair(position);
    }

    private isInsideBoard(position: number): boolean {
        return position >= 0 && position < LEVEL.length;
    }

    private isWall(position: number): boolean {
        return LEVEL[position] === TILE.wall;
    }

    private isLair(position: number): boolean {
        return LEVEL[position] === TILE.lair;
    }
}

// ============ CLASSE CLIENT ============
// Gestisce il rendering del gioco lato client e la riproduzione dei suoni
export class PacmanClient extends GameClient {
    // Stato del gioco ricevuto dal server
    private state: PacmanStateMsg | null = null;
    // Messaggi in attesa da inviare al server
    private pendingMessages: PacmanClientMsg[] = [];
    private lastSentDirection: DirectionName | null = null;
    
    // Flag e tracciamento per i suoni
    private gameStarted: boolean = false;
    private lastCollectiblesLeft: number = 0;
    // Traccia lo stato precedente per rilevare i cambiamenti
    private lastPlayerStates: Record<string, { lives: number; position: number; score: number }> = {};
    
    // Riferimenti agli audio file da riprodurre
    private soundGameStart: HTMLAudioElement;
    private soundMunch: HTMLAudioElement;
    private soundEatGhost: HTMLAudioElement;
    private soundDeath: HTMLAudioElement;

    // Carica i file audio dall'assets folder
    constructor(userInput: UserInput, myId: string) {
        super(new PacmanUserInput(document.createElement('canvas')), myId);

        // Carica i 4 effetti sonori dal percorso assets/pacman/
        this.soundGameStart = new Audio('/assets/pacman/game_start.wav');
        this.soundMunch = new Audio('/assets/pacman/munch.wav');
        this.soundEatGhost = new Audio('/assets/pacman/eat_ghost.wav');
        this.soundDeath = new Audio('/assets/pacman/death.wav');
    }

    // Inizializzazione del client (nulla da fare nel nostro caso)
    async init(players: Record<string, Player>): Promise<void> {
        return Promise.resolve();
    }

    // Disegna il gioco ad ogni frame
    draw(ctx: CanvasRenderingContext2D, dt: number) {
        this.captureDirection();

        const { screenW, screenH } = this.userInput;
        // Sfondo nero del gioco
        ctx.fillStyle = '#02030a';
        ctx.fillRect(0, 0, screenW, screenH);

        // Se non abbiamo ancora ricevuto lo stato dal server, mostra "Pac-Man"
        if (!this.state) {
            ctx.fillStyle = '#ffe66d';
            ctx.font = 'bold 34px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Pac-Man', screenW / 2, screenH / 2);
            return;
        }

        const layout = this.getLayout(screenW, screenH);
        this.drawBoard(ctx, layout.boardX, layout.boardY, layout.cell);
        this.drawLeaderboard(ctx, layout.panelX, layout.panelY, layout.panelW, layout.panelH, layout.compact);
        this.drawTopStatus(ctx, layout.boardX, Math.max(18, layout.boardY - 30), layout.boardW);

        if (this.state.gameOver) {
            this.drawGameOver(ctx);
        }
    }

    // Riceve i messaggi di stato dal server e gestisce la riproduzione dei suoni
    handleMessage(message: any) {
        if (message.kind === 'pacmanState') {
            const newState = message as PacmanStateMsg;
            
            // Riproduci suono di inizio gioco
            if (!this.gameStarted && newState) {
                this.gameStarted = true;
                this.playSound(this.soundGameStart);
            }
            
            // Controlla i cambiamenti di stato per riprodurre i suoni appropriati
            if (this.state) {
                // SOUND: Munch - quando il numero di collectibles diminuisce, qualcuno ha mangiato un pallino
                if (newState.collectiblesLeft < this.lastCollectiblesLeft) {
                    this.playSound(this.soundMunch);
                }
                
                // SOUND: Death e Eat-ghost - traccia cambiamenti nei singoli player
                newState.playerOrder.forEach(playerId => {
                    const newPlayer = newState.players[playerId];
                    const oldPlayer = this.state?.players[playerId];
                    const lastState = this.lastPlayerStates[playerId];
                    
                    if (oldPlayer && newPlayer && lastState) {
                        // SOUND: Eat-ghost - il player era powered e il suo score è aumentato
                        // (significa ha mangiato un fantasma)
                        if (oldPlayer.powered && newPlayer.score > lastState.score) {
                            this.playSound(this.soundEatGhost);
                        }
                        
                        // SOUND: Death - il player è stato eliminato o sta respawnando
                        if (!oldPlayer.eliminated && (newPlayer.eliminated || newPlayer.respawning)) {
                            this.playSound(this.soundDeath);
                        }
                    }
                    
                    // Salva lo stato corrente per il prossimo ciclo (per confrontare i cambiamenti)
                    this.lastPlayerStates[playerId] = {
                        lives: newPlayer.lives,
                        position: newPlayer.position,
                        score: newPlayer.score
                    };
                });
                
                this.lastCollectiblesLeft = newState.collectiblesLeft;
            } else {
                // Prima volta che riceviamo lo stato, salva i valori iniziali
                this.lastCollectiblesLeft = newState.collectiblesLeft;
                newState.playerOrder.forEach(playerId => {
                    const player = newState.players[playerId];
                    this.lastPlayerStates[playerId] = {
                        lives: player.lives,
                        position: player.position,
                        score: player.score
                    };
                });
            }
            
            this.state = newState;
        }
    }
    
    // Riproduce un audio riavviandolo da zero
    private playSound(sound: HTMLAudioElement): void {
        try {
            sound.currentTime = 0;
            sound.play().catch(() => {
                // Ignora gli errori di autoplay policy del browser
            });
        } catch (e) {
            // Ignora errori di riproduzione
        }
    }

    // Invia i messaggi accumulati al server
    flushMessages(): any[] {
        this.captureDirection();
        const messages = this.pendingMessages;
        this.pendingMessages = [];
        return messages;
    }

    // Verifica se la partita è finita
    // Verifica se la partita è finita
    isFinished(): boolean {
        return !!this.state?.gameOver && this.state.finalTimeLeft <= 0;
    }

    // Legge l'input dal giocatore e invia il messaggio al server se cambiato
    private captureDirection(): void {
        const direction = this.readDirection();
        if (!direction || direction === this.lastSentDirection) return;

        this.lastSentDirection = direction;
        this.pendingMessages.push({
            kind: 'pacmanInput',
            direction
        });
    }

    // Legge la direzione dai tasti (frecce direzionali)
    private readDirection(): DirectionName | null {
        const userInput = this.userInput as PacmanUserInput;
        
        // Usa la direzione da PacmanUserInput se disponibile
        const direction = userInput.getDirection();
        if (direction) return direction;
        
        // Fallback al movimento WASD
        if (this.userInput.moveDirectionX < 0) return 'ArrowLeft';
        if (this.userInput.moveDirectionX > 0) return 'ArrowRight';
        if (this.userInput.moveDirectionY < 0) return 'ArrowUp';
        if (this.userInput.moveDirectionY > 0) return 'ArrowDown';
        return null;
    }

    // Calcola il layout della schermata (posizione della mappa, classifica, dimensioni celle)
    // Si adatta automaticamente a schermi piccoli (responsive)
    private getLayout(screenW: number, screenH: number) {
        const compact = screenW < 820;
        const margin = compact ? 12 : 24;
        const panelW = compact ? screenW - margin * 2 : Math.min(270, Math.max(220, screenW * 0.24));
        const panelH = compact ? 146 : screenH - margin * 2;
        const panelX = compact ? margin : screenW - margin - panelW;
        const panelY = compact ? margin : margin;

        const availableW = compact ? screenW - margin * 2 : screenW - panelW - margin * 3;
        const availableH = compact ? screenH - panelH - margin * 3 : screenH - margin * 2;
        const cell = Math.max(10, Math.min(availableW / BOARD_WIDTH, availableH / BOARD_HEIGHT));
        const boardW = cell * BOARD_WIDTH;
        const boardH = cell * BOARD_HEIGHT;
        const boardX = compact ? (screenW - boardW) / 2 : margin + (availableW - boardW) / 2;
        const boardY = compact ? panelY + panelH + margin + Math.max(0, (availableH - boardH) / 2) : margin + (availableH - boardH) / 2;

        return { compact, margin, panelW, panelH, panelX, panelY, availableW, availableH, cell, boardW, boardH, boardX, boardY };
    }

    // Disegna la mappa di gioco (muri, pallini, pillole, fantasmi, Pac-Man)
    private drawBoard(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number): void {
        if (!this.state) return;

        // Sfondo nero della board
        ctx.fillStyle = '#050511';
        ctx.fillRect(x, y, cell * BOARD_WIDTH, cell * BOARD_HEIGHT);

        // Disegna ogni tile della mappa (muri, pallini, pillole, tana)
        for (let index = 0; index < LEVEL.length; index++) {
            const tile = LEVEL[index];
            const col = index % BOARD_WIDTH;
            const row = Math.floor(index / BOARD_WIDTH);
            const sx = x + col * cell;
            const sy = y + row * cell;

            if (tile === TILE.wall) {
                this.drawWall(ctx, sx, sy, cell);
            } else if (tile === TILE.lair) {
                // Tana dei fantasmi
                ctx.fillStyle = '#09091c';
                ctx.fillRect(sx, sy, cell, cell);
                ctx.strokeStyle = '#403068';
                ctx.lineWidth = Math.max(1, cell * 0.04);
                ctx.strokeRect(sx + cell * 0.18, sy + cell * 0.18, cell * 0.64, cell * 0.64);
            }

            // Disegna i collectibles (pallini e pillole) se presenti
            const collectible = this.state.collectibles[index];
            if (collectible === TILE.dot) {
                // Pallino normale
                ctx.fillStyle = '#f8f3dc';
                ctx.beginPath();
                ctx.arc(sx + cell / 2, sy + cell / 2, Math.max(1.6, cell * 0.09), 0, Math.PI * 2);
                ctx.fill();
            } else if (collectible === TILE.pill) {
                // Pillola con effetto pulsante
                const pulse = 0.86 + Math.sin(this.state.gameTime * 8) * 0.12;
                ctx.fillStyle = '#fff7b8';
                ctx.beginPath();
                ctx.arc(sx + cell / 2, sy + cell / 2, cell * 0.26 * pulse, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Disegna i fantasmi e i Pac-Man
        this.state.ghosts.forEach(ghost => this.drawGhost(ctx, ghost, x, y, cell));
        this.state.playerOrder.forEach(id => {
            const player = this.state?.players[id];
            if (player) this.drawPacman(ctx, player, x, y, cell);
        });

        // Bordo della mappa
        ctx.strokeStyle = '#1b2ccccc';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, cell * BOARD_WIDTH, cell * BOARD_HEIGHT);
    }

    // Disegna un muro con effetto 3D
    private drawWall(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number): void {
        const inset = Math.max(1, cell * 0.08);
        // Muro blu scuro
        ctx.fillStyle = '#1020a4';
        ctx.fillRect(x, y, cell, cell);
        // Ombreggiatura blu chiaro
        ctx.fillStyle = '#1738e6';
        ctx.fillRect(x + inset, y + inset, cell - inset * 2, cell - inset * 2);
        // Bordo azzurro
        ctx.strokeStyle = '#5e8cff';
        ctx.lineWidth = Math.max(1, cell * 0.035);
        ctx.strokeRect(x + inset, y + inset, cell - inset * 2, cell - inset * 2);
    }

    // Disegna un Pac-Man con la sua bocca animata e lo stato (powered, respawning)
    private drawPacman(ctx: CanvasRenderingContext2D, player: PacmanPublicPlayer, boardX: number, boardY: number, cell: number): void {
        if (!this.state || player.eliminated) return;

        const pos = posToXY(player.position);
        const cx = boardX + pos.x * cell + cell / 2;
        const cy = boardY + pos.y * cell + cell / 2;
        const radius = cell * 0.42;
        const direction = player.direction ?? 'ArrowRight';
        const angle = (DIRECTIONS[direction].rotation * Math.PI) / 180;
        // Bocca animata che si apre e chiude
        const mouth = 0.26 + Math.abs(Math.sin(this.state.gameTime * 12)) * 0.19;
        // Effetto lampeggio durante il respawn
        const blink = player.respawning && Math.floor(this.state.gameTime * 10) % 2 === 0;

        ctx.save();
        ctx.globalAlpha = blink ? 0.35 : 1;
        ctx.fillStyle = player.color;
        // Disegna Pac-Man come un cerchio con "bocca" (arc sottratto)
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, angle + mouth, angle + Math.PI * 2 - mouth);
        ctx.closePath();
        ctx.fill();

        // Se è il tuo Pac-Man, aggiungi un bordo bianco
        if (player.id === this.myId) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(2, cell * 0.08);
            ctx.stroke();
        }

        // Se è powered, disegna un alone giallo attorno
        if (player.powered) {
            ctx.strokeStyle = '#fff7b8';
            ctx.lineWidth = Math.max(1.5, cell * 0.05);
            ctx.beginPath();
            ctx.arc(cx, cy, radius + cell * 0.09, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Nome del giocatore sopra il Pac-Man
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(player.name.slice(0, 10), cx, cy - radius - 3);
        ctx.restore();
    }

    // Disegna un fantasma con i suoi occhi e cambio colore se spaventato
    private drawGhost(ctx: CanvasRenderingContext2D, ghost: GhostPublicState, boardX: number, boardY: number, cell: number): void {
        const pos = posToXY(ghost.position);
        const x = boardX + pos.x * cell;
        const y = boardY + pos.y * cell;
        const cx = x + cell / 2;
        const top = y + cell * 0.16;
        const bodyW = cell * 0.72;
        const left = cx - bodyW / 2;
        const bottom = y + cell * 0.86;
        const radius = bodyW / 2;

        // Se spaventato, disegna azzurro, altrimenti il suo colore proprio
        ctx.fillStyle = ghost.scared ? '#225bff' : ghost.color;
        ctx.beginPath();
        ctx.arc(cx, top + radius * 0.75, radius, Math.PI, 0);
        ctx.lineTo(left + bodyW, bottom);
        // Disegna il "gonna" del fantasma (tre picchi)
        for (let i = 2; i >= 0; i--) {
            const px = left + (bodyW / 3) * i + bodyW / 6;
            ctx.lineTo(px, bottom - cell * 0.13);
            ctx.lineTo(left + (bodyW / 3) * i, bottom);
        }
        ctx.closePath();
        ctx.fill();

        // Disegna gli occhi bianchi
        const eyeY = top + radius * 0.65;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx - cell * 0.14, eyeY, cell * 0.09, 0, Math.PI * 2);
        ctx.arc(cx + cell * 0.14, eyeY, cell * 0.09, 0, Math.PI * 2);
        ctx.fill();

        // Disegna le pupille (nere se normale, bianche se spaventato)
        ctx.fillStyle = ghost.scared ? '#ffffff' : '#111111';
        ctx.beginPath();
        ctx.arc(cx - cell * 0.14, eyeY, cell * 0.04, 0, Math.PI * 2);
        ctx.arc(cx + cell * 0.14, eyeY, cell * 0.04, 0, Math.PI * 2);
        ctx.fill();
    }

    // Disegna lo status bar in alto con punti rimasti e timer del power-up
    private drawTopStatus(ctx: CanvasRenderingContext2D, x: number, y: number, width: number): void {
        if (!this.state) return;

        ctx.fillStyle = '#ffffffd8';
        ctx.font = 'bold 15px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Punti rimasti ${this.state.collectiblesLeft}`, x, y);

        // Mostra il timer del power-up se attivo
        if (this.state.powerTimeLeft > 0) {
            ctx.fillStyle = '#fff176';
            ctx.textAlign = 'right';
            ctx.fillText(`Power ${Math.ceil(this.state.powerTimeLeft)}s`, x + width, y);
        }
    }

    // Disegna la classifica durante il gioco (sidebar destra o in basso su mobile)
    private drawLeaderboard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, compact: boolean): void {
        if (!this.state) return;

        // Sfondo della classifica
        ctx.fillStyle = '#0b1020ee';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#3651ff88';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        // Titolo "Classifica"
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Classifica', x + 14, y + 12);

        // Disegna ogni giocatore nella classifica
        const rowH = compact ? 22 : 44;
        const startY = y + (compact ? 44 : 58);
        this.state.leaderboard.forEach((row, index) => {
            const rowY = startY + index * rowH;
            if (rowY + rowH > y + h - 8) return;

            // Righe alternate per migliore leggibilità
            ctx.fillStyle = index % 2 === 0 ? '#ffffff10' : '#ffffff06';
            ctx.fillRect(x + 10, rowY - 4, w - 20, rowH - 4);

            // Cerchietto del colore del giocatore
            ctx.fillStyle = row.color;
            ctx.beginPath();
            ctx.arc(x + 24, rowY + 8, 6, 0, Math.PI * 2);
            ctx.fill();

            // Nome e posizione
            ctx.fillStyle = row.winner ? '#fff176' : '#ffffff';
            ctx.font = compact ? 'bold 13px Arial' : 'bold 15px Arial';
            ctx.textAlign = 'left';
            ctx.fillText(`${index + 1}. ${row.name.slice(0, compact ? 8 : 13)}`, x + 38, rowY);

            // Punteggio
            ctx.textAlign = 'right';
            ctx.fillText(`${row.score}`, x + w - 16, rowY);

            // Vite (solo in modalità non-compact)
            if (!compact) {
                ctx.fillStyle = row.eliminated ? '#ff6d6d' : '#a9b8ff';
                ctx.font = '12px Arial';
                ctx.fillText(`vite ${Math.max(0, row.lives)}`, x + w - 16, rowY + 20);
            }
        });
    }

    // Disegna la schermata di fine partita con vincitore e classifica finale
    private drawGameOver(ctx: CanvasRenderingContext2D): void {
        if (!this.state) return;

        const { screenW, screenH } = this.userInput;
        // Sfondo scuro semi-trasparente
        ctx.fillStyle = '#000000cc';
        ctx.fillRect(0, 0, screenW, screenH);

        // Determina il vincitore o pareggio
        const winners = this.state.leaderboard.filter(row => row.winner);
        const title = winners.length > 1 ? 'Pareggio' : 'Vince';
        const winnerText = winners.map(row => row.name).join(', ');

        // Titolo grande "Vince" o "Pareggio"
        ctx.fillStyle = '#fff176';
        ctx.font = 'bold 44px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(title, screenW / 2, screenH * 0.22);

        // Nome del/i vincitore/i
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 28px Arial';
        ctx.fillText(winnerText, screenW / 2, screenH * 0.22 + 52);

        // Pannello con la classifica finale
        const panelW = Math.min(460, screenW - 40);
        const panelX = (screenW - panelW) / 2;
        const panelY = screenH * 0.38;
        const rowH = 38;

        ctx.fillStyle = '#101629ee';
        ctx.fillRect(panelX, panelY, panelW, rowH * (this.state.leaderboard.length + 1) + 18);
        ctx.strokeStyle = '#5e8cff';
        ctx.strokeRect(panelX, panelY, panelW, rowH * (this.state.leaderboard.length + 1) + 18);

        ctx.fillStyle = '#a9b8ff';
        ctx.font = 'bold 15px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('Classifica finale', panelX + 18, panelY + 26);

        // Mostra la classifica completa
        this.state.leaderboard.forEach((row, index) => {
            const y = panelY + 58 + index * rowH;
            ctx.fillStyle = row.winner ? '#fff176' : '#ffffff';
            ctx.font = 'bold 17px Arial';
            ctx.textAlign = 'left';
            ctx.fillText(`${index + 1}. ${row.name}`, panelX + 18, y);
            ctx.textAlign = 'right';
            ctx.fillText(`${row.score}`, panelX + panelW - 18, y);
        });

        // Timer di ritorno alla lobby
        ctx.fillStyle = '#ffffff99';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`Ritorno alla lobby tra ${Math.ceil(this.state.finalTimeLeft)}s`, screenW / 2, screenH - 34);
    }
}
