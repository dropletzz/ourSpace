import { PERSON_W, PERSON_H, Player, smoothChange } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { Button, TextInput } from '../client/ui-elements';
import { GameServer } from '../games/game';
import { GuessGameServer } from '../games/guess';

const PERSON_SPEED = 300;

type Person = Player & {
    x: number;
    y: number;
};

// +messaggi
type ServerInitMsg = {
    kind: "init";
    yourId: string;
    people: Record<string, Person>;
};

type ServerNameIsTakenMsg = {
    kind: "nameIsTaken";
};

type ServerUpdateMsg = {
    kind: "update";
    people: Record<string, Person>;
};

type ServerExitMsg = {
    kind: "exit";
    id: string;
};

type ServerGameProposalMsg = {
    kind: "gameProposal";
    gameName: string;
    proposerId: string;
    proposerName: string;
    proposalId: string;
};

type ServerGameProposalStatusMsg = {
    kind: "gameProposalStatus";
    proposalId: string;
    acceptedPlayers: Array<{id: string, name: string, character: string}>;
};

type LobbyServerMsg =
    | ServerInitMsg
    | ServerNameIsTakenMsg
    | ServerUpdateMsg 
    | ServerExitMsg
    | ServerGameProposalMsg
    | ServerGameProposalStatusMsg
    | GameStartedMsg
    | GameMsg;

type ClientInitMsg = {
    kind: "init";
    name: string;
    character: string;
};

type ClientMoveMsg = {
    kind: "move";
    x: number;
    y: number;
};

type ClientGameProposalMsg = {
    kind: "gameProposal";
    gameName: string;
};

type ClientGameProposalAcceptMsg = {
    kind: "gameProposalAccept";
    proposalId: string;
};

type ClientStartGameMsg = {
    kind: "startGame";
    proposalId: string;
};

type LobbyClientMsg = 
    | ClientInitMsg 
    | ClientMoveMsg
    | ClientGameProposalMsg
    | ClientGameProposalAcceptMsg
    | ClientStartGameMsg
    | GameMsg;

type GameMsg = {
    kind: "game";
    gameId: string;
    data: any;
};

type GameStartedMsg = {
    kind: "gameStarted";
    gameId: string;
    gameName: string;
    players: Record<string, Player>;
};
// -messaggi


const EPSILON = 0.000001;

const worldW = 1000, worldH = 600;
const worldBounds = {
    top: -worldH/2,
    left: -worldW/2,
    bottom: worldH/2,
    right: worldW/2,
};

//////////////////////
////// SERVER ////////
//////////////////////

export class LobbyServer {
    public people: Record<string, Person>;
    public outgoingMessages: OutgoingMsg[];
    public games: Record<string, GameServer> = {};
    private gameIdCounter: number = 0;
    
    // Game proposal tracking
    private currentProposal: {
        gameName: string;
        proposerId: string;
        proposerName: string;
        proposalId: string;
        acceptedPlayerIds: Set<string>; // Players who accepted the proposal
    } | null = null;
    private proposalIdCounter: number = 0;

    constructor() {
        this.people = {};
        this.outgoingMessages = [];
    }

    clientConnected(id: string) {
        this.outgoingMessages.push({
            clientId: id,
            payload: {
                kind: 'init',
                yourId: id,
                people: this.people
            }
        });
    }

    clientClosed(id: string) {
        delete this.people[id];
        
        // If this client was the proposer, cancel the proposal
        if (this.currentProposal && this.currentProposal.proposerId === id) {
            this.currentProposal = null;
        }
        
        // If this client accepted a proposal, remove them from accepted players
        if (this.currentProposal) {
            this.currentProposal.acceptedPlayerIds.delete(id);
        }
        
        this.outgoingMessages.push({
            payload: {
                kind: 'exit',
                id: id,
            }
        });
    }

    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        const messages: OutgoingMsg[] = this.outgoingMessages;
        this.outgoingMessages = [];
        const updatedPeople: Record<string, Person> = {};

        // Separate lobby messages from game messages and group game messages by gameId
        const lobbyMessages: IncomingMsg[] = [];
        const gameMessagesByGameId: Record<string, IncomingMsg[]> = {};
        
