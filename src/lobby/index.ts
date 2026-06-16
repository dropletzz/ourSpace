import { Rectangle, Player, smoothChange, getCollisionSide, EPSILON } from '../common';
import { drawPersonMessage, drawPersonName } from '../client/draw';
import { Arcade } from './things';
import { IncomingMsg, OutgoingMsg } from '../server';
import { ExtendedGameProposal } from './game-select';
import { Button, DEFAULT_TEXT_INPUT_COLORS, TextInput } from '../client/ui-elements';
import { GameServer } from '../games/game';
import { GAMES } from '../games/index'

// client imports
import { CharacterSelect } from './character-select';
import { GameSelect } from './game-select';
import { CHARACTER_STANDARD_HW_RATIO, getCharacterDrawFunction } from '../client/characters';
import { UserInput } from '../client/user-input';
import { GameClient } from '../games/game';


const PERSON_SPEED = 300;
export const PERSON_W = 40;
export const PERSON_H = PERSON_W * CHARACTER_STANDARD_HW_RATIO;

type Person = Player & {
    x: number;
    y: number;
};

type GameProposal = {
    gameKey: string;
    proposerId: string;
    proposalId: string;
    acceptedPlayerIds: string[];
}

// +messaggi
type GameMsg = {
    kind: "game";
    gameId: string;
    data: any;
};

type ServerInitMsg = {
    kind: "init";
    yourId: string;
    people: Record<string, Person>;
    gameProposals: Record<string, GameProposal>;
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

type ServerGameJoinRefusedMsg = {
    kind: "gameJoinRefused";
    proposalId: string;
    reason: string;
};

type ServerGameProposalsUpdateMsg = {
    kind: "gameProposalsUpdate";
    gameProposals: Record<string, GameProposal>;
};

type ServerGameStartedMsg = {
    kind: "gameStarted";
    gameId: string;
    gameKey: string;
    players: Record<string, Player>;
    proposalId: string;
};

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
    gameKey: string;
};

type ClientGameProposalAcceptMsg = {
    kind: "gameProposalAccept";
    proposalId: string;
};

type ClientGameProposalExitMsg = {
    kind: "gameProposalExit";
    proposalId: string;
};

type ClientGameProposalDeleteMsg = {
    kind: "gameProposalDelete";
    proposalId: string;
};

type ClientStartGameMsg = {
    kind: "startGame";
    proposalId: string;
};

type ServerChatMsg = {
    kind: "chat";
    playerId: string;
    message: string;
}

type ClientChatMsg = {
    kind: "chat";
    message: string;
}

type LobbyServerMsg =
    | ServerInitMsg
    | ServerNameIsTakenMsg
    | ServerUpdateMsg 
    | ServerExitMsg
    | ServerGameJoinRefusedMsg
    | ServerGameProposalsUpdateMsg
    | ServerGameStartedMsg
    | ServerChatMsg
    | GameMsg;

type LobbyClientMsg = 
    | ClientInitMsg 
    | ClientMoveMsg
    | ClientGameProposalMsg
    | ClientGameProposalAcceptMsg
    | ClientStartGameMsg
    | ClientGameProposalExitMsg
    | ClientGameProposalDeleteMsg
    | ClientChatMsg
    | GameMsg;
// -messaggi

