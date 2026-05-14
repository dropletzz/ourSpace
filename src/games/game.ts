import { Player } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';

export abstract class GameServer {
    abstract init(players: Record<string, Player>);

    abstract tick(
        incomingMessages: IncomingMsg[],
        dt: number
    ): OutgoingMsg[];

    abstract isFinished(): boolean;
}

/////////////////////////////////////////

import { UserInput } from '../client/user-input';

export abstract class GameClient {
    protected userInput: UserInput;
    protected myId: string;

    constructor(userInput: UserInput, myId: string) {
        this.userInput = userInput;
        this.myId = myId;
    }

    abstract init(players: Record<string, Player>);
    abstract draw(ctx: CanvasRenderingContext2D, dt: number);
    abstract handleMessage(message: any);
    abstract flushMessages(): any[];
    abstract isFinished(): boolean;
}
