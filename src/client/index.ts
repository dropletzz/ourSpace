import { TICK_FREQUENCY } from '../common';
import { UserInput } from './user-input';
import { LobbyClient } from '../lobby/index';

const playground = document.getElementById('playground') as HTMLCanvasElement;
const ctx: CanvasRenderingContext2D = playground.getContext("2d")!;

export const userInput = new UserInput(playground);
export const lobby = new LobbyClient(userInput);

let lastFrameTime = performance.now();

function draw(timestamp: number) {
    const dt = (timestamp - lastFrameTime) / 1000; // millis to seconds
    lastFrameTime = timestamp;
    lobby.draw(ctx, dt);
    requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const wsHost = window.location.host;
const wsConnectionString = `${wsProtocol}://${wsHost}`;
export const socket = new WebSocket(wsConnectionString);

socket.addEventListener("message", async event => {
    let incomingMessage;
    try {
        incomingMessage = JSON.parse(event.data);
        await lobby.handleMessage(incomingMessage);
    } catch (e) {
        if (e instanceof SyntaxError) {
            console.error(`Unparsable JSON message from server: "${event.data}"`, e.message);
        } else {
            console.error('Error handling the message:', incomingMessage);
            console.error(e);
        }
    }
});

setInterval(() => {
    lobby.flushMessages().forEach((message) =>{
        socket.send(JSON.stringify(message));
    })
}, 1000/TICK_FREQUENCY);
