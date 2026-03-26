const fs = require('fs');
const https = require('https');
const { WebSocketServer } = require('ws');

const WEBSOCKET_PORT = 4242;

let httpsServer = null;
if (process.env.OURSPACE_HTTPS_ENABLED) {
    const serverConfig = {
        key: fs.readFileSync(process.env.OURSPACE_HTTPS_KEY),
        cert: fs.readFileSync(process.env.OURSPACE_HTTPS_CERT)
    };
    httpsServer = https.createServer(serverConfig)
}

const wsServer = httpsServer
    ? new WebSocketServer({ server: httpsServer })
    : new WebSocketServer({ port: WEBSOCKET_PORT });

console.log("Server ws in ascolto sulla porta " + WEBSOCKET_PORT);

let people = {};
let idCounter = 0;

let incomingMessage = [];

wsServer.on("connection", (websocket, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log("Nuova connessione da " + clientIp);
    idCounter += 1;
    const id = idCounter + '';
    websocket.id = id;
    const idMessage = {
        kind: "id",
        id: id
    }
    websocket.send(JSON.stringify(idMessage));

    websocket.on("message", async data => {
        const messagePayload= JSON.parse(data);

        incomingMessage.push({
            clientId: websocket.id,
            payload: messagePayload
        });
    
        console.log(messagePayload)
    });

    websocket.on("close", data => {
        console.log("Client disconnesso: " + clientIp);
    });
});



function tick(){
    const messages = incomingMessage;
    incomingMessage = [];

    messages.forEach(message => {
        const { clientId, payload } = message;

        if (payload.kind === "init"){
            people[clientId] = {
                x: 0,
                y: 0,
                speed: 5,
                character: payload.character
            };
        }
        else if (payload.kind === "move"){
            const person = people[clientId];
            if (person) {
                person.x = payload.x;
                person.y = payload.y;
            }
        }
    });

    const resetMessage = JSON.stringify ({
        kind: "reset",
        people: people
    });

    wsServer.clients.forEach(
        client => client.send(resetMessage)
    );
}

setInterval(tick, 1000 / 20);
if (httpsServer) httpsServer.listen(WEBSOCKET_PORT, () => {
    console.log('Server https in ascolto sulla porta ' + WEBSOCKET_PORT);
});