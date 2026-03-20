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
function newPerson() {
    idCounter += 1;
    return {
        id: idCounter+'',
        x: 0,
        y: 0,
        character: 'normalGuy'
    }
};

server.on("connection", (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log("Nuova connessione da " + clientIp);

    const person = newPerson();
    ws.id = person.id;
    people[person.id] = person;
    const newPersonMsg = {
        kind: 'init',
        yourId: person.id,
        people: people
    };
    ws.send(JSON.stringify(newPersonMsg));
    newPeopleIds.push(person.id);

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

    if (newMessages.length > 0) {
        const messages = newMessages;
        newMessages = [];
        messages.forEach(msg => {
            const { senderId, content } = msg;
            if (content.act === 'move') {
                let person = people[senderId];
                if (!person) return;
                const xDist = Math.abs(person.x - content.x);
                const yDist = Math.abs(person.y - content.y);
                person.x = content.x;
                person.y = content.y;
                if (xDist > 0.000001 || yDist > 0.000001)
                    updatedPeople[person.id] = person;
            }
        });
    }

    if (newPeopleIds.length > 0) {
        const peopleIds = newPeopleIds;
        newPeopleIds = [];
        peopleIds.forEach(id => updatedPeople[id] = people[id]);
    }

    const updateMessage = JSON.stringify({
        kind: 'tick',
        people: updatedPeople
    });
    server.clients.forEach(socket => socket.send(updateMessage));

    // // controllo che il giocatore non esca dallo spazio di gioco
    // if (me.y - personH/2 < worldBounds.top) me.y = worldBounds.top + personH/2;
    // if (me.y + personH/2 > worldBounds.bottom) me.y = worldBounds.bottom - personH/2;
    // if (me.x - personW/2 < worldBounds.left) me.x = worldBounds.left + personW/2;
    // if (me.x + personW/2 > worldBounds.right) me.x = worldBounds.right - personW/2;
}

setInterval(tick, 1000/20);