const worldW = 10000, worldH = 7000;

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
    
    private gameProposals: Record<string, GameProposal>;
    private proposalIdCounter: number = 0;

    constructor() {
        this.people = {};
        this.outgoingMessages = [];
        this.gameProposals = {};

        setInterval(() => {
            console.log('\n=====GIOCHI ATTIVI==========================')
            Object.keys(this.games).forEach(id => {
                console.log(`${id} -> ${this.games[id]._key}`);
            })
            console.log('============================================')
            console.log('\n=====PROPOSTE DI GIOCO======================')
            console.log(this.gameProposals);
            console.log('============================================')
        }, 2000);
    }

    clientConnected(id: string) {
        const gameProposals: Record<string, any> = {};
        Object.values(this.gameProposals).forEach(p => {
            gameProposals[p.proposalId] = {
                gameKey: p.gameKey,
                proposalId: p.proposalId,
                proposerId: p.proposerId,
                acceptedPlayerIds: [...p.acceptedPlayerIds]
            }
        });
        const initMessage: ServerInitMsg = {
            kind: 'init',
            yourId: id,
            people: this.people,
            gameProposals: gameProposals
        };
        this.outgoingMessages.push({
            clientIds: [id],
            payload: initMessage
        });
    }

    clientClosed(id: string) {
        Object.keys(this.gameProposals).forEach(proposalId => {
            const proposal = this.gameProposals[proposalId];

            // If this client was the proposer, cancel the proposal
            if (proposal.proposerId === id) {
                delete this.gameProposals[proposalId];

                const payload: ServerGameProposalsUpdateMsg = {
                    kind: 'gameProposalsUpdate',
                    gameProposals: this.gameProposals
                }
                this.outgoingMessages.push({ payload });
            }

            // If this client accepted the current proposal, remove them from accepted players
            const index = proposal.acceptedPlayerIds.indexOf(id);
            if (index >= 0) proposal.acceptedPlayerIds.splice(index, 1);
        });
        
        delete this.people[id];
        this.outgoingMessages.push({
            payload: {
                kind: 'exit',
                id: id,
            }
        });
    }

    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
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
                        clientIds: [clientId],
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
                if (person) {
                    let newX = payload.x;
                    let newY = payload.y;

                    // Collision with buildings — push back if overlapping
                    const playerRect: Rectangle = {
                        x: newX - PERSON_W / 2,
                        y: newY - PERSON_H / 2,
                        w: PERSON_W,
                        h: PERSON_H,
                    };

                    for (const building of buildings) {
                        for (const box of building.collisionBoxes) {
                            const side = getCollisionSide(playerRect, box);
                            if (side !== "none") {
                                // Push oplayerIdsut based on collision side
                                if (side === "left") newX = box.x - PERSON_W / 2;
                                else if (side === "right") newX = box.x + box.w + PERSON_W / 2;
                                else if (side === "top") newY = box.y - PERSON_H / 2;
                                else if (side === "bottom") newY = box.y + box.h + PERSON_H / 2;
                            }
                        }
                    }

                    person.x = newX;
                    person.y = newY;
                    updatedPeople[clientId] = person;
                }
            }
            else if (payload.kind === "gameProposal") {
                this.newGameProposal(clientId, payload.gameKey);
            }
            else if (payload.kind === "gameProposalAccept") {
                const currentProposal = this.gameProposals[payload.proposalId];
                if (currentProposal) {
                    const { acceptedPlayerIds, gameKey } = currentProposal;
                    const { maxPlayers } = GAMES[gameKey];
                    const maxPlayersOk = !maxPlayers || acceptedPlayerIds.length < maxPlayers;
                    if (maxPlayersOk) {
                        const playerIds = currentProposal.acceptedPlayerIds;
                        if (playerIds.indexOf(clientId) < 0) playerIds.push(clientId);

                        const proposalsMsg: ServerGameProposalsUpdateMsg = {
                            kind: "gameProposalsUpdate",
                            gameProposals: this.gameProposals
                        }
                        this.outgoingMessages.push({ payload: proposalsMsg });
                    }
                    else {
                        this.outgoingMessages.push({
                            payload: {
                                kind: 'gameJoinRefused',
                                proposalId: payload.proposalId,
                                reason: 'full'
                            } as ServerGameJoinRefusedMsg,
                            clientIds: [clientId]
                        })
                    }
                }
            }
            else if (payload.kind === "gameProposalExit") {
                const gameProposal = this.gameProposals[payload.proposalId];
                if (gameProposal) {
                    const playerIds = gameProposal.acceptedPlayerIds;
                    const index = playerIds.indexOf(message.clientId)
                    if (index >= 0) {
                        gameProposal.acceptedPlayerIds.splice(index, 1);
                        const payload: ServerGameProposalsUpdateMsg = {
                            kind: 'gameProposalsUpdate',
                            gameProposals: this.gameProposals
                        }
                        this.outgoingMessages.push({ payload });
                    }
                }
            }
            else if (payload.kind === "gameProposalDelete") {
                const gameProposal = this.gameProposals[payload.proposalId];
                if (gameProposal) {
                    delete this.gameProposals[payload.proposalId];
                    const messagePayload: ServerGameProposalsUpdateMsg = {
                        kind: 'gameProposalsUpdate',
                        gameProposals: this.gameProposals
                    }
                    this.outgoingMessages.push({ payload: messagePayload });
                }
            }
            else if (payload.kind === "startGame") {
                const currentProposal = this.gameProposals[payload.proposalId];
                const { acceptedPlayerIds, gameKey } = currentProposal;
                const { minPlayers } = GAMES[gameKey];
                const minPlayersOk = !minPlayers || acceptedPlayerIds.length >= minPlayers;

                if (minPlayersOk && currentProposal.proposerId === clientId) {
                    this.startGameFromProposal(currentProposal.proposalId);
                }
            }
            else if (payload.kind === "chat") {
                const chatMsg: ServerChatMsg = {
                    kind: 'chat',
                    playerId: message.clientId,
                    message: payload.message
                }
                this.outgoingMessages.push({ payload: chatMsg })
            }
        });

        // mandiamo il messaggio "update" a tutti i client
        if (Object.keys(updatedPeople).length) {
            const updateMessage: ServerUpdateMsg = {
                kind: "update",
                people: updatedPeople
            };
            this.outgoingMessages.push({ payload: updateMessage });
        }
        // -lobby
        
        // +game
        Object.entries(this.games).forEach(([gameId, game]) => {
            const gameMsgs = gameMessagesByGameId[gameId] || [];
            
            const unwrappedGameMessages: IncomingMsg[] = gameMsgs.map(msg => ({
                clientId: msg.clientId,
                payload: (msg.payload as GameMsg).data
            }));
            
            const gameClientIds = Object.keys(this.games[gameId]._players);
            // TODO game outgoing messages are just 'any' and have no client id
            const gameOutgoingMessages = game.tick(unwrappedGameMessages, dt);
            gameOutgoingMessages.forEach(m => {
                this.outgoingMessages.push({
                    clientIds: gameClientIds,
                    payload: {
                        kind: "game",
                        gameId: gameId,
                        data: m.payload
                    } as GameMsg
                });
            });
            
            if (game.isFinished()) {
                delete this.games[gameId];
            }
        });
        // -game

        const messages = this.outgoingMessages;
        this.outgoingMessages = [];
        return messages;
    }
    
    private newGameProposal(clientId: string, gameKey: string): void {
        this.proposalIdCounter += 1;
        const proposalId = this.proposalIdCounter + '';
        
        this.gameProposals[proposalId] = {
            gameKey: gameKey,
            proposerId: clientId,
            proposalId,
            acceptedPlayerIds: [clientId]
        };
        
        const proposalsMsg: ServerGameProposalsUpdateMsg = {
            kind: "gameProposalsUpdate",
            gameProposals: this.gameProposals
        };
        this.outgoingMessages.push({ payload: proposalsMsg });
    }
    
    private startGameFromProposal(proposalId: string): OutgoingMsg | null {
        const currentProposal = this.gameProposals[proposalId];
        if (!currentProposal) return null;

        const { gameKey, acceptedPlayerIds } = currentProposal;
        const gameInfo = GAMES[gameKey];
        if (!gameInfo) return null;

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
        const game: GameServer = new gameInfo.server(gameKey, players);
        
        this.gameIdCounter += 1;
        const gameId = this.gameIdCounter + '';

        game.init(players);
        this.games[gameId] = game;
        delete this.gameProposals[proposalId];

        const startMsg: ServerGameStartedMsg = {
            kind: "gameStarted",
            gameId, gameKey, players, proposalId
        };
        this.outgoingMessages.push({ payload: startMsg });

        const proposalsMsg: ServerGameProposalsUpdateMsg = {
            kind: "gameProposalsUpdate",
            gameProposals: this.gameProposals
        };
        this.outgoingMessages.push({ payload: proposalsMsg });
    }
}

