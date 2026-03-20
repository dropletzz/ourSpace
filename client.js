const playground = document.getElementById('playground');
const ctx = playground.getContext("2d");

let screenW = 0, screenH = 0; // larghezza ed altezza del canvas
const camera = { x: 0, y: 0, zoom: 1.0 };
const worldW = 1000, worldH = 600; // larghezza ed altezza dello spazio di gioco
const worldBounds = {
    top: -worldH/2,
    left: -worldW/2,
    bottom: worldH/2,
    right: worldW/2,
};


function resize() {
    screenW = window.innerWidth;
    screenH = window.innerHeight;
    playground.width = screenW;
    playground.height = screenH;
}
resize();
window.addEventListener('resize', resize);

let myId = null;
let people = {};

const personW = 40;
const personH = 120;
const personSpeed = 170;

let prevFrameTime = 0;
function draw(now) {
    const dt = prevFrameTime ? (now - prevFrameTime) / 1000 : 0;
    prevFrameTime = now;

    const me = myId ? people[myId] : null;
    if (me) {
        // gestione movimento
        if (goingUp) me.y -= personSpeed * dt;
        if (goingLeft) me.x -= personSpeed * dt;
        if (goingDown) me.y += personSpeed * dt;
        if (goingRight) me.x += personSpeed * dt;

        // la camera segue il giocatore
        camera.x = me.x;
        camera.y = me.y;
    }

    // pulisci lo schermo
    ctx.beginPath();
    ctx.rect(0, 0, screenW, screenH);
    ctx.fillStyle = "#000";
    ctx.fill();

    ctx.save(); // sistema di coordinate world-space
        ctx.translate(screenW/2, screenH/2); // centra lo schermo
        ctx.scale(camera.zoom, camera.zoom); // applica lo zoom
        ctx.translate(-camera.x, -camera.y); // sposta relativamente alla camera

        // disegna lo sfondo del "mondo" (campo da gioco)
        ctx.beginPath();
        ctx.rect(worldBounds.left, worldBounds.top, worldW, worldH);
        ctx.fillStyle = "#58a515";
        ctx.fill();

        Object.values(people).forEach(p => {
            if (p.id !== myId) {
                if (p.targetX !== undefined) p.x += (p.targetX - p.x) * 0.37;
                if (p.targetY !== undefined) p.y += (p.targetY - p.y) * 0.37;
            }
            drawPerson(p.x, p.y, personW, personH, p.character);
        });
    ctx.restore();

    requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

function drawPerson(x, y, w, h, style) {
    const drawFunction = characters[style];
    drawFunction(x, y, w, h, style);
}

const socket = new WebSocket("ws://localhost:4242");
socket.addEventListener("message", async event => {
    console.log(event.data);
    const msg = JSON.parse(event.data);
    if (msg.kind === "init") {
        myId = msg.yourId;
        people = msg.people;
    }
    else if (msg.kind === "tick") {
        // people = msg.people;
        Object.values(msg.people).forEach(p => {
            if (!people[p.id]) people[p.id] = p;
            else if (p.id != myId){
                people[p.id].targetX = p.x;
                people[p.id].targetY = p.y;
            }
        });
    }
    else if (msg.kind === "exit") {
        console.log(msg);
        delete people[msg.personId];
    }
});

// TODO spostare la gestione dei movimenti sul server
let goingUp = false;
let goingLeft = false;
let goingDown = false;
let goingRight = false;

document.addEventListener("keydown", (event) => {
    if (event.code == "KeyW") goingUp = true;
    else if (event.code == "KeyA") goingLeft = true;
    else if (event.code == "KeyS") goingDown = true;
    else if (event.code == "KeyD") goingRight = true;
});
document.addEventListener("keyup", (event) => {
    if (event.code == "KeyW") goingUp = false;
    else if (event.code == "KeyA") goingLeft = false;
    else if (event.code == "KeyS") goingDown = false;
    else if (event.code == "KeyD") goingRight = false;
});

setInterval(() => {
    const me = myId ? people[myId] : null;
    if (me) socket.send(JSON.stringify({ act: 'move', x: me.x, y: me.y }));
}, 1000/20);

// gestione dello zoom
const minZoom = 0.1, maxZoom = 4;
const zoomSpeed = 0.035;
window.addEventListener('wheel', (event) => {
    event.preventDefault();
    
    if (event.deltaY > 0) {
        camera.zoom *= (1 - zoomSpeed);
    } else {
        camera.zoom *= (1 + zoomSpeed);
    }

    camera.zoom = Math.min(Math.max(minZoom, camera.zoom), maxZoom);
}, { passive: false });

const characters = {
    normalGuy: drawNormalGuy,
}

function drawNormalGuy(x, y, w, h, style = {}) {
    ctx.save();

    // move origin (x=0, y=0) to the person center
    ctx.translate(x, y);
    const startX = -w/2;
    const startY = -h/2;

    // +head
    const headH = h * 0.3;

    ctx.beginPath();
    ctx.fillStyle = style.skinColor || "#eaa66e";
    ctx.rect(startX, startY, w, headH);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#151514";
    ctx.rect(startX, startY, w, headH/4);
    ctx.fill();
    // -head

    // +body
    const bodyStartY = startY + headH;
    const bodyH = h * 0.35;
    const armLen = 0.4 * w;

    ctx.beginPath();
    ctx.fillStyle = "#04097f";
    ctx.rect(startX, bodyStartY, w, bodyH); // body
    ctx.rect(startX - armLen, bodyStartY, armLen, 0.35*bodyH); // left arm
    ctx.rect(startX + w, bodyStartY, armLen, 0.35*bodyH); // left arm
    ctx.fill();
    // -body

    // +legs
    const legH = h - headH - bodyH;
    const legStartY = bodyStartY + bodyH;
    const legW = w * 0.35;

    ctx.beginPath();
    ctx.fillStyle = "#100712";
    ctx.rect(startX, legStartY, w, legH/3); // top
    ctx.rect(startX, legStartY, legW, legH); // left leg
    ctx.rect(startX + w - legW, legStartY, legW, legH); // right leg
    ctx.fill();
    // -legs

    // +bounding box
    ctx.beginPath();
    ctx.rect(startX, startY, w, h);
    ctx.strokeStyle = "#f620ef";
    ctx.stroke();
    /*
    */
    // -bounding box

    ctx.restore();
}