        incomingMessages.forEach(message => {
            if (message.payload.kind === "game") {
                const gameMsg = message.payload as GameMsg;
                const gameId = gameMsg.gameId;
                
                if (!gameMessagesByGameId[gameId]) {
                    gameMessagesByGameId[gameId] = [];
                }
                gameMessagesByGameId[gameId].push(message);
            } else {
                lobbyMessages.push(message);
            }
        });
        
        // +lobby
        lobbyMessages.forEach(message => {
            const clientId: string = message.clientId;
            const payload: LobbyClientMsg = message.payload;

            if (payload.kind === "init") {
                if (Object.values(this.people).find(p => p.name === payload.name)) {
                    this.outgoingMessages.push({
                        clientId: clientId,
                        payload: {
                            kind: 'nameIsTaken'
                        }
                    })
                }
                else {
                    const newPerson: Person = {
                        x: 0,
                        y: 0,
                        name: payload.name,
                        character: payload.character,
                    };
                    this.people[clientId] = newPerson;
                    updatedPeople[clientId] = newPerson;
                }
            }
            else if (payload.kind === "move") {
                const person = this.people[clientId]
                person.x = payload.x 
                person.y = payload.y
                updatedPeople[clientId] = person;
            }
            else if (payload.kind === "gameProposal") {
                this.handleGameProposal(clientId, payload.gameName);
            }
            else if (payload.kind === "gameProposalAccept") {
                if (this.currentProposal && this.currentProposal.proposalId === payload.proposalId) {
                    this.currentProposal.acceptedPlayerIds.add(clientId);
                    // Notify all accepted players of updated status
                    this.sendProposalStatusToAllAcceptedPlayers();
                }
            }
            else if (payload.kind === "startGame") {
                // Check if this is the proposer starting a proposed game
                if (this.currentProposal && this.currentProposal.proposerId === clientId) {
                    const gameStartedMessage = this.startGameFromProposal();
                    if (gameStartedMessage) messages.push(gameStartedMessage);
                } 
            }
        });

        // mandiamo il messaggio "update" a tutti i client
        const updateMessage: ServerUpdateMsg = {
            kind: "update",
            people: updatedPeople
        };
        messages.push({ payload: updateMessage });
        // -lobby
        
        // +game
        // Process each game
        Object.entries(this.games).forEach(([gameId, game]) => {
            // Get messages for this game
            const gameMsgs = gameMessagesByGameId[gameId] || [];
            
            // Extract game data from GameMsg wrapper
            const unwrappedGameMessages: IncomingMsg[] = gameMsgs.map(msg => ({
                clientId: msg.clientId,
                payload: (msg.payload as GameMsg).data
            }));
            
            // Process game tick
            const gameOutgoingMessages = game.tick(unwrappedGameMessages, dt);
            
            // Wrap game messages in GameMsg and add to output
            gameOutgoingMessages.forEach(m => {
                messages.push({
                    clientId: m.clientId,
                    payload: {
                        kind: "game",
                        gameId: gameId,
                        data: m.payload
                    }
                });
            });
            
            // Remove finished games
            if (game.isFinished()) {
                delete this.games[gameId];
            }
        });
        // -game

