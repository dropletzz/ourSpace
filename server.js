const { WebSocketServer } = require('ws');

const port = 4242;
const server = new WebSocketServer({ port });

console.log("Server ws in ascolto su ws://localhost:"+port);

let people = {};
let newMessages = [];
let newPeopleIds = [];

const personW = 40;
const personH = 120;
const personSpeed = 170;

let idCounter = 0;

function newPerson(id, character) {
    return {
        id: id,
        x: 0,
        y: 0,
        character: character
    }
};

server.on("connection", (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log("Nuova connessione da " + clientIp);

    idCounter += 1;
    ws.id = idCounter+'';
    ws.send(JSON.stringify({ kind: 'id', id: ws.id }));
    // people[person.id] = person;
    // const newPersonMsg = {
    //     kind: 'init',
    //     yourId: person.id,
    //     people: people
    // };

    ws.on("message", async data => {
        newMessages.push({ senderId: ws.id, content: JSON.parse(data) });
    });

    ws.on("close", data => {
        const exitedMsg = JSON.stringify({
            kind: 'exit',
            personId: ws.id
        });
        people[ws.id] = undefined;
        server.clients.forEach(socket => socket.send(exitedMsg));
        console.log("Client disconnesso: " + clientIp);
    });
});

let prevTickTime = process.hrtime.bigint();;
async function tick() {
    const now = process.hrtime.bigint();
    const dt = Number(now - prevTickTime) / 1_000_000_000;
    prevTickTime = now;

    const updatedPeople = {};
    const newPeople = {};

    if (newMessages.length > 0) {
        const messages = newMessages;
        newMessages = [];
        messages.forEach(msg => {
            const { senderId, content } = msg;
            if (content.act === 'move') {
                console.log("move", msg)
                let person = people[senderId];
                if (!person) return;
                const xDist = Math.abs(person.x - content.x);
                const yDist = Math.abs(person.y - content.y);
                person.x = content.x;
                person.y = content.y;
                if (xDist > 0.000001 || yDist > 0.000001)
                    updatedPeople[senderId] = person;
            }
            if (content.act === 'init') {
                const person = newPerson(senderId, content.character);
                people[senderId] = person;
                updatedPeople[senderId] = person;
                newPeople[senderId] = person;
            }
        });
    }

    const initMessage = JSON.stringify({
        kind: 'init',
        people: people
    });
    const updateMessage = JSON.stringify({
        kind: 'tick',
        people: updatedPeople
    });
    server.clients.forEach(socket => {
        if (newPeople[socket.id]) {
            socket.send(initMessage);
            delete newPeople[socket.id];
        }
        else if (Object.keys(updatedPeople) > 0) {
            socket.send(updateMessage)
        }
    });

}

setInterval(tick, 1000/30);