//////////////////////
////// CLIENT ////////
//////////////////////

type ClientPerson = Person & {
    xTarget: number;
    yTarget: number;
};

const buildings: Arcade[] = [
    new Arcade({ x: 200, y: -1000, w: 1200, h: 800 }, 50),
];

export class LobbyClient {
    public userInput: any;

    public myId: string | null;
    public people: Record<string, ClientPerson>;
    public prevX: number = 0;
    public prevY: number = 0;
    public camera: { x: number, y: number, zoom: number };

    public characterSelect: CharacterSelect;
    public gameSelect: GameSelect;
    public gamesBtn: Button;

    public chatIsOpened: boolean;
    public chatMsgInput: TextInput;
    public chatMessages: Record<string, string[] | undefined>;

    public outgoingMessages: LobbyClientMsg[] = [];
    
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

        const onGameSelected = (gameKey: string) => {
            this.outgoingMessages.push({
                kind: 'gameProposal',
                gameKey: gameKey
            });
        };
        const onGameJoined = (proposalId: string) => {
            this.outgoingMessages.push({
                kind: 'gameProposalAccept',
                proposalId
            });
        };
        const onGameStarted = (proposalId: string) => {
            this.outgoingMessages.push({
                kind: 'startGame',
                proposalId
            });
        };
        const onQueueExit = (proposalId: string, isProposer: boolean) => {
            if (!isProposer) this.outgoingMessages.push({
                kind: 'gameProposalExit',
                proposalId,
            } as ClientGameProposalExitMsg);
            else this.outgoingMessages.push({
                kind: 'gameProposalDelete',
                proposalId
            } as ClientGameProposalDeleteMsg);
        };
        this.gameSelect = new GameSelect(userInput,
            onGameSelected, onGameJoined, onGameStarted, onQueueExit);

