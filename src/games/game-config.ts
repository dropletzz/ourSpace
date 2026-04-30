/**
 * ============================================================
 * CONFIGURAZIONE GIOCHI - ourSpace
 * ============================================================
 * Questo file contiene tutte le informazioni di configurazione
 * per i giochi disponibili nel gioco multiplayer.
 * 
 * Include:
 * - Informazioni base (nome, descrizione)
 * - Requisiti minimi per giocare
 * - Numero di giocatori supportato
 * - Modalità di gioco
 * 
 * Ogni sezione è commentata per spiegare il bilanciamento.
 * ============================================================
 */

// ============================================================
// CONFIGURAZIONE GIOCHI
// ============================================================

/**
 * Informazioni dettagliate per ogni gioco.
 * Ogni gioco ha un nome, descrizione, e impostazioni.
 */
export interface GameConfig {
    /** Chiave univoca del gioco */
    key: string;
    
    /** Nome visualizzato del gioco */
    name: string;
    
    /** Descrizione breve per il giocatore */
    description: string;
    
    /** Istruzioni per giocare */
    instructions: string;
    
    /** Numero minimo di giocatori */
    minPlayers: number;
    
    /** Numero massimo di giocatori */
    maxPlayers: number;
    
    /** Durata stimata della partita in minuti */
    estimatedDuration: number;
    
    /** Categoria del gioco */
    category: "arcade" | "puzzle" | "strategy" | "action";
    
    /** Difficoltà del gioco */
    difficulty: "easy" | "medium" | "hard";
    
    /** Colore per il rendering nella lobby */
    color: string;
    
    /** Icona (emoji) per il gioco */
    icon: string;
}

/**
 * Configurazione di tutti i giochi disponibili.
 */
export const GAMES_CONFIG: Record<string, GameConfig> = {
    guess: {
        key: "guess",
        name: "Indovina il Numero",
        description: "Indovina il numero segreto prima degli altri!",
        instructions: "Un numero casuale tra 1 e 100 viene generato. I giocatori fanno ipotesi e il gioco dice se il numero segreto è più alto o più basso. Vince chi indovina per primo!",
        minPlayers: 2,
        maxPlayers: 8,
        estimatedDuration: 5,
        category: "puzzle",
        difficulty: "easy",
        color: "#4CAF50",
        icon: "🎯"
    },
    pong: {
        key: "pong",
        name: "Pong Multiplayer",
        description: "Il classico gioco di ping-pong in multiplayer!",
        instructions: "Due giocatori si affrontano in una partita di Pong. Ogni giocatore controlla una racchetta e deve far passare la palla oltre la racchetta dell'avversario. Punti: 11 per vincere.",
        minPlayers: 2,
        maxPlayers: 4,
        estimatedDuration: 10,
        category: "arcade",
        difficulty: "easy",
        color: "#2196F3",
        icon: "🏓"
    },
    herosurv: {
        key: "herosurv",
        name: "HeroSurv Arena",
        description: "Combatti con i tuoi personaggi in un'arena!",
        instructions: "Scegli il tuo personaggio (Brawler, Sniper, Healer, Controller) e combatti contro gli altri. Usa le abilità e la ultimate per vincere. Ultimo giocatore in piedi vince!",
        minPlayers: 2,
        maxPlayers: 8,
        estimatedDuration: 15,
        category: "action",
        difficulty: "medium",
        color: "#FF5722",
        icon: "⚔️"
    }
};

// ============================================================
// FUNZIONI DI UTILITÀ
// ============================================================

/**
 * Ottiene la lista delle chiavi di tutti i giochi.
 */
export function getGameKeys(): string[] {
    return Object.keys(GAMES_CONFIG);
}

/**
 * Ottiene i nomi di tutti i giochi.
 */
export function getGameNames(): string[] {
    return Object.values(GAMES_CONFIG).map(g => g.name);
}

/**
 * Ottiene la configurazione di un gioco specifico.
 */
export function getGameConfig(key: string): GameConfig | undefined {
    return GAMES_CONFIG[key];
}

/**
 * Controlla se un gioco può essere avviato con il numero di giocatori.
 */
export function canStartGame(key: string, playerCount: number): boolean {
    const config = GAMES_CONFIG[key];
    if (!config) return false;
    return playerCount >= config.minPlayers && playerCount <= config.maxPlayers;
}

/**
 * Filtra i giochi per categoria.
 */
export function getGamesByCategory(category: GameConfig["category"]): GameConfig[] {
    return Object.values(GAMES_CONFIG).filter(g => g.category === category);
}

/**
 * Filtra i giochi per difficoltà.
 */
export function getGamesByDifficulty(difficulty: GameConfig["difficulty"]): GameConfig[] {
    return Object.values(GAMES_CONFIG).filter(g => g.difficulty === difficulty);
}

/**
 * Ottiene i giochi che supportano un certo numero di giocatori.
 */
export function getGamesForPlayerCount(count: number): GameConfig[] {
    return Object.values(GAMES_CONFIG).filter(g => 
        count >= g.minPlayers && count <= g.maxPlayers
    );
}

// ============================================================
// INFORMAZIONI DI BILANCIAMENTO
// ============================================================

/**
 * Riepilogo del bilanciamento dei giochi.
 */
export const GAMES_BALANCE_SUMMARY = `
=== BILANCIAMENTO GIOCHI ===

INDOVINA IL NUMERO (Guess)
- Giocatori: 2-8
- Durata: ~5 minuti
- Difficoltà: Facile
- Strategia: Logica, deduzione
- Consigliato per: Iniziare, Break veloci

PONG MULTIPLAYER
- Giocatori: 2-4
- Difficoltà: Facile
- Strategia: Riflessi, posizionamento
- Consigliato per: Giocatori veloci, competizione rapida

HEROSURV ARENA
- Giocatori: 2-8
- Durata: ~15 minuti
- Difficoltà: Media
- Strategia: Gestione abilità, posizionamento, lavoro di squadra
- Consigliato per: Partite lunghe, combattimento tattico
`;