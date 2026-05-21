import { GameServer, GameClient } from "./game";
import { UserInput } from "../client/user-input";
import { GuessGameClient, GuessGameServer } from "./guess";
import { PongClient, PongServer } from "./multi-pong";
import { PolloAMollaServer, PolloAMollaClient } from "./PolloAMolla/game";
import { BrawlClient, BrawlServer } from "./brawl";
import { MicroRacingClient, MicroRacingServer } from "./micro-racing";
import {
  MinecraftDiamondRushClient,
  MinecraftDiamondRushServer,
} from "./minecraft2d";

export type GameInfo = {
  client: new (userInput: UserInput, myId: string) => GameClient;
  server: new () => GameServer;
  name: string;
  minPlayers?: number;
  maxPlayers?: number;
};

export const GAMES: Record<string, GameInfo> = {
  guess: {
    client: GuessGameClient,
    server: GuessGameServer,
    name: "Guess the number",
  },
  pong: {
    client: PongClient,
    server: PongServer,
    name: "Pong",
    minPlayers: 1,
    maxPlayers: 2,
  },
  PolloAMolla: {
    client: PolloAMollaClient,
    server: PolloAMollaServer,
    name: "Pollo A Molla",
    minPlayers: 1,
    maxPlayers: 20,
  },
  brawl: {
    client: BrawlClient,
    server: BrawlServer,
    name: "TOTAL STK BATTLE 67",
    minPlayers: 1,
    maxPlayers: 2,
  },
  microracing: {
    client: MicroRacingClient,
    server: MicroRacingServer,
    name: "Micro Racing",
    minPlayers: 1,
    maxPlayers: 2,
  },
  minecraft2d: {
    client: MinecraftDiamondRushClient,
    server: MinecraftDiamondRushServer,
    name: "Minecraft Diamond Rush",
    minPlayers: 1,
    maxPlayers: 2,
  },
};