        this.gamesBtn = new Button('Games', userInput, () => {
            this.gameSelect.show();
        });

        this.chatMessages = {};
        this.chatIsOpened = false;
        this.chatMsgInput = new TextInput(userInput, {
            alwaysFocused: true,
            colors: { focused: DEFAULT_TEXT_INPUT_COLORS.normal }
        });
        window.addEventListener('keydown', e => {
            if (e.code === 'Enter') {
                if (this.chatIsOpened) {
                    const chatMsg: ClientChatMsg = {
                        kind: 'chat',
                        message: this.chatMsgInput.getValue(),
                    };
                    this.outgoingMessages.push(chatMsg)
                    this.chatIsOpened = false;
                    this.chatMsgInput.clear();
                }
                else {
                    this.chatIsOpened = true;
                    this.chatMsgInput.clear();
                }
            }
            else if (e.code === 'Escape') {
                this.chatIsOpened = false;
                this.chatMsgInput.clear();
            }
        });
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        if (this.currentGame) {
            this.currentGame.draw(ctx, dt);
        } else if (this.gameSelect.isShowing()) {
            this.gameSelect.draw(ctx);
        } else if (this.getMe()) {
            this.updateLobby(dt);
            this.drawLobby(ctx, dt);
        } else {
            this.characterSelect.draw(ctx);
        }

        const { screenW, screenH } = this.userInput;

