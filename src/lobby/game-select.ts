import { mod, Player, PERSON_W, PERSON_H } from '../common';
import { Button } from '../client/ui-elements';
import { UserInput } from '../client/user-input';
import { getCharacterDrawFunction } from '../client/characters';
import { GAMES } from '../games/index'

type GameSelectState = "main" | "gameSelect" | "waitingForMyProposal" | "gameJoin" | "gameQueue";

export type ExtendedGameProposal = {
    proposalId: string;
    proposerId: string;
    isProposer: boolean;
    gameKey: string;
    players: Record<string, Player>;
};

export class GameSelect {
    private state: GameSelectState;
    private userInput: UserInput;
    private isVisible: boolean;
    
    private leftBtn: Button;
    private rightBtn: Button;
    private bottomLeftBtn: Button;
    private bottomRightBtn: Button;
    private newGameBtn: Button;
    private joinGameBtn: Button;

    private gameKeys: string[];
    private selectedGameKeyIndex: number;

    private gameProposals: Record<string, ExtendedGameProposal>;
    private selectedGameProposalId: string | null;

    private onGameSelected: (gameKey: string) => void;
    private onGameJoined: (proposalId: string) => void;
    private onGameStarted: (proposalId: string) => void;
    private onQueueExit: (proposalId: string, isProposer: boolean) => void;
    
    constructor(
        userInput: UserInput,
        onGameSelected: (gameKey: string) => void,
        onGameJoined: (proposalId: string) => void,
        onGameStarted: (proposalId: string) => void,
        onQueueExit: (proposalId: string, isProposer: boolean) => void,
    ) {
        this.state = "main";
        this.userInput = userInput;
        this.onGameSelected = onGameSelected;
        this.onGameJoined = onGameJoined;
        this.onGameStarted = onGameStarted;
        this.onQueueExit = onQueueExit;
        this.isVisible = false;
        this.gameKeys = Object.keys(GAMES);
        this.selectedGameKeyIndex = 0;
        this.gameProposals = {};
        this.selectedGameProposalId = null;

        this.newGameBtn = new Button('new game', userInput, () => {
            if (!this.isShowing()) return; // bad hack

            if (this.state === "main") {
                this.selectedGameKeyIndex = 0;
                this.state = "gameSelect";
            }
        });

        this.joinGameBtn = new Button('join game', userInput, () => {
            if (!this.isShowing()) return; // bad hack

            if (this.state === "main") {
                const proposalIds = Object.keys(this.gameProposals);
                this.selectedGameProposalId = proposalIds.length ? proposalIds[0] : null;
                this.state = "gameJoin";
            }
        });

        const shiftGame = (n: number) => {
            this.selectedGameKeyIndex = mod(this.selectedGameKeyIndex + n, this.gameKeys.length);
        }

        const shiftProposal = (n: number) => {
            const proposalIds = Object.keys(this.gameProposals).sort();
            if (proposalIds.length === 0) {
                this.reset();
            }
            else {
                const index = proposalIds.indexOf(this.selectedGameProposalId);
                if (index >= 0) {
                    const newIndex = mod(index + n, proposalIds.length);
                    this.selectedGameProposalId = proposalIds[newIndex];
                }
            }
        }
        
        this.leftBtn = new Button('<', userInput, () => {
            if (!this.isShowing()) return; // bad hack

            if (this.state === "gameSelect") shiftGame(-1);
            else if (this.state === "gameJoin") shiftProposal(-1);
        });
        
        this.rightBtn = new Button('>', userInput, () => {
            if (!this.isShowing()) return; // bad hack

            if (this.state === "gameSelect") shiftGame(1);
            else if (this.state === "gameJoin") shiftProposal(1);
        });
        
        this.bottomRightBtn = new Button('play', userInput, () => {
            if (!this.isShowing()) return; // bad hack

            if (this.state === "gameSelect") {
                const gameKey = this.gameKeys[this.selectedGameKeyIndex];
                this.onGameSelected(gameKey);
                this.state = "waitingForMyProposal";
            }
            else if (this.state === "gameJoin") {
                if (!this.selectedGameProposalId) return;
                const gameProposal = this.gameProposals[this.selectedGameProposalId];
                if (!gameProposal) return;

                this.onGameJoined(gameProposal.proposalId);
                this.state = 'gameQueue';
            }
            else if (this.state === "gameQueue") {
                if (!this.selectedGameProposalId) return;
                const gameProposal = this.gameProposals[this.selectedGameProposalId];
                if (!(gameProposal && gameProposal.isProposer)) return;

                const { gameKey, players } = gameProposal;
                const { minPlayers } = GAMES[gameKey];
                const minPlayersOk = !minPlayers || minPlayers <= Object.keys(players).length
                if (minPlayersOk) {
                    this.onGameStarted(gameProposal.proposalId);
                    this.state = 'main';
                }
                else
                    alert(`You need at least ${minPlayers} players to start the game`);
            }
        });
        this.bottomRightBtn.setColors({ main: "#58a515" });

        this.bottomLeftBtn = new Button('exit', userInput, () => {
            if (!this.isShowing()) return; // bad hack

            if (this.state === "main") this.hide();
            else if (this.state === "gameSelect") this.reset();
            else if (this.state === "gameJoin") this.reset();
            else if (this.state === "gameQueue") {
                const gameProposal = this.gameProposals[this.selectedGameProposalId];
                if (gameProposal) {
                    this.onQueueExit(gameProposal.proposalId, gameProposal.isProposer);
                }
                this.reset();
            }
        });
        this.bottomLeftBtn.setColors({ main: "#a51515" });
    }