        return messages;
    }
    
    private startGame(gameName: string): OutgoingMsg | null {
        let game: GameServer | null = null;
        
        if (gameName === 'guess')
            game = new GuessGameServer();
        // else if (gameName === 'pong')
        //     game = new PongGameServer();

        if (!game) return null;

        this.gameIdCounter += 1;
        const gameId = this.gameIdCounter + '';
        const players = this.getPlayers();
        game.init(players);
        this.games[gameId] = game;
        
        return {
            payload: {
                kind: "gameStarted",
                gameId: gameId,
                gameName: gameName,
                players: players
            }
        };
    }
    
    private getPlayers(): Record<string, Player> {
        const players = {};
        Object.entries(this.people).forEach(([id, person]) => {
            const { name, character } = person;
            players[id] = { name, character };
        })
        return players;
    }
    
    private handleGameProposal(clientId: string, gameName: string): void {
        // Only allow one proposal at a time
        if (this.currentProposal !== null) {
            return;
        }
        
        this.proposalIdCounter += 1;
        const proposalId = this.proposalIdCounter + '';
        const proposer = this.people[clientId];
        
        this.currentProposal = {
            gameName,
            proposerId: clientId,
            proposerName: proposer.name,
            proposalId,
            acceptedPlayerIds: new Set([clientId]) // Proposer auto-accepts
        };
        
        // Send proposal to all clients
        Object.keys(this.people).forEach(playerId => {
            this.outgoingMessages.push({
                clientId: playerId,
                payload: {
                    kind: 'gameProposal',
                    gameName,
                    proposerId: clientId,
                    proposerName: proposer.name,
                    proposalId
                } as ServerGameProposalMsg
            });
        });
        
        // Send initial status to proposer
        this.sendProposalStatusToAllAcceptedPlayers();
    }
    
    private sendProposalStatusToAllAcceptedPlayers(): void {
        if (!this.currentProposal) return;
        
        const { proposalId } = this.currentProposal;
        
        // Get accepted players with their names and characters
        const acceptedPlayers: Array<{id: string, name: string, character: string}> = [];
        
        this.currentProposal.acceptedPlayerIds.forEach(playerId => {
            const person = this.people[playerId];
            if (person) {
                acceptedPlayers.push({
                    id: playerId,
                    name: person.name,
                    character: person.character
                });
            }
        });
        
        // Send status to all accepted players
        this.currentProposal.acceptedPlayerIds.forEach(playerId => {
            this.outgoingMessages.push({
                clientId: playerId,
                payload: {
                    kind: 'gameProposalStatus',
                    proposalId,
                    acceptedPlayers
                } as ServerGameProposalStatusMsg
            });
        });
    }
    
    private startGameFromProposal(): OutgoingMsg | null {
        if (this.currentProposal === null) return null;
        
        const { gameName, acceptedPlayerIds } = this.currentProposal;
        
        let game: GameServer | null = null;
        
        if (gameName === 'guess')
            game = new GuessGameServer();
        // else if (gameName === 'pong')
        //     game = new PongGameServer();

        if (!game) return null;

        this.gameIdCounter += 1;
        const gameId = this.gameIdCounter + '';
        
        // Get players who accepted the proposal
        const players: Record<string, Player> = {};
        acceptedPlayerIds.forEach(playerId => {
            const person = this.people[playerId];
            if (person) {
                players[playerId] = {
                    name: person.name,
                    character: person.character
                };
            }
        });
        
        game.init(players);
        this.games[gameId] = game;
        
        this.currentProposal = null;
        
        return {
            payload: {
                kind: "gameStarted",
                gameId: gameId,
                gameName: gameName,
                players: players
            }
        };
    }
}

//////////////////////
////// CLIENT ////////
//////////////////////

import { CharacterSelect } from './character-select';
import { GameProposalUI } from './game-proposal-ui';
import { getCharacterDrawFunction } from '../client/characters';
import { UserInput } from '../client/user-input';
import { GameClient } from '../games/game';
import { GuessGameClient } from '../games/guess';

type ClientPerson = Person & {
    xTarget: number;
    yTarget: number;
};

export class LobbyClient {
    public userInput: any;

    public myId: string | null;
    public people: Record<string, ClientPerson>;
    public prevX: number = 0;
    public prevY: number = 0;
    public camera: { x: number, y: number, zoom: number };

    public characterSelect: CharacterSelect;
    public gameProposalUI: GameProposalUI;

    public startGameBtn: Button;

    public outgoingMessages: any[] = [];
    
    // Game proposal tracking
    public currentProposalId: string | null = null;
    public isProposer: boolean = false;
    public currentProposalInfo: {
        gameName: string;
        proposerName: string;
    } | null = null;
    
    public currentGame: GameClient | null = null;
    public currentGameId: string | null = null;

    constructor(userInput: UserInput) {
        this.userInput = userInput;
        this.myId = null;
        this.camera = { x: 0, y: 0, zoom: 1.0 };
        this.people = {};

        this.characterSelect = new CharacterSelect(this.userInput, (name, character) => {
            if (this.getMe()) return; // do nothing if already initialized
            this.outgoingMessages.push({
                kind: "init",
                name: name,
                character: character
            });
        });

        // Create GameProposalUI
        this.gameProposalUI = new GameProposalUI(this.userInput);

        this.startGameBtn = new Button('propose game', userInput, () => {
            if (this.currentProposalId && this.currentProposalInfo) {
                // Join existing proposal
                this.outgoingMessages.push({
                    kind: 'gameProposalAccept',
                    proposalId: this.currentProposalId
                });
                
                // Set up GameProposalUI for joining player
                this.gameProposalUI.setParameters(
                    false, // not proposer
                    this.currentProposalInfo.gameName,
                    this.currentProposalInfo.proposerName,
                    this.currentProposalId
                );
                
                // Add ourselves to player list immediately
                const me = this.getMe();
                if (me) {
                    this.gameProposalUI.setPlayers([{
                        id: this.myId!,
                        name: me.name,
                        character: me.character
                    }]);
                }
            }
            else {
                // Propose new game
                this.outgoingMessages.push({
                    kind: 'gameProposal',
                    gameName: 'guess'
                });
            }
        });
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        if (this.currentGame) {
            this.currentGame.draw(ctx, dt);
        } else {
            const me = this.getMe();
            if (me) {
                // Check if we should show game proposal UI
                if (this.gameProposalUI.isConfigured()) {
                    this.gameProposalUI.draw(ctx);
                } else {
                    this.drawLobby(ctx, me, dt);
                }
            } else {
                this.characterSelect.draw(ctx);
            }
        }
    }