        if (this.chatIsOpened) {
            const minWH = Math.min(screenW, screenH)
            const margin =  minWH * 0.05;
            const height = minWH * 0.15;
            const width = screenW - 2*margin;

            this.chatMsgInput.draw(ctx, margin, screenH - margin - height, width, height);
        }
    }

    private drawLobby(ctx: CanvasRenderingContext2D, dt: number) {
        const { screenW, screenH } = this.userInput;

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

        // interno degli edifici
        for (const building of buildings) {
            building.draw(ctx, dt);
        }

        Object.entries(this.people).forEach(([playerId, person]) => {
            const drawPerson = getCharacterDrawFunction(person.character);
            drawPerson(ctx, person.x, person.y, PERSON_W, PERSON_H);
            drawPersonName(ctx, person.name, person.x, person.y, PERSON_W, PERSON_H);
            const playerMessages = this.chatMessages[playerId];
            const messageToShow = playerMessages ? playerMessages[0] : null;
            if (messageToShow) {
                drawPersonMessage(ctx, messageToShow, person.x, person.y, PERSON_W, PERSON_H);
            }
        });

        // esterno degli edifici
        for (const building of buildings) {
            building.drawFront(ctx);
        }

        ctx.restore();
        
        this.gamesBtn.draw(ctx, screenW - 110, 10, 100, 30);
    }

    updateLobby(dt: number): void {
        const me = this.getMe();
        const { zoom, moveDirectionX, moveDirectionY } = this.userInput;

        // gestione movimento
        me.xTarget = me.xTarget + moveDirectionX * dt * PERSON_SPEED;
        me.yTarget = me.yTarget + moveDirectionY * dt * PERSON_SPEED;

        Object.values(this.people).forEach((person) => {
            if (person.xTarget)
                person.x = smoothChange(person.x, person.xTarget, dt, 0.05);
            if (person.yTarget)
                person.y = smoothChange(person.y, person.yTarget, dt, 0.05);
        });

        // collisione con gli edifici
        const clientPlayerRect: Rectangle = {
            x: me.xTarget - PERSON_W / 2,
            y: me.yTarget - PERSON_H / 2,
            w: PERSON_W,
            h: PERSON_H,
        };
        for (const building of buildings) {
            for (const box of building.collisionBoxes) {
                const side = getCollisionSide(clientPlayerRect, box);
                if (side === "left") me.xTarget = box.x - PERSON_W / 2;
                else if (side === "right") me.xTarget = box.x + box.w + PERSON_W / 2;
                else if (side === "top") me.yTarget = box.y - PERSON_H / 2;
                else if (side === "bottom") me.yTarget = box.y + box.h + PERSON_H / 2;
            }
            building.update(clientPlayerRect);
        }

        // controllo che il giocatore non esca dallo spazio di gioco
        if (me.yTarget - PERSON_H/2 < worldBounds.top) me.yTarget = worldBounds.top + PERSON_H/2 + EPSILON;
        if (me.yTarget + PERSON_H/2 > worldBounds.bottom) me.yTarget = worldBounds.bottom - PERSON_H/2 - EPSILON;
        if (me.xTarget - PERSON_W/2 < worldBounds.left) me.xTarget = worldBounds.left + PERSON_W/2 + EPSILON;
        if (me.xTarget + PERSON_W/2 > worldBounds.right) me.xTarget = worldBounds.right - PERSON_W/2 - EPSILON;

        // la camera segue il giocatore
        this.camera.x = me.x;
        this.camera.y = me.y;
        this.camera.zoom = zoom;
    }

    async handleMessage(message: LobbyServerMsg) {
        if (message.kind === "gameStarted") {
            // ignore if already in a game of if i'm not in players list
            if (this.currentGame || !message.players[this.myId]) return;

            this.gameSelect.hide();
            this.gameSelect.reset();

            const gameInfo = GAMES[message.gameKey];
            if (!gameInfo) return;

            this.currentGame = new gameInfo.client(this.userInput, this.myId!);
            await this.currentGame.init(message.players);
            this.currentGameId = message.gameId;
        }
        else if (message.kind === "gameJoinRefused") {
            const { reason } = message;
            this.gameSelect.reset();
            if (reason === 'full') alert("Can't join, game is full");
            else alert("Couldn't join game");
        }
        else if (message.kind === "gameProposalsUpdate") {
            const proposals = this.extendGameProposals(message.gameProposals);
            this.gameSelect.updateGameProposals(proposals);
        }
        else if (message.kind === "game") {
            if (this.currentGame && message.gameId === this.currentGameId) {
                this.currentGame.handleMessage(message.data);
            }
        }
        else if (message.kind === "init") {
            this.myId = message.yourId;
            this.people = message.people as Record<string, ClientPerson>;
            Object.values(this.people).forEach(person => {
                person.xTarget = person.x;
                person.yTarget = person.y;
            });
            const proposals = this.extendGameProposals(message.gameProposals);
            this.gameSelect.updateGameProposals(proposals);

        }
        else if (message.kind === "nameIsTaken") {
            alert("nickname is already taken");
            this.characterSelect.resetSelection();
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
        else if (message.kind === "exit") {
            delete this.people[message.id];
            this.gameSelect.removePlayer(message.id);
            // TODO remove player from games too
        }
        else if (message.kind === "chat") {
            // if (message.playerId !== this.myId) {}
            const { playerId, message: msg } = message;
            this.handleChatMsg(playerId, msg);
        }
    }

    handleChatMsg(playerId: string, msg: string) {
        const playerMessages = this.chatMessages[playerId];
        if (playerMessages) {
            playerMessages.unshift(msg);
        } else {
            this.chatMessages[playerId] = [msg];
        }
    }

    flushMessages(): LobbyClientMsg[] {
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
        
        if (this.currentGame && this.currentGameId) {
            if (this.currentGame.isFinished()) {
                this.currentGame = null;
                this.currentGameId = null;
            }
            else {
                const gameMessages = this.currentGame.flushMessages();
                gameMessages.forEach((message) => {
                    messages.push({
                        kind: "game",
                        gameId: this.currentGameId,
                        data: message
                    });
                })
            }
        }

        return messages;
    }

    private getMe(): ClientPerson | null {
        return this.myId ? this.people[this.myId] : null;
    }

    private extendGameProposals(proposals: Record<string, GameProposal>): Record<string, ExtendedGameProposal> {
        const extProposals: Record<string, ExtendedGameProposal> = {};
        Object.keys(proposals).forEach(proposalId => {
            const gameProposal = proposals[proposalId];
            const { proposerId, gameKey, acceptedPlayerIds } = gameProposal;
            const isProposer = proposerId === this.myId;
            const players: Record<string, Player> = {};
            acceptedPlayerIds.forEach(id => players[id] = this.people[id]);
            extProposals[proposalId] = {
                proposalId, proposerId, isProposer, gameKey, players 
            };
        });
        return extProposals;
    }
} 
