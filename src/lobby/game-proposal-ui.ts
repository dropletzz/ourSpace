import { UserInput } from '../client/user-input';
import { Button } from '../client/ui-elements';
import { getCharacterDrawFunction } from '../client/characters';

const PERSON_W = 40;
const PERSON_H = 120;

type PlayerInfo = {
    id: string;
    name: string;
    character: string;
};

export class GameProposalUI {
    private userInput: UserInput;
    
    // State
    private isProposer: boolean = false;
    private gameName: string = '';
    private proposerName: string = '';
    private proposalId: string = '';
    private players: PlayerInfo[] = [];
    
    // UI Elements
    private startBtn: Button | null = null;
    
    constructor(userInput: UserInput) {
        this.userInput = userInput;
        this.startBtn = null; // Will be created when we're the proposer
    }
    
    setParameters(
        isProposer: boolean,
        gameName: string,
        proposerName: string,
        proposalId: string,
        onStartGame?: () => void
    ): void {
        this.isProposer = isProposer;
        this.gameName = gameName;
        this.proposerName = proposerName;
        this.proposalId = proposalId;
        
        // Recreate start button if we're the proposer and have a callback
        if (this.isProposer && onStartGame) {
            this.startBtn = new Button('start game', this.userInput, onStartGame);
            this.startBtn.setColors({ main: "#58a515" });
        } else {
            this.startBtn = null;
        }
    }
    
    setPlayers(players: PlayerInfo[]): void {
        this.players = players;
    }
    
    isConfigured(): boolean {
        return this.proposalId !== '';
    }
    
    reset(): void {
        this.isProposer = false;
        this.gameName = '';
        this.proposerName = '';
        this.proposalId = '';
        this.players = [];
        this.startBtn = null;
    }
    
    draw(ctx: CanvasRenderingContext2D): void {
        const { screenW, screenH } = this.userInput;
        const side = Math.min(screenH, screenW);

        ctx.save();

        ctx.translate(screenW/2, screenH/2); // center screen

        const borderWidth = 20;
        ctx.beginPath();
        ctx.rect(-side/2, -side/2, side, side);
        ctx.clip();
        ctx.strokeStyle = "#161616";
        ctx.lineWidth = borderWidth;
        ctx.fillStyle = "#acabab";
        ctx.fill();
        ctx.stroke();

        const padding = borderWidth + 5;
        
        // Title
        ctx.fillStyle = "#000";
        ctx.font = "bold 24px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(`${this.proposerName} wants to play ${this.gameName}!`, 0, -side/2 + padding);
        
        // Subtitle
        ctx.font = "18px Arial";
        if (this.players.length > 0) {
            ctx.fillText("Players who joined:", 0, -side/2 + padding + 40);
        } else {
            ctx.fillText("Waiting for players to join...", 0, -side/2 + padding + 40);
        }
        
        // Draw players
        if (this.players.length > 0) {
            const playerSize = side * 0.15;
            const playerSpacing = side * 0.2;
            const startX = -((this.players.length - 1) * playerSpacing) / 2;
            
            this.players.forEach((player, index) => {
                const x = startX + index * playerSpacing;
                const y = -side/2 + padding + 100;
                
                // Draw character
                const drawPerson = getCharacterDrawFunction(player.character);
                drawPerson(ctx, x, y, playerSize * PERSON_W / PERSON_H, playerSize);
                
                // Draw name
                ctx.fillStyle = "#000";
                ctx.font = "16px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillText(player.name, x, y + playerSize + 10);
            });
        }
        
        // Draw start button if proposer
        if (this.isProposer && this.startBtn) {
            const btnWidth = side * 0.4;
            const btnHeight = side * 0.1;
            this.startBtn.draw(ctx, -btnWidth/2, side/2 - btnHeight - padding, btnWidth, btnHeight);
        }
        
        // Draw waiting message if not proposer
        if (!this.isProposer) {
            ctx.fillStyle = "#000";
            ctx.font = "18px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("Waiting for game to start...", 0, side/2 - padding - 60);
        }

        ctx.restore();
    }
}