    drawLobby(ctx: CanvasRenderingContext2D, me: ClientPerson, dt: number) {
        const {
            screenW, screenH, zoom,
            xMoveDirection, yMoveDirection
        } = this.userInput;

        // gestione movimento
        me.xTarget = me.xTarget + xMoveDirection * dt * PERSON_SPEED;
        me.yTarget = me.yTarget + yMoveDirection * dt * PERSON_SPEED;

        // controllo che il giocatore non esca dallo spazio di gioco
        if (me.yTarget - PERSON_H/2 < worldBounds.top) me.yTarget = worldBounds.top + PERSON_H/2 + EPSILON;
        if (me.yTarget + PERSON_H/2 > worldBounds.bottom) me.yTarget = worldBounds.bottom - PERSON_H/2 - EPSILON;
        if (me.xTarget - PERSON_W/2 < worldBounds.left) me.xTarget = worldBounds.left + PERSON_W/2 + EPSILON;
        if (me.xTarget + PERSON_W/2 > worldBounds.right) me.xTarget = worldBounds.right - PERSON_W/2 - EPSILON;

        // la camera segue il giocatore
        this.camera.x = me.x;
        this.camera.y = me.y;
        this.camera.zoom = zoom;

        // pulisci lo schermo
        ctx.beginPath();
        ctx.rect(0, 0, screenW, screenH);
        ctx.fillStyle = "#000";
        ctx.fill();

        ctx.save();

        ctx.translate(screenW/2, screenH/2); // centra lo schermo
        ctx.scale(this.camera.zoom, this.camera.zoom); // applica lo zoom
        ctx.translate(-this.camera.x, -this.camera.y); // sposta relativamente alla camera

        // disegna lo sfondo del "mondo" (campo da gioco)
        ctx.beginPath();
        ctx.rect(worldBounds.left, worldBounds.top, worldW, worldH);
        ctx.fillStyle = "#58a515";
        ctx.fill();

        // sposta le persone e disegnale
        Object.values(this.people).forEach((person) => {
            if (person.xTarget)
                person.x = smoothChange(person.x, person.xTarget, dt, 0.05);
            if (person.yTarget)
                person.y = smoothChange(person.y, person.yTarget, dt, 0.05);

            const drawPerson = getCharacterDrawFunction(person.character);
            drawPerson(ctx, person.x, person.y, PERSON_W, PERSON_H, );
            this.drawPersonName(ctx, person);
        });

        ctx.restore();
        
        // Only show button if not showing game proposal UI
        if (!this.gameProposalUI.isConfigured()) {
            if (this.currentProposalId) {
                this.startGameBtn.setLabel('join game');
            } else {
                this.startGameBtn.setLabel('propose game');
            }
            this.startGameBtn.draw(ctx, screenW - 110, 10, 100, 30);
        }
    }

    drawPersonName(ctx: CanvasRenderingContext2D, person: Person) {
        const fontSize = Math.floor(PERSON_H * 0.15);
        const nameY = person.y - PERSON_H/2 - fontSize - PERSON_H*0.08;
        ctx.font = `${fontSize}px Arial`;
        const nameWidth = ctx.measureText(person.name).width;
        const padding = 4;

        ctx.fillStyle = "rgba(0, 0, 0, 0.5)"; 
        ctx.fillRect(
            person.x - (nameWidth / 2) - padding, 
            nameY - padding, 
            nameWidth + (padding * 2), 
            fontSize + (padding * 2)
        );
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.lineWidth = 4;
        ctx.fillStyle = "#eeeeee";
        ctx.fillText(person.name, person.x, nameY);
    }



