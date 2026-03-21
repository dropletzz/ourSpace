const playground = document.getElementById('playground');
const ctx = playground.getContext("2d");

let screenW = 0, screenH = 0; // larghezza ed altezza del canvas
const camera = { x: 0, y: 0, zoom: 0.5 };
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
        let moveDirX = 0;
        let moveDirY = 0;

        if (joystick.active) {
            moveDirX = joystick.dx;
            moveDirY = joystick.dy;
        } else {
            // Tastiera
            if (goingLeft) moveDirX -= 1;
            if (goingRight) moveDirX += 1;
            if (goingUp) moveDirY -= 1;
            if (goingDown) moveDirY += 1;

            // Normalizza la diagonale
            if (moveDirX !== 0 && moveDirY !== 0) {
                const length = Math.sqrt(moveDirX * moveDirX + moveDirY * moveDirY);
                moveDirX /= length;
                moveDirY /= length;
            }
        }

        // Applica il movimento calcolato (assicurati che non ci siano altri me.x o me.y qui sotto!)
        me.x += moveDirX * personSpeed * dt;
        me.y += moveDirY * personSpeed * dt;

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
        const tileSize = 50; // Grandezza di ogni quadrato (modificala per scacchi più o meno grandi)
        
        for (let x = worldBounds.left; x < worldBounds.right; x += tileSize) {
            for (let y = worldBounds.top; y < worldBounds.bottom; y += tileSize) {
                
                // Calcola l'indice della colonna e della riga correnti
                const col = Math.floor((x - worldBounds.left) / tileSize);
                const row = Math.floor((y - worldBounds.top) / tileSize);
                
                // Alterna i colori in base a se la somma di riga+colonna è pari o dispari
                const isEven = (col + row) % 2 === 0;

                ctx.beginPath();
                ctx.rect(x, y, tileSize, tileSize);
                // Vibe Check: Scegli le due tonalità qui! (Ora sono due verdi stile prato)
                ctx.fillStyle = isEven ? "#58a515" : "#4e9412"; 
                ctx.fill();
            }
        }

        Object.values(people).forEach(p => {
            if (p.id !== myId) {
                if (p.targetX !== undefined) p.x += (p.targetX - p.x) * 0.37;
                if (p.targetY !== undefined) p.y += (p.targetY - p.y) * 0.37;
            }
            drawPerson(p.x, p.y, personW, personH, p.character);
        });
    ctx.restore();

    if (joystick.active) {
        ctx.save();
        ctx.globalAlpha = 0.4; // Semi-trasparente

        // Disegna la base
        ctx.beginPath();
        ctx.arc(joystick.baseX, joystick.baseY, joystick.radius, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#000000";
        ctx.stroke();

        // Disegna la levetta centrale
        ctx.beginPath();
        ctx.arc(joystick.stickX, joystick.stickY, joystick.radius / 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "#000000";
        ctx.fill();

        ctx.restore();
    }

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

// --- GESTIONE TOUCH / VIRTUAL JOYSTICK ---
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

const joystick = {
    active: false,
    baseX: 0, baseY: 0,
    stickX: 0, stickY: 0,
    radius: 60, // Dimensione massima del joystick
    dx: 0, dy: 0 // Vettore di movimento normalizzato (-1 a 1)
};
let movementTouchId = null; // Per tracciare quale dito muove il joystick

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

if (isTouchDevice) {
    playground.addEventListener('touchstart', (e) => {
        e.preventDefault(); // Evita scroll o zoom accidentali
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            
            // Se tocchi la metà sinistra dello schermo, àncora il joystick
            if (!joystick.active) {
                movementTouchId = touch.identifier;
                joystick.active = true;
                joystick.baseX = touch.clientX;
                joystick.baseY = touch.clientY;
                joystick.stickX = touch.clientX;
                joystick.stickY = touch.clientY;
                joystick.dx = 0;
                joystick.dy = 0;
            }
        }
    }, { passive: false });

    playground.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (joystick.active && touch.identifier === movementTouchId) {
                let dx = touch.clientX - joystick.baseX;
                let dy = touch.clientY - joystick.baseY;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Blocca il cursore all'interno del raggio base
                if (distance > joystick.radius) {
                    dx = (dx / distance) * joystick.radius;
                    dy = (dy / distance) * joystick.radius;
                }

                joystick.stickX = joystick.baseX + dx;
                joystick.stickY = joystick.baseY + dy;

                // Calcola l'intensità (da 0.0 a 1.0) per la velocità analogica
                const magnitude = distance > joystick.radius ? 1 : distance / joystick.radius;
                
                // Aggiungi una piccola "deadzone" centrale per evitare movimenti involontari
                if (magnitude > 0.1) {
                    joystick.dx = (dx / (distance || 1)) * magnitude;
                    joystick.dy = (dy / (distance || 1)) * magnitude;
                } else {
                    joystick.dx = 0;
                    joystick.dy = 0;
                }
            }
        }
    }, { passive: false });

    const handleTouchEnd = (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (joystick.active && touch.identifier === movementTouchId) {
                joystick.active = false;
                joystick.dx = 0;
                joystick.dy = 0;
                movementTouchId = null;
            }
        }
    };

    playground.addEventListener('touchend', handleTouchEnd);
    playground.addEventListener('touchcancel', handleTouchEnd);
}

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