    updateGameProposals(proposals: Record<string, ExtendedGameProposal>): void {
        this.gameProposals = proposals;
        if (this.state === 'waitingForMyProposal') {
            const myProposal = Object.values(proposals).find(p => p.isProposer);
            if (myProposal) {
                this.selectedGameProposalId = myProposal.proposalId;
                this.state = 'gameQueue';
            }
        }
        else if (this.state === 'gameQueue') {
            if (!proposals[this.selectedGameProposalId]) this.reset();
        }
    }

    reset() {
        this.state = 'main';
        this.selectedGameKeyIndex = 0;
        this.selectedGameProposalId = null;
    }

    removePlayer(playerId: string) {
        Object.values(this.gameProposals).forEach(gameProposal => {
            delete gameProposal.players[playerId];
        });
    }
    
    draw(ctx: CanvasRenderingContext2D) {
        const { screenW, screenH } = this.userInput;
        const side = Math.min(screenH, screenW);
        const side2 = side / 2;

        ctx.fillStyle = "#eeeeee";
        ctx.fillRect(0, 0, screenW, screenH);
        ctx.save();
        ctx.translate(screenW/2, screenH/2); // centra lo schermo

        const borderWidth = 20;
        ctx.beginPath();
        ctx.rect(-side2, -side2, side, side);
        ctx.clip();
        ctx.strokeStyle = "#161616";
        ctx.lineWidth = borderWidth;
        ctx.fillStyle = "#acabab";
        ctx.fill();
        ctx.stroke();

        const padding = borderWidth + side * 0.03;
        const mainBtnW = side - 2 * padding;
        const mainBtnH = side * 0.2;
        const arrowBtnW = side * 0.1;
        const arrowBtnH = side  * 0.4;
        const bottomBtnW = side * 0.3;
        const bottomBtnH = side * 0.1;

        if (this.state === "main") { // select game
            this.joinGameBtn.draw(ctx, padding - side2, padding -side2, mainBtnW, mainBtnH);
            this.newGameBtn.draw(ctx, padding - side2, 2*padding - side2 + mainBtnH, mainBtnW, mainBtnH);
            this.bottomLeftBtn.draw(ctx, -side*0.4, side2 - bottomBtnH - padding, bottomBtnW, bottomBtnH);
        }
        else if (this.state === "gameSelect") { // select game
            const gameKey = this.gameKeys[this.selectedGameKeyIndex];
            const gameName = GAMES[gameKey].name;
            
            ctx.fillStyle = "#000";
            ctx.font = "bold 32px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(gameName, 0, 0);
            
            // bottoni
            this.rightBtn.draw(ctx, side2 - arrowBtnW - padding, -arrowBtnH/2, arrowBtnW, arrowBtnH);
            this.leftBtn.draw(ctx, -side2 + padding, -arrowBtnH/2, arrowBtnW, arrowBtnH);
            this.bottomLeftBtn.drawWithLabel(ctx, 'back', -side*0.4, side2 - bottomBtnH - padding, bottomBtnW, bottomBtnH);
            this.bottomRightBtn.drawWithLabel(ctx, 'propose', side*0.1, side2 - bottomBtnH - padding, bottomBtnW, bottomBtnH);
        }
        else if (this.state === "gameJoin") { // select game
            if (Object.keys(this.gameProposals).length > 0) {
                const selectedGameProposal: ExtendedGameProposal = this.gameProposals[this.selectedGameProposalId];
                const { gameKey } = selectedGameProposal;
                const gameName = GAMES[gameKey].name;
            
                ctx.fillStyle = "#000";
                ctx.font = "bold 32px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(gameName, 0, 0);
                
                this.rightBtn.draw(ctx, side2 - arrowBtnW - padding, -arrowBtnH/2, arrowBtnW, arrowBtnH);
                this.leftBtn.draw(ctx, -side2 + padding, -arrowBtnH/2, arrowBtnW, arrowBtnH);
                this.bottomRightBtn.drawWithLabel(ctx, 'join', side*0.1, side2 - bottomBtnH - padding, bottomBtnW, bottomBtnH);
            }
            else {
                ctx.fillStyle = "#000";
                ctx.font = "bold 32px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText('no games to join', 0, 0);
            }

            this.bottomLeftBtn.drawWithLabel(ctx, 'back', -side*0.4, side2 - bottomBtnH - padding, bottomBtnW, bottomBtnH);
        }
        else if (this.state === "gameQueue") { // joined game waiting for it to start
            const gameProposal = this.gameProposals[this.selectedGameProposalId];
            if (gameProposal) {
                const { proposerId, gameKey, players } = gameProposal;
                const proposerName = players[proposerId] ? players[proposerId].name : 'noname';
                const gameName = GAMES[gameKey].name;
                const playersVertPadding = side * 0.2;

                ctx.fillStyle = "#000";
                ctx.font = "bold 22px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillText(`${proposerName} wants to play ${gameName}`, 0, -side2 + side*0.03);

                const playersList = Object.values(players);
                this.drawPlayers(ctx, playersList, side, -side2 + playersVertPadding, side2 - playersVertPadding);

                if (gameProposal.isProposer) {
                    this.bottomRightBtn.drawWithLabel(ctx, 'start game', side*0.1, side2 - bottomBtnH - padding, bottomBtnW, bottomBtnH);
                }
            }
            this.bottomLeftBtn.drawWithLabel(ctx, 'back', -side*0.4, side2 - bottomBtnH - padding, bottomBtnW, bottomBtnH);
        }
        ctx.restore();
    }

    drawPlayers(ctx: CanvasRenderingContext2D, playersList: Player[], side: number, yTop: number, yBottom: number) {
        let h = yBottom - yTop;
        let w = side;
        let playersPerRow = 2;
        let numberOfRows = 2;
        while (playersPerRow * numberOfRows < playersList.length) {
            if (playersPerRow <= numberOfRows) playersPerRow++;
            else numberOfRows++;
        }

        const playerSpacingW = w / playersPerRow;
        const playerSpacingH = h / numberOfRows;
        const startX = -w/2 + playerSpacingW/2
        const playerH = playerSpacingH * 0.7;
        const playerW = playerH * PERSON_W / PERSON_H;
        
        playersList.forEach((player, index) => {
            const x = startX + playerSpacingW * (index % playersPerRow);
            const y = yTop + playerSpacingH * Math.floor(index / playersPerRow);
            
            const drawPerson = getCharacterDrawFunction(player.character);
            drawPerson(ctx, x, y, playerW, playerH);
            
            ctx.fillStyle = "#000";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(player.name, x, y + playerH/2 + 2);
        });
    }

    show() { this.isVisible = true; }
    hide() { this.isVisible = false; }
    isShowing() { return this.isVisible; }
}