    handleMessage(message: LobbyServerMsg) {
        if (message.kind === "gameStarted") {
            if (this.currentGame) return; // ignore if already in a game
            if (!message.players[this.myId]) { // ignore if i'm not in players list
                this.currentProposalId = null;
                this.isProposer = false;
                this.currentProposalInfo = null;
                this.gameProposalUI.reset();
                return;
            }
            this.currentGame = new GuessGameClient(this.userInput, this.myId!);
            this.currentGame.init(message.players);
            this.currentGameId = message.gameId;
            
            this.currentProposalId = null;
            this.isProposer = false;
            this.currentProposalInfo = null;
            this.gameProposalUI.reset();
        }
        else if (message.kind === "gameProposal") {
            this.currentProposalId = message.proposalId;
            this.isProposer = message.proposerId === this.myId;
            this.currentProposalInfo = {
                gameName: message.gameName,
                proposerName: message.proposerName
            };
            
            // Only set up GameProposalUI if we're the proposer
            if (this.isProposer) {
                this.gameProposalUI.setParameters(
                    true, // isProposer
                    message.gameName,
                    message.proposerName,
                    message.proposalId,
                    () => {
                        // Start game callback for proposer
                        this.outgoingMessages.push({
                            kind: 'startGame',
                            proposalId: message.proposalId
                        });
                    }
                );
                
                // Add ourselves to player list
                const me = this.getMe();
                if (me) {
                    this.gameProposalUI.setPlayers([{
                        id: this.myId!,
                        name: me.name,
                        character: me.character
                    }]);
                }
            }
        }
        else if (message.kind === "game") {
            if (this.currentGame && message.gameId === this.currentGameId) {
                this.currentGame.handleMessage(message.data);
            }
        }
        else if (message.kind === "init") {
            this.myId = message.yourId;
            const clientPeople = message.people as Record<string, ClientPerson>;
            Object.values(clientPeople).forEach(person => {
                person.xTarget = person.x;
                person.yTarget = person.y;
            });
            this.people = clientPeople;
        }
        else if (message.kind === "nameIsTaken") {
            alert("nickname is already taken");
        }
        else if (message.kind === "update") {
            const updateMsg = message;
            Object.entries(updateMsg.people as Record<string, Person>).forEach(entry => {
                const id: string = entry[0];
                const updatedPerson: Person = entry[1];
                if (id !== this.myId) {
                    const personToUpdate = this.people[id];
                    if (personToUpdate) {
                        personToUpdate.xTarget = updatedPerson.x;
                        personToUpdate.yTarget = updatedPerson.y;
                    }
                }
                if (!this.people[id]) {
                    const clientPerson = updatedPerson as ClientPerson;
                    clientPerson.xTarget = clientPerson.x;
                    clientPerson.yTarget = clientPerson.y;
                    this.people[id] = clientPerson;
                }
            });
        }
        else if (message.kind === "gameProposalStatus") {
            // Update player list in GameProposalUI
            this.gameProposalUI.setPlayers(message.acceptedPlayers);
        }
        else if (message.kind === "exit") {
            delete this.people[message.id];
        }
    }

    flushMessages(): any[] {
        const messages: any[] = this.outgoingMessages;
        this.outgoingMessages = [];

        const me = this.getMe();
        if (me) {
            const distX = Math.abs(me.x - this.prevX)
            const distY = Math.abs(me.y - this.prevY)
            if (distX > EPSILON || distY > EPSILON) {
                this.prevX = me.x
                this.prevY = me.y
                messages.push({
                    kind: "move",
                    x: me.x, 
                    y: me.y
                });
            }
        }
        
        if (this.currentGame) {
            if (this.currentGame.isFinished()) {
                this.currentGame = null;
                this.currentGameId = null;
                this.currentProposalId = null;
                this.currentProposalInfo = null;
                this.gameProposalUI.reset();
            }
            else {
                const gameMessages = this.currentGame.flushMessages();
                gameMessages.forEach((message) => {
                    messages.push({
                        kind: "game",
                        gameId: this.currentGameId!,
                        data: message
                    });
                })
            }
        }

        return messages;
    }

    getMe(): ClientPerson | null {
        return this.myId ? this.people[this.myId] : null;
    }
} 
