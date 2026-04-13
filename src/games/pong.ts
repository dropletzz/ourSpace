import { Player, getCollisionSide } from "../common";
import { IncomingMsg, OutgoingMsg } from "../server";
import { GameClient, GameServer } from "./game";


// const BOUNDS = {
//     left: -1, right: 1,
//     top: 1, bottom: -1,
// }

const BALL_W = 0.04;
const BALL_H = 0.04;

export class PongServer extends GameServer {
    private players;
    private balls;
    private ballsIdCounter;

    init(players) {
        this.players = players;
        this.balls = {};
        this.ballsIdCounter = 0;

        let i = 0;
        Object.values(players).forEach((player: any) => {
            if (i % 2 == 0) {
                player.x = -0.95;
                player.y = 0;
            }
            else {
                player.x = +0.95;
                player.y = 0;
            }
            i += 1;
        });

        setInterval(() => {
            this.spawnBall();
        }, 1000);
    }

    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        incomingMessages.forEach(msg => {
            const clientId = msg.clientId;
            const payload = msg.payload;

            if (payload.kind === 'move') {
                const player = this.players[clientId];
                player.y = payload.y;
            }
        });

        Object.values(this.balls).forEach((ball: any) => {
            if (ball.destroyed) return;

            ball.x += ball.vx * dt;
            ball.y += ball.vy * dt;
            if (ball.y < -1) {
                ball.y = -1;
                ball.vy *= -1;
            }
            if (ball.y + BALL_H > 1) {
                ball.y = 1 - BALL_H;
                ball.vy *= -1;
            }

            Object.values(this.players).forEach((player: any) => {
                const ballRect = { x: ball.x, y: ball.y, w: BALL_W, h: BALL_H };
                const playerRect = { x: player.x, y: player.y, w: PLAYER_W, h: PLAYER_H };
                const side = getCollisionSide(ballRect, playerRect);

                if (side === "top") {
                    ball.y = player.y - BALL_H;
                    ball.vy *= -1;
                }
                else if (side === "bottom") {
                    ball.y = player.y + PLAYER_H;
                    ball.vy *= -1;
                }
                else if (side === "left") {
                    ball.x = player.x - BALL_W;
                    ball.vx *= -1;
                }
                else if (side === "right") {
                    ball.x = player.x + PLAYER_W;
                    ball.vx *= -1;
                }
            });
        });

        return [{
            payload: {
                players: this.players,
                balls: this.balls
            }
        }];
    }

    isFinished(): boolean {
        return false;
    }

    spawnBall() {
        const ballSpeed = 0.7;
        let randomAngle = Math.random() * 3.14/4;
        if (Math.random() > 0.5) randomAngle *= -1;
        const ball = {
            x: 0,
            y: 0,
            vx: Math.cos(randomAngle) * ballSpeed,
            vy: Math.sin(randomAngle) * ballSpeed,
            destroyed: false
        }

        this.ballsIdCounter += 1;
        const id = this.ballsIdCounter + '';
        this.balls[id] = ball;
    }
}

const PLAYER_W = 0.05;
const PLAYER_H = 0.2;

export class PongClient extends GameClient {
    private players = null;
    private balls = {};

    init(players: Record<string, Player>) {
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        if (!this.players) return;
        console.log(this.balls);

        const {
            screenW, screenH,
            moveDirectionY
        } = this.userInput;

        const me = this.players[this.myId];
        me.y -= moveDirectionY * 1.3 * dt;
        if (me.y < -1) {
            me.y = -1;
        }
        if (me.y + PLAYER_H > 1) {
            me.y = 1 - PLAYER_H;
        }

        ctx.save();
        ctx.translate(screenW/2, screenH/2);
        ctx.scale(screenW/2, -screenH/2);
        // siamo in coordinate normalizzate (comprese tra -1 ed 1)

        ctx.fillStyle = "#00872f"
        ctx.fillRect(-1, -1, 2, 2);

        Object.entries(this.players).forEach(entry => {
            const id = entry[0];
            const player: any = entry[1];
            ctx.fillStyle = id === this.myId ? "#ff6262" : "#e7e7e7"
            ctx.fillRect(player.x, player.y, PLAYER_W, PLAYER_H);
        });

        Object.entries(this.balls).forEach(entry => {
            const id = entry[0];
            const ball: any = entry[1];
            if (!ball.destroyed) {
                ctx.fillStyle = "#e7e7e7";
                ctx.fillRect(ball.x, ball.y, BALL_W, BALL_H);
            }
        });

        ctx.restore();
    }

    handleMessage(message: any) {
        if (this.players === null) {
            this.players = message.players;
        }
        else {
            Object.entries(message.players).forEach(entry => {
                const id = entry[0];
                const player: any = entry[1];

                if (id !== this.myId) {
                    this.players[id].y = player.y;
                }
            });
            Object.entries(message.balls).forEach(entry => {
                const id = entry[0];
                const updatedBall: any = entry[1];

                const ball = this.balls[id];
                if (!ball) {
                    this.balls[id] = updatedBall;
                }
                else {
                    ball.x = updatedBall.x;
                    ball.y = updatedBall.y;
                }
            });
        }
    }
    flushMessages(): any[] {
        if (!this.players) return [];

        const me = this.players[this.myId];
        return [{
            kind: 'move',
            y: me.y
        }];
    }
    isFinished(): boolean {
        return false;
    }
}