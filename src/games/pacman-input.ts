// ============ PACMAN USER INPUT EXTENSION ============
// Estensione specializzata di UserInput per il gioco Pacman
// Eredita dalla classe base UserInput e aggiunge funzionalità specifiche per Pacman

import { UserInput } from '../client/user-input';

type DirectionName = 'ArrowLeft' | 'ArrowUp' | 'ArrowRight' | 'ArrowDown';

export class PacmanUserInput extends UserInput {
    public currentDirection: DirectionName | null = null;
    public queuedDirection: DirectionName | null = null;

    private arrowUp: boolean = false;
    private arrowDown: boolean = false;
    private arrowLeft: boolean = false;
    private arrowRight: boolean = false;

    constructor(canvas: HTMLCanvasElement) {
        super(canvas);

        // Aggiungi event listener specializzati per le frecce direzionali di Pacman
        document.addEventListener("keydown", (event) => {
            if (event.repeat) return;

            if (event.code === "ArrowUp") {
                this.arrowUp = true;
                this.queuedDirection = "ArrowUp";
            } else if (event.code === "ArrowDown") {
                this.arrowDown = true;
                this.queuedDirection = "ArrowDown";
            } else if (event.code === "ArrowLeft") {
                this.arrowLeft = true;
                this.queuedDirection = "ArrowLeft";
            } else if (event.code === "ArrowRight") {
                this.arrowRight = true;
                this.queuedDirection = "ArrowRight";
            }

            this.updatePacmanDirection();
        });

        document.addEventListener("keyup", (event) => {
            if (event.code === "ArrowUp") this.arrowUp = false;
            else if (event.code === "ArrowDown") this.arrowDown = false;
            else if (event.code === "ArrowLeft") this.arrowLeft = false;
            else if (event.code === "ArrowRight") this.arrowRight = false;

            this.updatePacmanDirection();
        });

        window.addEventListener("blur", () => {
            this.currentDirection = null;
            this.queuedDirection = null;
            this.arrowUp = false;
            this.arrowDown = false;
            this.arrowLeft = false;
            this.arrowRight = false;
        });
    }

    private updatePacmanDirection() {
        // Aggiorna la direzione corrente basata sui tasti premuti
        if (this.arrowUp) {
            this.currentDirection = "ArrowUp";
        } else if (this.arrowDown) {
            this.currentDirection = "ArrowDown";
        } else if (this.arrowLeft) {
            this.currentDirection = "ArrowLeft";
        } else if (this.arrowRight) {
            this.currentDirection = "ArrowRight";
        } else {
            this.currentDirection = null;
        }
    }

    /**
     * Ottiene la direzione corrente del Pacman
     */
    public getDirection(): DirectionName | null {
        return this.currentDirection;
    }

    /**
     * Ottiene la direzione messa in coda (per il prossimo movimento possibile)
     */
    public getQueuedDirection(): DirectionName | null {
        return this.queuedDirection;
    }

    /**
     * Resetta la coda delle direzioni
     */
    public clearQueuedDirection(): void {
        this.queuedDirection = null;
    }
}
