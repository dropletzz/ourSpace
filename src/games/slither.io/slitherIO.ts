// Importiamo le classi base per la gestione del server e del client del gioco
import { GameServer, GameClient } from '../game';

// Importiamo la gestione dell'input dell'utente (tasti premuti, movimento del mouse, ecc.)
import { UserInput } from '../../client/user-input';

// Importiamo i tipi di messaggi che il server riceve (IncomingMsg) e invia (OutgoingMsg)
import { IncomingMsg, OutgoingMsg } from '../../server';

// Definiamo un'interfaccia per rappresentare un giocatore di Slither
export interface SlitherPlayer {
    id: string;  // Identificatore univoco del giocatore
    x: number;   // Posizione X del giocatore nel mondo
    y: number;   // Posizione Y del giocatore nel mondo
}

// Dimensione di un giocatore sullo schermo in unità di "mondo di gioco"
const PLAYER_SIZE = 0.05;

// Definiamo i bordi del mondo di gioco (coordinate cartesiane)
const BORDERS = { top: -1, bottom: 1, left: -2, right: 2 };

// Calcoliamo larghezza e altezza totali del mondo
const BORDERS_W = Math.abs(BORDERS.right - BORDERS.left);
const BORDERS_H = Math.abs(BORDERS.bottom - BORDERS.top);

// Funzione per bloccare il giocatore all'interno dei bordi del mondo
function blockPlayerAtBorders(player: SlitherPlayer) {
    const halfSize = PLAYER_SIZE / 2;

    // Controllo bordo sinistro
    if (player.x - halfSize < BORDERS.left) {
        player.x = BORDERS.left + halfSize;
    }

    // Controllo bordo destro
    if (player.x + halfSize > BORDERS.right) {
        player.x = BORDERS.right - halfSize;
    }

    // Controllo bordo superiore
    if (player.y - halfSize < BORDERS.top) {
        player.y = BORDERS.top + halfSize;
    }

    // Controllo bordo inferiore
    if (player.y + halfSize > BORDERS.bottom) {
        player.y = BORDERS.bottom - halfSize;
    }
}

// Classe server specifica per il gioco Slither
export class SlitherServer extends GameServer {
    private players: Record<string, SlitherPlayer> = {}; // Dizionario dei giocatori

    // Inizializza i giocatori sulla mappa all'inizio della partita
    init(players: Record<string, any>) {
        this.players = {};
        let i = 1;
        Object.keys(players).forEach(id => {
            const player: SlitherPlayer = {
                id,
                x: 0,  // Posizione iniziale X
                y: 0   // Posizione iniziale Y
            };
            this.players[id] = player;
            i++;
        });
    }

    // Funzione chiamata ad ogni "tick" del server (aggiornamento frame)
    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        // Gestiamo tutti i messaggi ricevuti dai client
        incomingMessages.forEach(msg => {
            const id = msg.clientId;
            const payload = msg.payload;

            // Se il messaggio è un movimento e il giocatore esiste
            if (payload.kind === 'move' && this.players[id]) {
                this.players[id].x = payload.x;  // Aggiorniamo la posizione X
                this.players[id].y = payload.y;  // Aggiorniamo la posizione Y

                // Blocchiamo il giocatore ai bordi del mondo
                blockPlayerAtBorders(this.players[id]);
            }
        });

        // Inviamo ai client lo stato aggiornato dei giocatori
        return [{ payload: { players: this.players } }];
    }

    // Il gioco non ha una condizione di fine per ora
    isFinished(): boolean {
        return false;
    }
}

// Classe client specifica per Slither
export class SlitherClient extends GameClient {
    private players: Record<string, SlitherPlayer> = null; // Stato locale dei giocatori

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
    }

    // Inizializza i giocatori sul client
    init(players: Record<string, any>) {
        this.players = {};
        Object.keys(players).forEach(id => {
            this.players[id] = {
                id,
                x: players[id].x || 0,
                y: players[id].y || 0
            };
        });
    }

    // Funzione per disegnare lo stato del gioco sul canvas
    draw(ctx: CanvasRenderingContext2D, dt: number) {
        if (!this.players) return;

        const { screenW, screenH, moveDirectionX, moveDirectionY } = this.userInput;
        const me = this.players[this.myId];

        // Aggiorniamo la posizione del giocatore locale in base all'input dell'utente
        me.x += moveDirectionX * dt;
        me.y += moveDirectionY * dt;

        // Blocchiamo il giocatore ai bordi
        blockPlayerAtBorders(me);

        // Disegniamo lo sfondo del gioco
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, screenW, screenH);

        // Trasformiamo le coordinate del mondo in coordinate dello schermo
        ctx.save();
        const scaleX = screenW / BORDERS_W;
        const scaleY = screenH / BORDERS_H;
        const scale = Math.min(scaleX, scaleY); // Manteniamo proporzioni corrette
        ctx.translate(screenW / 2, screenH / 2); // Centriamo la telecamera
        ctx.scale(scale, scale);

        // Disegniamo lo sfondo del campo
        ctx.fillStyle = "#44965c";
        ctx.fillRect(BORDERS.left, BORDERS.top, BORDERS_W, BORDERS_H);

        // Disegniamo tutti i giocatori
        Object.values(this.players).forEach(player => {
            ctx.fillStyle = player.id === this.myId ? "#ff0000" : "#0004ff"; // Colore diverso per il giocatore locale
            ctx.fillRect(player.x - PLAYER_SIZE / 2, player.y - PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
        });

        ctx.restore();
    }

    // Gestiamo i messaggi ricevuti dal server
    handleMessage(message: any) {
        if (!this.players) {
            this.init(message.players); // Se non inizializzato, creiamo i giocatori
        } else {
            Object.keys(message.players).forEach(id => {
                if (id !== this.myId && this.players[id]) {
                    // Aggiorniamo le posizioni degli altri giocatori
                    this.players[id].x = message.players[id].x;
                    this.players[id].y = message.players[id].y;

                    // Blocchiamo gli altri giocatori ai bordi anche lato client
                    blockPlayerAtBorders(this.players[id]);
                }
            });
        }
    }

    // Inviamo i messaggi al server (posizione del giocatore locale)
    flushMessages(): any[] {
        if (!this.players) return [];
        const me = this.players[this.myId];
        return [{ kind: 'move', x: me.x, y: me.y }];
    }

    // Il gioco lato client non ha condizione di fine
    isFinished(): boolean {
        return false;
    }
}