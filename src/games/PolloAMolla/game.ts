
import { IncomingMsg, OutgoingMsg } from "../../server";
import { Player } from "../../common";
import { UserInput } from "../../client/user-input";
import { GameClient, GameServer } from "./../game";
import { PHYSICS, PLAYER, SPRITE_SHEET } from "./constants";
import { drawGame } from "./renderer";
import { createPlayer } from "./player";
import { FLAG, SPAWN } from "./map";
import { updatePlayer } from "./physics";
import { JumpPlayer, PlayerInput } from "./types";

type PolloClientMsg = {
  kind: "input";
  moveDirectionX: number;
  moveDirectionY: number;
  jumpHeld: boolean;
};

type PolloServerMsg = {
  players: Record<string, JumpPlayer>;
  timeSeconds: number;
  gameOver: boolean;
  winnerId: string | null;
  winSecondsRemaining: number;
};

const WIN_DISPLAY_SECONDS = 5;

function overlaps(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function readInput(payload: PolloClientMsg | any): PlayerInput | null {
  if (!payload || payload.kind !== "input") return null;
  return {
    moveDirectionX: typeof payload.moveDirectionX === "number" ? payload.moveDirectionX : 0,
    moveDirectionY: typeof payload.moveDirectionY === "number" ? payload.moveDirectionY : 0,
    jumpHeld: payload.jumpHeld === true,
  };
}

function defaultInput(): PlayerInput {
  return { moveDirectionX: 0, moveDirectionY: 0, jumpHeld: false };
}

export class PolloAMollaServer extends GameServer {
  private players: Record<string, JumpPlayer> = {};
  private inputs: Record<string, PlayerInput> = {};
  private timeSeconds = 0;
  private gameOver = false;
  private winnerId: string | null = null;
  private winSecondsRemaining = 0;

  init(players: Record<string, unknown>) {
    this.players = {};
    this.inputs = {};
    this.timeSeconds = 0;
    this.gameOver = false;
    this.winnerId = null;
    this.winSecondsRemaining = 0;

    Object.keys(players).forEach((id, index) => {
      const player = createPlayer(SPAWN.x + index * 0.4, SPAWN.y);
      player.facing = index % 2 === 0 ? 1 : -1;
      this.players[id] = player;
      this.inputs[id] = defaultInput();
    });
  }

  tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
    const stepSeconds = Math.min(dt, PHYSICS.maxStepSeconds);
    this.timeSeconds += stepSeconds;

    if (!this.gameOver) {
      incomingMessages.forEach((message) => {
        const input = readInput(message.payload);
        if (input && this.players[message.clientId]) {
          this.inputs[message.clientId] = input;
        }
      });

      Object.keys(this.players).forEach((id) => {
        const player = this.players[id];
        const input = this.inputs[id] ?? defaultInput();
        updatePlayer(player, input, stepSeconds, this.timeSeconds);
      });

      for (const [id, player] of Object.entries(this.players)) {
        if (overlaps(player.x, player.y, PLAYER.width, PLAYER.height, FLAG.x, FLAG.y, FLAG.w, FLAG.h)) {
          this.gameOver = true;
          this.winnerId = id;
          this.winSecondsRemaining = WIN_DISPLAY_SECONDS;
          break;
        }
      }
    } else {
      this.winSecondsRemaining = Math.max(0, this.winSecondsRemaining - stepSeconds);
    }

    return [
      {
        payload: {
          players: this.players,
          timeSeconds: this.timeSeconds,
          gameOver: this.gameOver,
          winnerId: this.winnerId,
          winSecondsRemaining: this.winSecondsRemaining,
        } satisfies PolloServerMsg,
      },
    ];
  }

  isFinished(): boolean {
    return this.gameOver && this.winSecondsRemaining <= 0;
  }
}

export class PolloAMollaClient extends GameClient {
  private players: Record<string, JumpPlayer> | null = null;
  private lobbyPlayers: Record<string, Player> = {};
  private playerSprite: HTMLImageElement | null = null;
  private backgroundImage: HTMLImageElement | null = null;
  private timeSeconds = 0;
  private started = false;
  private gameOver = false;
  private winnerId: string | null = null;
  private winSecondsRemaining = 0;

  private prevPlayerState: Record<string, { y: number; onGround: boolean; vy: number }> = {};

  constructor(userInput: UserInput, myId: string) {
    super(userInput, myId);
  }

  async init(players: Record<string, unknown>) {
    this.lobbyPlayers = players as Record<string, Player>;
    await Promise.all([
      this.assets.loadImage("player", SPRITE_SHEET.url),
      this.assets.loadImage("background", "/assets/PolloAMolla/sfondo.png"),
    ]);
    this.playerSprite = this.assets.images.player;
    this.backgroundImage = this.assets.images.background;
    return Promise.resolve();
  }

  draw(ctx: CanvasRenderingContext2D, dt: number) {
    if (this.userInput.moveDirectionY < 0) this.started = true;
    if (this.players === null) return;

    this.timeSeconds += dt;

    for (const [id, player] of Object.entries(this.players)) {
      const prev = this.prevPlayerState[id];
      if (prev) {
        const justLanded = !prev.onGround && player.onGround;
        // particle spawn removed on land
      }
      this.prevPlayerState[id] = {
        y: player.y,
        onGround: player.onGround,
        vy: player.vy,
      };
    }

    drawGame(
      ctx,
      this.userInput.screenW,
      this.userInput.screenH,
      this.players,
      this.lobbyPlayers,
      this.myId,
      this.playerSprite,
      this.backgroundImage,
      dt,
      this.timeSeconds,
      this.started,
      this.gameOver,
      this.winnerId,
      this.winSecondsRemaining,
    );
  }

  handleMessage(message: PolloServerMsg) {
    this.players = message.players;
    this.timeSeconds = message.timeSeconds;
    this.gameOver = message.gameOver;
    this.winnerId = message.winnerId;
    this.winSecondsRemaining = message.winSecondsRemaining;
  }

  flushMessages(): PolloClientMsg[] {
    if (this.gameOver) {
      return [
        {
          kind: "input",
          moveDirectionX: 0,
          moveDirectionY: 0,
          jumpHeld: false,
        },
      ];
    }
    return [
      {
        kind: "input",
        moveDirectionX: this.userInput.moveDirectionX,
        moveDirectionY: this.userInput.moveDirectionY,
        jumpHeld: this.userInput.moveDirectionY < 0,
      },
    ];
  }

  isFinished(): boolean {
    return this.gameOver && this.winSecondsRemaining <= 0;
  }
}
