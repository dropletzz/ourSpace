import { GameServer, GameClient } from "./game";
import { UserInput } from "../client/user-input";
import { GuessGameClient, GuessGameServer } from "./guess";
import { PongClient, PongServer } from "./multi-pong";
import { HeroSurvGameClient, HeroSurvGameServer } from "./herosurv";

export type GameInfo = {
    client: new (userInput: UserInput, myId: string) => GameClient;
    server: new () => GameServer;
    name: string;
}

export const GAMES: Record<string, GameInfo> = {
    guess: {
        client: GuessGameClient,
        server: GuessGameServer,
        name: 'Indovina il Numero'
    },
    pong: {
        client: PongClient,
        server: PongServer,
        name: 'Pong Multiplayer'
    },
    herosurv: {
        client: HeroSurvGameClient,
        server: HeroSurvGameServer,
        name: 'HeroSurv Arena'
    }
}