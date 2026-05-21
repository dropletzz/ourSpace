import { PERSON_W, PERSON_H, Player, smoothChange } from '../../common';
import { Button } from '../../client/ui-elements';
import { GAMES } from '../../games/index'
import { getCollisionSide } from '../../common';
import { IncomingMsg, OutgoingMsg } from '../../server';
import { GameClient, GameServer } from '../game';
import { drawPersonName } from '../../lobby/index';

const PERSON_SPEED = 300;

type WeaponType = 'pistol' | 'pump' | 'sniper' | 'assault' | 'grenade' | 'pickaxe' | 'shield' | 'medkit';

const WEAPONS = ['pistol', 'pump', 'sniper', 'assault', 'grenade', 'pickaxe', 'shield', 'medkit'] as const;

const WEAPON_IMAGE_FILES: Record<WeaponType, string> = {
    pistol: 'pistola.png',
    pump: 'pompa.png',
    sniper: 'cecchino.png',
    assault: 'assalto.png',
    grenade: 'granata.png',
    pickaxe: 'piccone.png',
    shield: 'scudo.png',
    medkit: 'medikit.png'
};

const WEAPON_DEFINITIONS: Record<WeaponType, {
    displayName: string;
    color: string;
    cooldown: number;
    damage: number;
    range: number;
    speed: number;
    spreadAngle: number;
    magazine: number;
    reloadTime: number;
    pellets: number;
    size: number;
}> = {
    pistol: { displayName: 'Pistol', color: '#ffeb3b', cooldown: 0.2, damage: 18, range: 1000, speed: 600, spreadAngle: 0, magazine: 15, reloadTime: 1.5, pellets: 1, size: 4 },
    pump: { displayName: 'Pump', color: '#f39c12', cooldown: 1.0, damage: 22, range: 400, speed: 600, spreadAngle: 15 * Math.PI / 180, magazine: 5, reloadTime: 2.0, pellets: 5, size: 5 },
    sniper: { displayName: 'Sniper', color: '#3498db', cooldown: 0.4, damage: 110, range: 3000, speed: 600, spreadAngle: 0, magazine: 1, reloadTime: 5.0, pellets: 1, size: 4 },
    assault: { displayName: 'Assault', color: '#2ecc71', cooldown: 0.4, damage: 20, range: 1000, speed: 600, spreadAngle: 0, magazine: 20, reloadTime: 1.5, pellets: 1, size: 4 },
    grenade: { displayName: 'Grenade', color: '#9b59b6', cooldown: 1.25, damage: 70, range: 650, speed: 280, spreadAngle: 0, magazine: 1, reloadTime: 2.5, pellets: 1, size: 12 },
    pickaxe: { displayName: 'Pickaxe', color: '#d35400', cooldown: 0.5, damage: 40, range: 50, speed: 0, spreadAngle: 0, magazine: 0, reloadTime: 0, pellets: 1, size: 5 },
    shield: { displayName: 'Shield', color: '#2980b9', cooldown: 0.3, damage: 0, range: 0, speed: 0, spreadAngle: 0, magazine: 0, reloadTime: 0, pellets: 0, size: 0 },
    medkit: { displayName: 'Medkit', color: '#c0392b', cooldown: 0.3, damage: 0, range: 0, speed: 0, spreadAngle: 0, magazine: 0, reloadTime: 0, pellets: 0, size: 0 },
};

const AMMO_WEAPON_TYPES: WeaponType[] = ['pistol', 'pump', 'sniper', 'assault'];
const INITIAL_AMMO_RESERVE: Record<WeaponType, number> = {
    pistol: 0,
    pump: 0,
    sniper: 0,
    assault: 0,
    grenade: 0,
    pickaxe: 0,
    shield: 0,
    medkit: 0
};

const AMMO_DROP_RANGES: Record<WeaponType, [number, number]> = {
    pistol: [12, 24],
    pump: [6, 12],
    sniper: [2, 5],
    assault: [18, 30],
    grenade: [0, 0],
    pickaxe: [0, 0],
    shield: [0, 0],
    medkit: [0, 0]
};

const createEmptyAmmoReserve = () => ({ ...INITIAL_AMMO_RESERVE });

function getRandomAmmoDrop(weapon: WeaponType) {
    const range = AMMO_DROP_RANGES[weapon] || [0, 0];
    const [min, max] = range;
    return min >= max ? min : Math.floor(Math.random() * (max - min + 1)) + min;
}

type Bullet = {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    speed: number;
    remainingRange: number;
    weapon: WeaponType;
    ownerId: string;
    damage: number;
    width: number;
    height: number;
    angle: number;
    color: string;
    explosive?: boolean;
};

type HitEffect = {
    x: number;
    y: number;
    type: 'muzzle' | 'hit' | 'explosion';
    t: number;
};

type Crate = {
    x: number;
    y: number;
    opened: boolean;
};

type GroundItem = {
    id: string;
    x: number;
    y: number;
    weapon: WeaponType;
};

type Wall = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    direction: 'vertical' | 'horizontal';
    material: 'wood' | 'brick' | 'metal';
    health: number;
    maxHealth: number;
};

type Person = Player & {
    x: number;
    y: number;
    weapon: WeaponType;
    health: number;
    shield: number;
    inventory: WeaponType[];
    alive: boolean;
    killerId?: string;
    ammo: number;
    ammoReserve: Record<WeaponType, number>;
    reloading: boolean;
    reloadRemaining: number;
    materials: {
        wood: number;
        brick: number;
        metal: number;
    };
    team?: number;
};

// +messaggi
type GameMsg = {
    kind: "game";
    gameId: string;
    data: any;
};

type ServerInitMsg = {
    kind: "init";
    yourId: string;
    people: Record<string, Person>;
    gameProposal?: {
        gameKey: string;
        proposerId: string;
        proposalId: string;
        acceptedPlayerIds: string[];
    }
};

type ServerNameIsTakenMsg = {
    kind: "nameIsTaken";
};

type ServerUpdateMsg = {
    kind: "update";
    people: Record<string, Person>;
    lines: {x: number, y: number, direction: 'vertical' | 'horizontal'}[];
    crates: Crate[];
    groundItems: GroundItem[];
    walls: Wall[];
    bullets?: Bullet[];
    effects?: HitEffect[];
};

type ServerExitMsg = {
    kind: "exit";
    id: string;
};

type ServerGameProposalMsg = {
    kind: "gameProposal";
    gameKey: string;
    proposerId: string;
    proposalId: string;
};

type ServerGameProposalAcceptedMsg = {
    kind: "gameProposalAccepted";
    proposalId: string;
    accepterId: string;
};

type GameStartedMsg = {
    kind: "gameStarted";
    gameId: string;
    gameKey: string;
    players: Record<string, Player>;
};

type LobbyServerMsg =
    | ServerInitMsg
    | ServerNameIsTakenMsg
    | ServerUpdateMsg 
    | ServerExitMsg
    | ServerGameProposalMsg
    | ServerGameProposalAcceptedMsg
    | GameStartedMsg
    | GameMsg;

type ClientInitMsg = {
    kind: "init";
    name: string;
    character: string;
};

type ClientMoveMsg = {
    kind: "move";
    x: number;
    y: number;
};

type ClientGameProposalMsg = {
    kind: "gameProposal";
    gameKey: string;
};

type ClientGameProposalAcceptMsg = {
    kind: "gameProposalAccept";
    proposalId: string;
};

type ClientStartGameMsg = {
    kind: "startGame";
    proposalId: string;
};

type ClientAddLineMsg = {
    kind: "addLine";
    x: number;
    y: number;
    direction: 'vertical' | 'horizontal';
};

type ClientBuildWallMsg = {
    kind: "buildWall";
    x: number;
    y: number;
    direction: 'vertical' | 'horizontal';
    material: 'wood' | 'brick' | 'metal';
};

type ClientWallDamageMsg = {
    kind: "wallDamage";
    wallId: string;
    damage: number;
};

type ClientOpenCrateMsg = {
    kind: "openCrate";
    x: number;
    y: number;
};

type ClientDropItemMsg = {
    kind: "dropItem";
    slotIndex: number;
    x: number;
    y: number;
};

type ClientReorderInventoryMsg = {
    kind: "reorderInventory";
    fromIndex: number;
    toIndex: number;
};

type ClientPickUpItemMsg = {
    kind: "pickUpItem";
    id: string;
};

type ClientSwitchWeaponMsg = {
    kind: "switchWeapon";
    weapon: WeaponType;
};

type ClientShootMsg = {
    kind: "shoot";
    targetX: number;
    targetY: number;
    weapon: WeaponType;
};

type ClientUseConsumableMsg = {
    kind: "useConsumable";
    weapon: 'medkit' | 'shield';
};

type LobbyClientMsg = 
    | ClientInitMsg 
    | ClientMoveMsg
    | ClientGameProposalMsg
    | ClientGameProposalAcceptMsg
    | ClientStartGameMsg
    | ClientAddLineMsg
    | ClientBuildWallMsg
    | ClientWallDamageMsg
    | ClientOpenCrateMsg
    | ClientDropItemMsg
    | ClientReorderInventoryMsg
    | ClientPickUpItemMsg
    | ClientSwitchWeaponMsg
    | ClientShootMsg
    | ClientUseConsumableMsg
    | GameMsg;

// -messaggi

const EPSILON = 0.0001;

const worldW = 4000, worldH = 4000;
const worldBounds = {
    top: -worldH/2,
    left: -worldW/2,
    bottom: worldH/2,
    right: worldW/2,
};




//////////////////////
////// SERVER ////////
//////////////////////

export class FortniteServer extends GameServer {

    private players: Record<string, Person>;
    private bullets: Bullet[] = [];
    private lastShotTimestamps: Record<string, number> = {};
    private initialUpdatePending: boolean = false;
    private permanentLines: {x: number, y: number, direction: 'vertical' | 'horizontal'}[] = [];
    private crates: Crate[] = [];
    private groundItems: GroundItem[] = [];
    private walls: Wall[] = [];
    private hitEffects: HitEffect[] = [];
    private lastValidPositions: Record<string, { x: number; y: number }> = {};
    private gameEnded: boolean = false;

    private getSpawnPositions(count: number): { x: number; y: number }[] {
        const margin = 200;
        const spacing = 120;
        const centerX = (worldBounds.left + worldBounds.right) / 2;
        const centerY = (worldBounds.top + worldBounds.bottom) / 2;
        const topLeft = { x: worldBounds.left + margin, y: worldBounds.top + margin };
        const topRight = { x: worldBounds.right - margin, y: worldBounds.top + margin };
        const bottomLeft = { x: worldBounds.left + margin, y: worldBounds.bottom - margin };
        const bottomRight = { x: worldBounds.right - margin, y: worldBounds.bottom - margin };
        const center = { x: centerX, y: centerY };

        if (count <= 1) {
            return [center];
        }

        if (count === 2) {
            return [topLeft, bottomRight];
        }

        if (count === 3) {
            return [topLeft, topRight, bottomRight];
        }

        if (count === 4) {
            return [
                topLeft,
                { x: topLeft.x + spacing, y: topLeft.y },
                bottomRight,
                { x: bottomRight.x - spacing, y: bottomRight.y }
            ];
        }

        if (count === 5) {
            return [
                topLeft,
                { x: topLeft.x + spacing, y: topLeft.y },
                bottomRight,
                { x: bottomRight.x - spacing, y: bottomRight.y },
                center
            ];
        }

        if (count === 6) {
            return [
                topLeft,
                { x: topLeft.x + spacing, y: topLeft.y },
                { x: topLeft.x, y: topLeft.y + spacing },
                bottomRight,
                { x: bottomRight.x - spacing, y: bottomRight.y },
                { x: bottomRight.x, y: bottomRight.y - spacing }
            ];
        }

        if (count === 7) {
            return [
                topLeft,
                { x: topLeft.x + spacing, y: topLeft.y },
                { x: topLeft.x, y: topLeft.y + spacing },
                topRight,
                bottomLeft,
                bottomRight,
                { x: bottomRight.x - spacing, y: bottomRight.y }
            ];
        }

        if (count === 8) {
            return [
                topLeft,
                { x: topLeft.x + spacing, y: topLeft.y },
                bottomRight,
                { x: bottomRight.x - spacing, y: bottomRight.y },
                bottomLeft,
                { x: bottomLeft.x + spacing, y: bottomLeft.y },
                topRight,
                { x: topRight.x, y: topRight.y + spacing }
            ];
        }

        const positions = [topLeft, topRight, bottomLeft, bottomRight, center];
        const extraOffsets = [
            { xDir: 1, yDir: 1 },
            { xDir: -1, yDir: 1 },
            { xDir: 1, yDir: -1 },
            { xDir: -1, yDir: -1 }
        ];

        while (positions.length < count) {
            const layer = Math.floor((positions.length - 5) / 4) + 1;
            for (let cornerIndex = 0; cornerIndex < 4 && positions.length < count; cornerIndex++) {
                const corner = [topLeft, topRight, bottomLeft, bottomRight][cornerIndex];
                const offset = extraOffsets[cornerIndex];
                positions.push({
                    x: corner.x + offset.xDir * spacing * layer,
                    y: corner.y + offset.yDir * spacing * layer
                });
            }
        }

        return positions.slice(0, count);
    }

    init(players: Record<string, Player>) {
        console.log('[FortniteServer.init] players count:', Object.keys(players).length);
        console.log('[FortniteServer.init] player ids:', Object.keys(players));
        //const spawnPositions = this.getSpawnPositions(Object.keys(players).length);
        
        this.players = {};
        this.bullets = [];
        this.lastShotTimestamps = {};
        // Pistolina, pompa, cecchino, assalto, granata, piccone, scudo, medikit.
        this.initialUpdatePending = true;
        this.permanentLines = [];
        this.groundItems = [];
        this.walls = [];
        this.hitEffects = [];
        this.lastValidPositions = {};
        this.gameEnded = false;

        // Inizializza casse: 3 in centro alto, basso, sinistra e destra
        this.crates = [
            { x: -100, y: worldBounds.top + 150, opened: false },
            { x: 0, y: worldBounds.top + 150, opened: false },
            { x: 100, y: worldBounds.top + 150, opened: false },
            { x: -100, y: worldBounds.bottom - 150, opened: false },
            { x: 0, y: worldBounds.bottom - 150, opened: false },
            { x: 100, y: worldBounds.bottom - 150, opened: false },
            { x: worldBounds.left + 150, y: -100, opened: false },
            { x: worldBounds.left + 150, y: 0, opened: false },
            { x: worldBounds.left + 150, y: 100, opened: false },
            { x: worldBounds.right - 150, y: -100, opened: false },
            { x: worldBounds.right - 150, y: 0, opened: false },
            { x: worldBounds.right - 150, y: 100, opened: false }
        ];

        const playerIds = Object.keys(players).sort();
        const spawnPositions = this.getSpawnPositions(playerIds.length);
        playerIds.forEach((id, index) => {
            const player = players[id];
            const spawn = spawnPositions[index] || { x: 0, y: 0 };
            // determina squadra basata sugli angoli (same corner -> same team)
            const margin = 200;
            const centerX = (worldBounds.left + worldBounds.right) / 2;
            const centerY = (worldBounds.top + worldBounds.bottom) / 2;
            const corners = [
                { x: worldBounds.left + margin, y: worldBounds.top + margin },
                { x: worldBounds.right - margin, y: worldBounds.top + margin },
                { x: worldBounds.left + margin, y: worldBounds.bottom - margin },
                { x: worldBounds.right - margin, y: worldBounds.bottom - margin }
            ];
            let teamIndex: number | undefined = undefined;
            for (let ci = 0; ci < corners.length; ci++) {
                const c = corners[ci];
                if (Math.abs(c.x - spawn.x) < 1 && Math.abs(c.y - spawn.y) < 1) {
                    teamIndex = ci;
                    break;
                }
            }
            const defaultWeapon: WeaponType = 'pickaxe';
            const weaponDef = WEAPON_DEFINITIONS[defaultWeapon];
            this.players[id] = {
                ...player,
                x: spawn.x,
                y: spawn.y,
                team: teamIndex,
                weapon: defaultWeapon,
                health: 100,
                shield: 0,
                inventory: [],
                alive: true,
                killerId: undefined,
                ammo: weaponDef.magazine,
                ammoReserve: createEmptyAmmoReserve(),
                reloading: false,
                reloadRemaining: 0,
                materials: {
                    wood: 0,
                    brick: 0,
                    metal: 0
                }
            };
        });
        console.log('[FortniteServer.init] spawn positions:', spawnPositions);
    }

    private spawnGroundItems(weaponList: WeaponType[], x: number, y: number) {
        const radius = 120;
        weaponList.forEach((weapon, index) => {
            const angle = (Math.PI * 2 / weaponList.length) * index;
            const distance = 40 + Math.random() * 40;
            this.groundItems.push({
                id: `${weapon}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                x: x + Math.cos(angle) * distance,
                y: y + Math.sin(angle) * distance,
                weapon
            });
        });
    }

    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {
        const outgoingMessages: OutgoingMsg[] = [];
        const updatedPeople: Record<string, Person> = {};

        if (this.initialUpdatePending) {
            outgoingMessages.push({
                payload: {
                    kind: "update",
                    people: this.players,
                    lines: this.permanentLines,
                    crates: this.crates,
                    groundItems: this.groundItems,
                    walls: this.walls,
                    bullets: this.bullets,
                    effects: this.hitEffects
                }
            });
            this.initialUpdatePending = false;
        }

        // Gestisci i messaggi in arrivo
        incomingMessages.forEach(message => {
            const clientId = message.clientId;
            const payload = message.payload;
            const player = this.players[clientId];

            if (payload.kind === "move") {
                if (player && player.alive) {
                    let newX = payload.x;
                    let newY = payload.y;

                    // controlla collisioni con linee permanenti usando AABB
                    for (let line of this.permanentLines) {
                        const personLeft = newX - PERSON_W / 2;
                        const personRight = newX + PERSON_W / 2;
                        const personTop = newY - PERSON_H / 2;
                        const personBottom = newY + PERSON_H / 2;

                        if (line.direction === 'vertical') {
                            const lineLeft = line.x - 5;
                            const lineRight = line.x + 5;
                            const lineTop = line.y;
                            const lineBottom = line.y + 200;
                            if (personLeft < lineRight && personRight > lineLeft &&
                                personTop < lineBottom && personBottom > lineTop) {
                                newX = player.x;
                            }
                        } else if (line.direction === 'horizontal') {
                            const lineLeft = line.x;
                            const lineRight = line.x + 200;
                            const lineTop = line.y - 5;
                            const lineBottom = line.y + 5;
                            if (personLeft < lineRight && personRight > lineLeft &&
                                personTop < lineBottom && personBottom > lineTop) {
                                newY = player.y;
                            }
                        }
                    }

                    // gestisci collisione con i muri utilizzando una hitbox espansa (min 20px)
                    const isCollidingWall = (x: number, y: number) => {
                        const pLeft = x - PERSON_W / 2;
                        const pRight = x + PERSON_W / 2;
                        const pTop = y - PERSON_H / 2;
                        const pBottom = y + PERSON_H / 2;
                        for (let wall of this.walls) {
                            const halfW = Math.max(wall.width / 2, 20);
                            const halfH = Math.max(wall.height / 2, 20);
                            const wLeft = wall.x - halfW;
                            const wRight = wall.x + halfW;
                            const wTop = wall.y - halfH;
                            const wBottom = wall.y + halfH;
                            if (pLeft < wRight && pRight > wLeft && pTop < wBottom && pBottom > wTop) return true;
                        }
                        return false;
                    };

                    // risolvi per assi: prova X separatamente poi Y
                    let attemptX = newX;
                    let attemptY = player.y;
                    if (isCollidingWall(attemptX, attemptY)) attemptX = player.x;
                    attemptY = newY;
                    if (isCollidingWall(attemptX, attemptY)) attemptY = player.y;

                    newX = attemptX;
                    newY = attemptY;

                    // se ancora in collisione porta indietro alla ultima posizione valida
                    if (isCollidingWall(newX, newY)) {
                        const last = this.lastValidPositions[clientId];
                        if (last) {
                            newX = last.x;
                            newY = last.y;
                        } else {
                            newX = player.x;
                            newY = player.y;
                        }
                    } else {
                        // aggiorna ultima posizione valida
                        this.lastValidPositions[clientId] = { x: newX, y: newY };
                    }

                    player.x = newX;
                    player.y = newY;
                    updatedPeople[clientId] = player;
                }
            }

            if (payload.kind === "addLine") {
                this.permanentLines.push({x: payload.x, y: payload.y, direction: payload.direction});
            }

            if (payload.kind === "buildWall") {
                if (player && player.alive) {
                    const material = payload.material as 'wood' | 'brick' | 'metal';
                    const direction = payload.direction as 'vertical' | 'horizontal';
                    const materialCost: Record<string, number> = { 'wood': 10, 'brick': 15, 'metal': 20 };
                    const cost = materialCost[material];

                    // Controlla se il giocatore ha abbastanza materiali del tipo richiesto
                    if (player.materials[material] >= cost) {
                        player.materials[material] -= cost;

                        const maxHealthByMaterial = { 'wood': 100, 'brick': 250, 'metal': 500 };
                        const maxHealth = maxHealthByMaterial[material];

                        const newWall: Wall = {
                            id: `wall-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                            x: payload.x,
                            y: payload.y,
                            direction,
                            width: direction === 'vertical' ? 10 : 200,
                            height: direction === 'vertical' ? 200 : 10,
                            material,
                            health: maxHealth,
                            maxHealth
                        };

                        this.walls.push(newWall);
                        updatedPeople[clientId] = player;
                    }
                }
            }

            if (payload.kind === "wallDamage") {
                const wall = this.walls.find(w => w.id === (payload as any).wallId);
                if (wall) {
                    const dmg = (payload as any).damage || 0;
                    wall.health = Math.max(0, wall.health - dmg);
                    if (wall.health <= 0) {
                        this.walls = this.walls.filter(w => w.id !== wall.id);
                    }
                }
            }

            if (payload.kind === "openCrate") {
                if (player && player.alive) {
                    const crate = this.crates.find(c => c.x === payload.x && c.y === payload.y && !c.opened);
                    if (crate) {
                        const dist = Math.sqrt((player.x - crate.x) ** 2 + (player.y - crate.y) ** 2);
                        if (dist < 100) {
                            crate.opened = true;
                            const weapons = ['pistol', 'pump', 'sniper', 'assault', 'grenade'] as WeaponType[];
                            const randomWeapons = weapons.sort(() => 0.5 - Math.random()).slice(0, 2);
                            const generatedItems: WeaponType[] = [...randomWeapons];
                            
                            // Aggiungi medikit o scudo con probabilità (50% niente, 25% medikit, 25% scudo)
                            const utilityRoll = Math.random();
                            if (utilityRoll < 0.25) {
                                generatedItems.push('medkit');
                            } else if (utilityRoll < 0.5) {
                                generatedItems.push('shield');
                            }
                            // Se utilityRoll >= 0.5, non aggiungiamo niente

                            // Tutti gli oggetti vanno a terra
                            this.spawnGroundItems(generatedItems, crate.x, crate.y);

                            const ammoTypes = AMMO_WEAPON_TYPES.sort(() => 0.5 - Math.random()).slice(0, 2);
                            ammoTypes.forEach(ammoType => {
                                const dropAmount = getRandomAmmoDrop(ammoType);
                                player.ammoReserve[ammoType] = (player.ammoReserve[ammoType] || 0) + dropAmount;
                            });

                            // Genera materiali (50-150 in multipli di 5, tipo casuale)
                            const materialAmount = Math.floor(Math.random() * 21) * 5 + 50; // da 50 a 150
                            const materialTypes = ['wood', 'brick', 'metal'] as const;
                            const randomMaterial = materialTypes[Math.floor(Math.random() * materialTypes.length)];
                            player.materials[randomMaterial] = (player.materials[randomMaterial] || 0) + materialAmount;

                            updatedPeople[clientId] = player;
                        }
                    }
                }
            }

            if (payload.kind === "dropItem") {
                if (player && player.alive) {
                    const item = player.inventory[payload.slotIndex];
                    if (item) {
                        player.inventory.splice(payload.slotIndex, 1);
                        this.groundItems.push({
                            id: `${item}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                            x: payload.x,
                            y: payload.y,
                            weapon: item
                        });
                        updatedPeople[clientId] = player;
                    }
                }
            }

            if (payload.kind === "reorderInventory") {
                if (player && player.alive) {
                    const item = player.inventory.splice(payload.fromIndex, 1)[0];
                    if (item) {
                        player.inventory.splice(payload.toIndex, 0, item);
                        updatedPeople[clientId] = player;
                    }
                }
            }

            if (payload.kind === "pickUpItem") {
                if (player && player.alive) {
                    const item = this.groundItems.find(i => i.id === payload.id);
                    if (item) {
                        const dist = Math.sqrt((player.x - item.x) ** 2 + (player.y - item.y) ** 2);
                        if (dist < 100 && player.inventory.length < 5) {
                            player.inventory.push(item.weapon);
                            this.groundItems = this.groundItems.filter(i => i.id !== payload.id);
                            updatedPeople[clientId] = player;
                        }
                    }
                }
            }

            if (payload.kind === "switchWeapon") {
                if (player && player.alive) {
                    const weapon = payload.weapon as WeaponType;
                    if (player.weapon !== weapon) {
                        player.weapon = weapon;
                        if (player.reloading) {
                            player.reloading = false;
                            player.reloadRemaining = 0;
                        }
                        updatedPeople[clientId] = player;
                    }
                }
            }

            if (payload.kind === "useItem") {
                if (player && player.alive) {
                    const weapon = payload.weapon as WeaponType;
                    if (weapon === 'medkit') {
                        // Rimuovi dall'inventario
                        const idx = player.inventory.indexOf('medkit');
                        if (idx !== -1) {
                            player.inventory.splice(idx, 1);
                            player.health = Math.min(100, player.health + 50);
                            updatedPeople[clientId] = player;
                        }
                    } else if (weapon === 'shield') {
                        const idx = player.inventory.indexOf('shield');
                        if (idx !== -1) {
                            player.inventory.splice(idx, 1);
                            player.shield = Math.min(100, player.shield + 50);
                            updatedPeople[clientId] = player;
                        }
                    }
                }
            }

            if (payload.kind === "useConsumable") {
                if (player && player.alive && (player.weapon === 'medkit' || player.weapon === 'shield')) {
                    const weapon = payload.weapon as 'medkit' | 'shield';
                    if (weapon === 'medkit') {
                        player.health = Math.min(100, player.health + 50);
                    } else if (weapon === 'shield') {
                        player.shield = Math.min(100, player.shield + 50);
                    }
                    player.inventory = player.inventory.filter(w => w !== weapon);
                    player.weapon = 'pickaxe';
                    updatedPeople[clientId] = player;
                }
            }

            if (payload.kind === "shoot") {
                if (player && player.alive) {
                    const weapon = payload.weapon as WeaponType;
                    const weaponDef = WEAPON_DEFINITIONS[weapon];
                    const weaponChanged = player.weapon !== weapon;
                    player.weapon = weapon;
                    if (weaponChanged && player.reloading) {
                        player.reloading = false;
                        player.reloadRemaining = 0;
                        updatedPeople[clientId] = player;
                    }
                    const now = Date.now();
                    const lastShot = this.lastShotTimestamps[clientId] || 0;
                    const reserveAmmo = player.ammoReserve[weapon] || 0;

                    if (weaponDef.magazine > 0) {
                        if (player.reloading) {
                            // currently reloading, ignore the shot
                        } else if (player.ammo <= 0) {
                            if (reserveAmmo > 0) {
                                player.reloading = true;
                                player.reloadRemaining = weaponDef.reloadTime;
                                updatedPeople[clientId] = player;
                            }
                        } else if (now - lastShot >= weaponDef.cooldown * 1000) {
                            this.lastShotTimestamps[clientId] = now;
                            player.ammo -= 1;
                            if (player.ammo <= 0 && reserveAmmo > 0) {
                                player.reloading = true;
                                player.reloadRemaining = weaponDef.reloadTime;
                            }
                            updatedPeople[clientId] = player;
                            const dx = payload.targetX - player.x;
                            const dy = payload.targetY - player.y;
                            const baseAngle = Math.atan2(dy, dx);

                            const addBullet = (angle: number, range: number, speed: number, damage: number, width: number, height: number, explosive = false) => {
                                this.bullets.push({
                                    id: `${weapon}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                                    x: player.x,
                                    y: player.y,
                                    vx: Math.cos(angle) * speed,
                                    vy: Math.sin(angle) * speed,
                                    speed,
                                    remainingRange: range,
                                    weapon,
                                    ownerId: clientId,
                                    damage,
                                    width,
                                    height,
                                    angle,
                                    color: weaponDef.color,
                                    explosive
                                });
                            };

                            if (weapon === 'pump') {
                                for (let i = 0; i < weaponDef.pellets; i++) {
                                    const spreadAngle = (Math.random() - 0.5) * weaponDef.spreadAngle;
                                    addBullet(baseAngle + spreadAngle, weaponDef.range, weaponDef.speed, weaponDef.damage, 7, 3);
                                }
                            } else if (weapon === 'grenade') {
                                addBullet(baseAngle, weaponDef.range, weaponDef.speed, weaponDef.damage, 14, 14, true);
                            } else if (weapon === 'pickaxe') {
                                const hitRange = weaponDef.range;
                                Object.entries(this.players).forEach(([targetId, target]) => {
                                    if (targetId === clientId || !target.alive) return;
                                    const dist = Math.sqrt((target.x - player.x) ** 2 + (target.y - player.y) ** 2);
                                    if (dist < hitRange) {
                                        const effectiveDamage = weaponDef.damage;
                                        const shieldHit = Math.min(target.shield, effectiveDamage);
                                        target.shield = Math.max(0, target.shield - effectiveDamage);
                                        const left = effectiveDamage - shieldHit;
                                        target.health = Math.max(0, target.health - left);
                                        if (target.health <= 0) {
                                            target.alive = false;
                                            target.killerId = clientId;
                                        }
                                        updatedPeople[targetId] = target;
                                        this.hitEffects.push({ x: target.x, y: target.y, type: 'hit', t: 0 });
                                    }
                                });
                                // Pickaxe can also damage nearby walls
                                Object.values(this.walls).forEach(wall => {
                                    const playerLeft = player.x - hitRange;
                                    const playerRight = player.x + hitRange;
                                    const playerTop = player.y - hitRange;
                                    const playerBottom = player.y + hitRange;
                                    
                                    const wallLeft = wall.x - wall.width / 2;
                                    const wallRight = wall.x + wall.width / 2;
                                    const wallTop = wall.y - wall.height / 2;
                                    const wallBottom = wall.y + wall.height / 2;
                                    
                                    if (playerLeft < wallRight && playerRight > wallLeft &&
                                        playerTop < wallBottom && playerBottom > wallTop) {
                                        wall.health = Math.max(0, wall.health - weaponDef.damage);
                                        this.hitEffects.push({ x: wall.x, y: wall.y, type: 'hit', t: 0 });
                                    }
                                });
                            } else {
                                addBullet(baseAngle, weaponDef.range, weaponDef.speed, weaponDef.damage, 7, 3);
                            }
                        }
                    } else if (weapon === 'pickaxe') {
                        if (now - lastShot >= weaponDef.cooldown * 1000) {
                            this.lastShotTimestamps[clientId] = now;
                            const hitRange = weaponDef.range;
                            Object.entries(this.players).forEach(([targetId, target]) => {
                                if (targetId === clientId || !target.alive) return;
                                const dist = Math.sqrt((target.x - player.x) ** 2 + (target.y - player.y) ** 2);
                                if (dist < hitRange) {
                                    const effectiveDamage = weaponDef.damage;
                                    const shieldHit = Math.min(target.shield, effectiveDamage);
                                    target.shield = Math.max(0, target.shield - effectiveDamage);
                                    const left = effectiveDamage - shieldHit;
                                    target.health = Math.max(0, target.health - left);
                                    if (target.health <= 0) {
                                        target.alive = false;
                                        target.killerId = clientId;
                                    }
                                    updatedPeople[targetId] = target;
                                    this.hitEffects.push({ x: target.x, y: target.y, type: 'hit', t: 0 });
                                }
                            });
                            // Also damage nearby walls from pickaxe
                            Object.values(this.walls).forEach(wall => {
                                const playerLeft = player.x - hitRange;
                                const playerRight = player.x + hitRange;
                                const playerTop = player.y - hitRange;
                                const playerBottom = player.y + hitRange;
                                
                                const wallLeft = wall.x - wall.width / 2;
                                const wallRight = wall.x + wall.width / 2;
                                const wallTop = wall.y - wall.height / 2;
                                const wallBottom = wall.y + wall.height / 2;
                                
                                if (playerLeft < wallRight && playerRight > wallLeft &&
                                    playerTop < wallBottom && playerBottom > wallTop) {
                                    wall.health = Math.max(0, wall.health - weaponDef.damage);
                                    this.hitEffects.push({ x: wall.x, y: wall.y, type: 'hit', t: 0 });
                                }
                            });
                        }
                    }
                }
            }
        });

        // Aggiorna le munizioni attive e gli effetti visivi
        this.bullets.forEach(bullet => {
            const prevBulletX = bullet.x;
            const prevBulletY = bullet.y;
            bullet.x += bullet.vx * dt;
            bullet.y += bullet.vy * dt;
            bullet.remainingRange -= bullet.speed * dt;

            const owner = this.players[bullet.ownerId];
            if (bullet.explosive && bullet.remainingRange <= 0) {
                this.hitEffects.push({ x: bullet.x, y: bullet.y, type: 'explosion', t: 0 });
                Object.entries(this.players).forEach(([targetId, target]) => {
                    if (targetId === bullet.ownerId || !target.alive) return;
                    const dist = Math.sqrt((target.x - bullet.x) ** 2 + (target.y - bullet.y) ** 2);
                    if (dist < 140) {
                        const effectiveDamage = Math.round(bullet.damage * (1 - dist / 140));
                        const shieldHit = Math.min(target.shield, effectiveDamage);
                        target.shield = Math.max(0, target.shield - effectiveDamage);
                        const left = effectiveDamage - shieldHit;
                        target.health = Math.max(0, target.health - left);
                        if (target.health <= 0) {
                            target.alive = false;
                            target.killerId = bullet.ownerId;
                        }
                        updatedPeople[targetId] = target;
                    }
                });
                bullet.remainingRange = -1;
            }

            Object.entries(this.players).forEach(([targetId, target]) => {
                if (targetId === bullet.ownerId || !target.alive) return;
                if (bullet.remainingRange <= 0) return;
                const dx = Math.abs(target.x - bullet.x);
                const dy = Math.abs(target.y - bullet.y);
                if (dx < PERSON_W / 2 && dy < PERSON_H / 2) {
                    const effectiveDamage = bullet.damage;
                    const shieldHit = Math.min(target.shield, effectiveDamage);
                    target.shield = Math.max(0, target.shield - effectiveDamage);
                    const left = effectiveDamage - shieldHit;
                    target.health = Math.max(0, target.health - left);
                    if (target.health <= 0) {
                        target.alive = false;
                        target.killerId = bullet.ownerId;
                    }
                    updatedPeople[targetId] = target;
                    this.hitEffects.push({ x: bullet.x, y: bullet.y, type: 'hit', t: 0 });
                    bullet.remainingRange = -1;
                }
            });

            // Check collision with walls using swept collision detection
            if (bullet.remainingRange > 0) {
                for (let wIndex = 0; wIndex < this.walls.length; wIndex++) {
                    const wall = this.walls[wIndex];
                    const hitboxHalfWidth = Math.max(wall.width / 2, 20);
                    const hitboxHalfHeight = Math.max(wall.height / 2, 20);
                    if (Math.abs(bullet.x - wall.x) < hitboxHalfWidth && Math.abs(bullet.y - wall.y) < hitboxHalfHeight) {
                        // bullet hits the wall
                        wall.health = Math.max(0, wall.health - bullet.damage);
                        this.hitEffects.push({ x: bullet.x, y: bullet.y, type: 'hit', t: 0 });
                        bullet.remainingRange = -1;
                        if (wall.health <= 0) {
                            this.walls.splice(wIndex, 1);
                        }
                        break;
                    }
                }
            }
        });

        this.bullets = this.bullets.filter(bullet => bullet.remainingRange > 0);
        this.hitEffects.forEach(effect => effect.t += dt);
        this.hitEffects = this.hitEffects.filter(effect => effect.t < 0.4);

        Object.entries(this.players).forEach(([playerId, player]) => {
            if (player.reloading) {
                player.reloadRemaining -= dt;
                if (player.reloadRemaining <= 0) {
                    const weaponDef = WEAPON_DEFINITIONS[player.weapon];
                    const reserveAmmo = player.ammoReserve[player.weapon] || 0;
                    const reloadAmount = Math.min(weaponDef.magazine, reserveAmmo);
                    player.reloading = false;
                    player.reloadRemaining = 0;
                    player.ammo = reloadAmount;
                    player.ammoReserve[player.weapon] = Math.max(0, reserveAmmo - reloadAmount);
                    updatedPeople[playerId] = player;
                }
            }
        });

        if (Object.keys(updatedPeople).length > 0 || this.bullets.length > 0 || this.hitEffects.length > 0) {
            outgoingMessages.push({
                payload: {
                    kind: "update",
                    people: updatedPeople,
                    lines: this.permanentLines,
                    crates: this.crates,
                    groundItems: this.groundItems,
                    walls: this.walls,
                    bullets: this.bullets,
                    effects: this.hitEffects
                }
            });
        }

        // Verifica vittoria a squadre e invia messaggio di fine partita se applicabile
        if (!this.gameEnded) {
            const aliveTeams = new Map<string, string[]>();
            Object.entries(this.players).forEach(([id, p]) => {
                if (!p.alive) return;
                const key = p.team !== undefined ? `team:${p.team}` : `solo:${id}`;
                const arr = aliveTeams.get(key) || [];
                arr.push(id);
                aliveTeams.set(key, arr);
            });

            if (aliveTeams.size === 1 && Object.keys(this.players).length > 0) {
                const entries = Array.from(aliveTeams.entries());
                const [teamKey, members] = entries[0];
                const winnerId = members[0];
                const winnerName = this.players[winnerId].name;
                this.gameEnded = true;
                outgoingMessages.push({
                    payload: {
                        kind: 'teamVictory',
                        team: teamKey,
                        winnerId,
                        winnerName
                    }
                });
            }
        }

        return outgoingMessages;
    }

    isFinished(): boolean {
        return false;
    }   
}






//////////////////////
////// CLIENT ////////
//////////////////////


import { UserInput } from '../../client/user-input';

type ClientPerson = Person;

import { getCharacterDrawFunction } from '../../client/characters';

type ClientPersonExtended = ClientPerson & {
    xTarget: number;
    yTarget: number;
    weapon: WeaponType;
    health: number;
    shield: number;
    alive: boolean;
    ammo: number;
    ammoReserve: Record<WeaponType, number>;
    reloading: boolean;
    reloadRemaining: number;
};

export class FortniteClient extends GameClient {

    public people: Record<string, ClientPersonExtended>;
    public camera: { x: number, y: number, zoom: number };
    public gamesBtn: Button;
    private buildingMode: boolean = false;
    private permanentLines: {x: number, y: number, direction: 'vertical' | 'horizontal'}[] = [];
    private pendingMessages: any[] = [];
    private weaponSprites: Partial<Record<WeaponType, HTMLCanvasElement>> = {};
    private crates: Crate[] = [];
    private groundItems: GroundItem[] = [];
    private walls: Wall[] = [];
    private bullets: Bullet[] = [];
    private hitEffects: HitEffect[] = [];
    private currentSlot: number = 0; // 0-4 inventory, 5 pickaxe
    private inventoryMenuOpen: boolean = false;
    private draggingSlotIndex: number | null = null;
    private dragStartX: number = 0;
    private dragStartY: number = 0;
    private lastMouseLeftPressed: boolean = false;
    private dragWeapon: WeaponType | null = null;
    private lastShotTime: number = 0;
    private buildingModeActive: boolean = false;
    private buildingMaterialIndex: number = 0;
    private ePressed: boolean = false;
    private iPressed: boolean = false;
    private itemUseStartTime: number | null = null;
    private itemUseWeapon: WeaponType | null = null;
    private watchedKillerId: string | null = null;
    private readonly ITEM_USE_DURATION = 10000; // 10 secondi in ms
    private hasReceivedFirstUpdate: boolean = false;
    private lastValidX: number = 0;
    private lastValidY: number = 0;
    private victoryTeam: string | null = null;
    private victoryName: string | null = null;

    constructor(userInput: UserInput, myId: string) {
        super(userInput, myId);
        this.people = {};
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.gamesBtn = new Button('Games', userInput, () => {});

        document.addEventListener("keydown", (event) => {
            if (event.repeat) return;

            if (event.code == "KeyE") this.ePressed = true;
            else if (event.code == "KeyI") {
                event.preventDefault();
                this.iPressed = !this.iPressed;
            } else if (event.code == "KeyQ") this.buildingModeActive = !this.buildingModeActive;
        });
        document.addEventListener("keyup", (event) => {
            if (event.code == "KeyE") this.ePressed = false;
        });

        window.addEventListener('wheel', (event) => {
            event.preventDefault();

            if (this.buildingModeActive) {
                const materialsCount = 3;
                if (event.deltaY > 0) {
                    this.buildingMaterialIndex = (this.buildingMaterialIndex + 1) % materialsCount;
                } else {
                    this.buildingMaterialIndex = (this.buildingMaterialIndex - 1 + materialsCount) % materialsCount;
                }
            } else {
                // Cambia slot con la rotella
                if (event.deltaY > 0) {
                    this.currentSlot = (this.currentSlot + 1) % 6;
                } else {
                    this.currentSlot = (this.currentSlot - 1 + 6) % 6;
                }
            }
        }, { passive: false });
    }

    private getSpawnPositions(count: number): { x: number; y: number }[] {
        const margin = 200;
        const spacing = 150;
        const centerX = (worldBounds.left + worldBounds.right) / 2;
        const centerY = (worldBounds.top + worldBounds.bottom) / 2;
        const center = { x: centerX, y: centerY };

        const corners = [
            { x: worldBounds.left + margin, y: worldBounds.top + margin },
            { x: worldBounds.right - margin, y: worldBounds.top + margin },
            { x: worldBounds.left + margin, y: worldBounds.bottom - margin },
            { x: worldBounds.right - margin, y: worldBounds.bottom - margin }
        ];

        const edgeCenters = [
            { x: centerX, y: worldBounds.top + margin },
            { x: centerX, y: worldBounds.bottom - margin },
            { x: worldBounds.left + margin, y: centerY },
            { x: worldBounds.right - margin, y: centerY }
        ];

        if (count <= 1) {
            return [center];
        }
        if (count === 2) {
            return [corners[0], corners[3]];
        }
        if (count === 3) {
            return [corners[0], corners[1], corners[2]];
        }
        if (count === 4) {
            return [...corners];
        }
        if (count === 5) {
            return [...corners, center];
        }
        if (count === 6) {
            return [...corners, edgeCenters[0], edgeCenters[1]];
        }
        if (count === 7) {
            return [...corners, edgeCenters[0], edgeCenters[1], edgeCenters[2]];
        }
        if (count === 8) {
            return [...corners, ...edgeCenters];
        }

        const positions = [...corners, ...edgeCenters, center];
        const extraOffsets = [
            { xDir: 1, yDir: 1 },
            { xDir: -1, yDir: 1 },
            { xDir: 1, yDir: -1 },
            { xDir: -1, yDir: -1 }
        ];

        while (positions.length < count) {
            const layer = Math.floor((positions.length - 9) / 4) + 1;
            for (let cornerIndex = 0; cornerIndex < 4 && positions.length < count; cornerIndex++) {
                const corner = corners[cornerIndex];
                const offset = extraOffsets[cornerIndex];
                positions.push({
                    x: corner.x + offset.xDir * spacing * layer,
                    y: corner.y + offset.yDir * spacing * layer
                });
            }
        }

        return positions.slice(0, count);
    }

    async init(players: Record<string, Player>) {
        this.hasReceivedFirstUpdate = false;
        this.watchedKillerId = null;
        await this.loadWeaponAssets();

        const playerIds = Object.keys(players).sort();
        const spawnPositions = this.getSpawnPositions(playerIds.length);

        playerIds.forEach((id, index) => {
            const player = players[id];
            const initialWeapon: WeaponType = 'pickaxe';
            const spawn = spawnPositions[index] || { x: 0, y: 0 };
            const initialX = (player as any).x ?? spawn.x;
            const initialY = (player as any).y ?? spawn.y;
            const clientPerson: ClientPersonExtended = {
                ...player,
                x: initialX,
                y: initialY,
                xTarget: initialX,
                yTarget: initialY,
                weapon: initialWeapon,
                health: 100,
                shield: 0,
                inventory: [],
                alive: true,
                ammo: WEAPON_DEFINITIONS[initialWeapon].magazine,
                ammoReserve: createEmptyAmmoReserve(),
                reloading: false,
                reloadRemaining: 0,
                materials: {
                    wood: 0,
                    brick: 0,
                    metal: 0
                }
            };
            this.people[id] = clientPerson;
            if (id === this.myId) {
                this.lastValidX = initialX;
                this.lastValidY = initialY;
            }
        });
        return Promise.resolve();
    }

    private async loadWeaponAssets() {
        const assetFolder = 'assets/fortnite';
        await Promise.all(Object.entries(WEAPON_IMAGE_FILES).map(async ([weapon, file]) => {
            const key = weapon as WeaponType;
            try {
                await this.assets.loadImage(key, `${assetFolder}/${file}`);
                const img = this.assets.images[key];
                if (img) {
                    this.weaponSprites[key] = this.createTransparentSprite(img);
                }
            } catch {
                // immagine non trovata, usiamo il fallback grafico
            }
        }));
    }

    private createTransparentSprite(image: HTMLImageElement): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;
        ctx.drawImage(image, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) {
                data[i + 3] = 0;
            }
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    private getWeaponRenderSize(weapon: WeaponType): number {
        switch (weapon) {
            case 'grenade':
                return 40;
            case 'shield':
                return 40;
            case 'medkit':
                return 70;
            default:
                return 100;
        }
    }

    private drawWeapon(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, weapon: WeaponType, size?: number) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);

        let scale = 1;
        const sprite = this.weaponSprites[weapon];
        if (sprite) {
            if (size) {
                scale = size / Math.max(sprite.width, sprite.height);
                ctx.scale(scale, scale);
            }
            ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
            ctx.restore();
            return;
        }

        if (size) {
            const baseSize = weapon === 'grenade' ? 24 : weapon === 'shield' ? 40 : weapon === 'medkit' ? 30 : 70;
            scale = size / baseSize;
            ctx.scale(scale, scale);
        }
        
        switch(weapon) {
            case 'pistol':
                ctx.fillStyle = "#000";
                ctx.fillRect(-15, -7.5, 50, 12);
                ctx.fillRect(-15, -7.5, 70, 8);
                break;
            case 'pump':
                ctx.fillStyle = "#444";
                ctx.fillRect(-15, -10, 50, 15);
                ctx.fillRect(20, -8, 25, 11);
                break;
            case 'sniper':
                ctx.fillStyle = "#333";
                ctx.fillRect(-15, -5, 70, 10);
                ctx.fillRect(35, -8, 15, 16);
                break;
            case 'assault':
                ctx.fillStyle = "#222";
                ctx.fillRect(-15, -9, 55, 14);
                ctx.fillRect(25, -12, 18, 20);
                break;
            case 'grenade':
                ctx.fillStyle = "#0f0";
                ctx.beginPath();
                ctx.arc(20, 0, 12, 0, Math.PI * 2);
                ctx.fill();
                break;
            case 'pickaxe':
                ctx.fillStyle = "#8B4513";
                ctx.fillRect(-15, -8, 40, 16);
                ctx.fillStyle = "#FFD700";
                ctx.fillRect(15, -15, 7, 30);
                ctx.fillStyle = "#FFD700";
                ctx.fillRect(20, -25, 10, 10);
                ctx.fillStyle = "#FFD700";
                ctx.fillRect(10, -5, 10, 10);
                break;
            case 'shield':
                ctx.fillStyle = "#0088ff";
                ctx.beginPath();
                ctx.rect(-20, -20, 40, 40);
                ctx.fill();
                ctx.strokeStyle = "#fff";
                ctx.lineWidth = 2;
                ctx.stroke();
                break;
            case 'medkit':
                ctx.fillStyle = "#ff0000";
                ctx.fillRect(-15, -15, 30, 30);
                ctx.fillStyle = "#fff";
                ctx.fillRect(-5, -12, 10, 4);
                ctx.fillRect(-12, -5, 4, 10);
                break;

        }
        
        ctx.restore();
    }

    private drawBullet(ctx: CanvasRenderingContext2D, bullet: Bullet) {
        ctx.save();
        ctx.translate(bullet.x, bullet.y);
        ctx.rotate(bullet.angle);
        ctx.fillStyle = '#ffea00';
        ctx.shadowColor = '#ffea00';
        ctx.shadowBlur = 8;
        if (bullet.weapon === 'grenade') {
            ctx.beginPath();
            ctx.arc(0, 0, Math.max(bullet.width, bullet.height), 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillRect(-bullet.width / 2, -bullet.height / 2, bullet.width, bullet.height);
        }
        ctx.restore();
    }

    private drawHitEffect(ctx: CanvasRenderingContext2D, effect: HitEffect) {
        const progress = effect.t / 0.4;
        ctx.save();
        if (effect.type === 'muzzle') {
            ctx.strokeStyle = `rgba(255,255,220,${1 - progress})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(effect.x, effect.y, 15 + progress * 10, 0, Math.PI * 2);
            ctx.stroke();
        } else if (effect.type === 'hit') {
            ctx.strokeStyle = `rgba(255,80,80,${1 - progress})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(effect.x, effect.y, 20 + progress * 15, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.strokeStyle = `rgba(255,255,255,${1 - progress})`;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(effect.x, effect.y, 30 + progress * 25, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }

    private drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 18, y);
        ctx.lineTo(x - 6, y);
        ctx.moveTo(x + 6, y);
        ctx.lineTo(x + 18, y);
        ctx.moveTo(x, y - 18);
        ctx.lineTo(x, y - 6);
        ctx.moveTo(x, y + 6);
        ctx.lineTo(x, y + 18);
        ctx.stroke();
        ctx.restore();
    }

    // disegna la lobby (spazio di gioco, personaggi, ecc)
    private drawLobby(ctx: CanvasRenderingContext2D, me: ClientPersonExtended, dt: number) {
            const {
                screenW, screenH, zoom,
                moveDirectionX, moveDirectionY, mouseX, mouseY
            } = this.userInput;
    
            this.buildingMode = this.buildingModeActive;
            this.inventoryMenuOpen = this.iPressed;
            const mouseLeft = this.userInput.isMouseLeftPressed;
            const justPressed = mouseLeft && !this.lastMouseLeftPressed;
            const justReleased = !mouseLeft && this.lastMouseLeftPressed;
            const slotMenuX = 20;
            const slotMenuY = 20;
            const slotMenuW = 220;
            const slotMenuH = 340;
            const menuSlotSize = 50;
            const menuSlotSpacing = 10;
            const slotAreaY = slotMenuY + 40;

            const getSlotIndexAtPosition = (mx: number, my: number) => {
                if (mx < slotMenuX + 10 || mx > slotMenuX + 10 + menuSlotSize || my < slotAreaY || my > slotAreaY + 5 * (menuSlotSize + menuSlotSpacing) - menuSlotSpacing) {
                    return -1;
                }
                const index = Math.floor((my - slotAreaY) / (menuSlotSize + menuSlotSpacing));
                return index >= 0 && index < 5 ? index : -1;
            };

            if (justPressed && this.inventoryMenuOpen) {
                const clickedSlot = getSlotIndexAtPosition(mouseX, mouseY);
                if (clickedSlot >= 0) {
                    const weapon = me.inventory[clickedSlot];
                    if (weapon) {
                        this.draggingSlotIndex = clickedSlot;
                        this.dragStartX = mouseX;
                        this.dragStartY = mouseY;
                        this.dragWeapon = weapon;
                    }
                }
            }

            if (this.draggingSlotIndex !== null && justReleased) {
                const mouseInMenu = mouseX >= slotMenuX && mouseX <= slotMenuX + slotMenuW && mouseY >= slotMenuY && mouseY <= slotMenuY + slotMenuH;
                const releaseSlot = getSlotIndexAtPosition(mouseX, mouseY);
                if (mouseInMenu && releaseSlot >= 0) {
                    if (releaseSlot !== this.draggingSlotIndex) {
                        this.sendMessage({kind: "reorderInventory", fromIndex: this.draggingSlotIndex, toIndex: releaseSlot});
                    }
                } else {
                    const mouseCenterX = mouseX - screenW / 2;
                    const mouseCenterY = mouseY - screenH / 2;
                    const dropX = me.x + mouseCenterX / this.camera.zoom;
                    const dropY = me.y + mouseCenterY / this.camera.zoom;
                    this.sendMessage({kind: "dropItem", slotIndex: this.draggingSlotIndex, x: dropX, y: dropY});
                    me.inventory.splice(this.draggingSlotIndex, 1);
                }
                this.draggingSlotIndex = null;
                this.dragWeapon = null;
            }

            this.lastMouseLeftPressed = mouseLeft;

            if (!me.alive) {
                this.inventoryMenuOpen = false;
                this.buildingMode = false;
                this.draggingSlotIndex = null;
                this.dragWeapon = null;
                this.itemUseStartTime = null;
                this.itemUseWeapon = null;
            }

            if (justReleased && this.inventoryMenuOpen && !this.buildingMode && this.draggingSlotIndex === null) {
                const mouseCenterX = mouseX - screenW / 2;
                const mouseCenterY = mouseY - screenH / 2;
                const mouseWorldX = me.x + mouseCenterX / this.camera.zoom;
                const mouseWorldY = me.y + mouseCenterY / this.camera.zoom;
                const nearbyItem = this.groundItems.find(item => 
                    Math.sqrt((mouseWorldX - item.x) ** 2 + (mouseWorldY - item.y) ** 2) < 100
                );
                if (nearbyItem) {
                    this.sendMessage({kind: "pickUpItem", id: nearbyItem.id});
                }
            }

            const mouseCenterX = mouseX - screenW / 2;
            const mouseCenterY = mouseY - screenH / 2;
            const mouseWorldX = me.x + mouseCenterX / zoom;
            const mouseWorldY = me.y + mouseCenterY / zoom;
            const weaponDef = WEAPON_DEFINITIONS[me.weapon];

            if (me.alive) {
                // aggiorna l'arma selezionata
                const nextWeapon = this.currentSlot === 5 ? 'pickaxe' : (me.inventory[this.currentSlot] || 'pickaxe');
                if (me.weapon !== nextWeapon) {
                    me.weapon = nextWeapon;
                    this.sendMessage({ kind: 'switchWeapon', weapon: nextWeapon });
                }
        
                // gestione movimento immediato come nel multi-pong
                let newX = me.x + moveDirectionX * dt * PERSON_SPEED;
                let newY = me.y + moveDirectionY * dt * PERSON_SPEED;

                // verifica collisioni con linee permanenti PRIMA di muoversi
                for (let line of this.permanentLines) {
                    const personLeft = newX - PERSON_W / 2;
                    const personRight = newX + PERSON_W / 2;
                    const personTop = newY - PERSON_H / 2;
                    const personBottom = newY + PERSON_H / 2;

                    if (line.direction === 'vertical') {
                        const lineLeft = line.x - 5;
                        const lineRight = line.x + 5;
                        const lineTop = line.y;
                        const lineBottom = line.y + 200;
                        if (personLeft < lineRight && personRight > lineLeft &&
                            personTop < lineBottom && personBottom > lineTop) {
                            newX = me.x;
                        }
                    } else if (line.direction === 'horizontal') {
                        const lineLeft = line.x;
                        const lineRight = line.x + 200;
                        const lineTop = line.y - 5;
                        const lineBottom = line.y + 5;
                        if (personLeft < lineRight && personRight > lineLeft &&
                            personTop < lineBottom && personBottom > lineTop) {
                            newY = me.y;
                        }
                    }
                }

                // funzione di controllo collisione contro i muri (usa minima hitbox di 20px)
                const isCollidingWall = (x: number, y: number) => {
                    const pLeft = x - PERSON_W / 2;
                    const pRight = x + PERSON_W / 2;
                    const pTop = y - PERSON_H / 2;
                    const pBottom = y + PERSON_H / 2;
                    for (let wall of this.walls) {
                        const halfW = Math.max(wall.width / 2, 20);
                        const halfH = Math.max(wall.height / 2, 20);
                        const wLeft = wall.x - halfW;
                        const wRight = wall.x + halfW;
                        const wTop = wall.y - halfH;
                        const wBottom = wall.y + halfH;
                        if (pLeft < wRight && pRight > wLeft && pTop < wBottom && pBottom > wTop) return true;
                    }
                    return false;
                };

                // prova separata per asse X e Y (evita incastramenti)
                let attemptX = newX;
                let attemptY = me.y;
                if (isCollidingWall(attemptX, attemptY)) attemptX = me.x;
                attemptY = newY;
                if (isCollidingWall(attemptX, attemptY)) attemptY = me.y;

                newX = attemptX;
                newY = attemptY;

                // se ancora in collisione, torna all'ultima posizione valida locale
                if (isCollidingWall(newX, newY)) {
                    newX = this.lastValidX;
                    newY = this.lastValidY;
                } else {
                    // aggiorna ultima posizione valida (player locale)
                    this.lastValidX = newX;
                    this.lastValidY = newY;
                }

                me.x = newX;
                me.y = newY;
        
                // controllo che il giocatore non esca dallo spazio di gioco
                if (me.y - PERSON_H/2 < worldBounds.top) me.y = worldBounds.top + PERSON_H/2 + EPSILON;
                if (me.y + PERSON_H/2 > worldBounds.bottom) me.y = worldBounds.bottom - PERSON_H/2 - EPSILON;
                if (me.x - PERSON_W/2 < worldBounds.left) me.x = worldBounds.left + PERSON_W/2 + EPSILON;
                if (me.x + PERSON_W/2 > worldBounds.right) me.x = worldBounds.right - PERSON_W/2 - EPSILON;

                // Gestisci apertura casse con 'e'
                if (this.ePressed) {
                    const nearbyCrate = this.crates.find(crate => 
                        !crate.opened && 
                        Math.sqrt((me.x - crate.x) ** 2 + (me.y - crate.y) ** 2) < 100
                    );
                    if (nearbyCrate) {
                        this.sendMessage({kind: "openCrate", x: nearbyCrate.x, y: nearbyCrate.y});
                    }
                }

                // la camera segue il giocatore
                this.camera.x = me.x;
                this.camera.y = me.y;
                this.camera.zoom = zoom;

                if (!this.buildingMode && !this.inventoryMenuOpen && this.userInput.isMouseLeftPressed) {
                    const now = Date.now();
                    
                    // Gestisci utilizzo di medikit/scudo
                    if (me.weapon === 'medkit' || me.weapon === 'shield') {
                        if (this.itemUseStartTime === null) {
                            this.itemUseStartTime = now;
                            this.itemUseWeapon = me.weapon;
                        }
                        
                        if (this.itemUseWeapon === me.weapon && now - this.itemUseStartTime >= this.ITEM_USE_DURATION) {
                            this.sendMessage({kind: "useConsumable", weapon: me.weapon});
                            this.itemUseStartTime = null;
                            this.itemUseWeapon = null;
                        }
                    } else {
                        // Reset consumable timer se cambia arma
                        this.itemUseStartTime = null;
                        this.itemUseWeapon = null;
                        
                        // Spara con armi normali
                        if (now - this.lastShotTime >= weaponDef.cooldown * 1000) {
                            this.lastShotTime = now;
                            this.sendMessage({kind: "shoot", targetX: mouseWorldX, targetY: mouseWorldY, weapon: me.weapon});
                            this.hitEffects.push({ x: me.x + Math.cos(Math.atan2(mouseWorldY - me.y, mouseWorldX - me.x)) * 20, y: me.y + Math.sin(Math.atan2(mouseWorldY - me.y, mouseWorldX - me.x)) * 20, type: 'muzzle', t: 0 });
                        }
                    }
                } else {
                    // Reset consumable timer quando il mouse viene rilasciato
                    this.itemUseStartTime = null;
                    this.itemUseWeapon = null;
                }

                if (this.buildingMode && justPressed) {
                    const xSnapped = Math.round(mouseWorldX / 200) * 200;
                    const ySnapped = Math.round(mouseWorldY / 200) * 200;
                    const distX = Math.abs(mouseWorldX - me.x);
                    const distY = Math.abs(mouseWorldY - me.y);
                    const direction: 'vertical' | 'horizontal' = distX >= distY ? 'vertical' : 'horizontal';
                    const materials = ['wood', 'brick', 'metal'] as const;
                    const material = materials[this.buildingMaterialIndex];
                    // Calcola il centro della linea che viene disegnata (non l'angolo)
                    const wallX = direction === 'horizontal' ? xSnapped + 100 : xSnapped;
                    const wallY = direction === 'vertical' ? ySnapped + 100 : ySnapped;
                    this.sendMessage({kind: "buildWall", x: wallX, y: wallY, direction, material});
                }
            } else {
                const killer = this.watchedKillerId ? this.people[this.watchedKillerId] : null;
                if (killer) {
                    this.camera.x = killer.xTarget;
                    this.camera.y = killer.yTarget;
                } else {
                    this.camera.x = me.x;
                    this.camera.y = me.y;
                }
                this.camera.zoom = zoom;
            }

            // pulisci lo schermo con un cielo dinamico
            const skyGradient = ctx.createLinearGradient(0, 0, 0, screenH);
            skyGradient.addColorStop(0, '#74c5ff');
            skyGradient.addColorStop(0.5, '#7ec9ff');
            skyGradient.addColorStop(1, '#93e9ff');
            ctx.fillStyle = skyGradient;
            ctx.fillRect(0, 0, screenW, screenH);

            // piccolo sole e nubi stilizzate
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.beginPath();
            ctx.arc(screenW * 0.85, screenH * 0.15, 50, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.beginPath();
            ctx.ellipse(screenW * 0.25, screenH * 0.18, 90, 30, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(screenW * 0.38, screenH * 0.13, 80, 25, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            ctx.save();
            ctx.translate(screenW/2, screenH/2); // centra lo schermo
            ctx.scale(this.camera.zoom, this.camera.zoom); // applica lo zoom
            ctx.translate(-this.camera.x, -this.camera.y); // sposta relativamente alla camera

            // disegna lo sfondo del "mondo" (campo da gioco)
            const groundGradient = ctx.createLinearGradient(0, worldBounds.top, 0, worldBounds.bottom);
            groundGradient.addColorStop(0, '#4f9e12');
            groundGradient.addColorStop(1, '#2e6f0b');
            ctx.fillStyle = groundGradient;
            ctx.fillRect(worldBounds.left, worldBounds.top, worldW, worldH);

            // disegna colline sullo sfondo
            ctx.fillStyle = 'rgba(15, 96, 32, 0.65)';
            ctx.beginPath();
            ctx.moveTo(worldBounds.left, worldBounds.top + 700);
            ctx.quadraticCurveTo(-800, worldBounds.top + 100, 0, worldBounds.top + 450);
            ctx.quadraticCurveTo(500, worldBounds.top + 680, 1200, worldBounds.top + 450);
            ctx.quadraticCurveTo(2000, worldBounds.top + 200, worldBounds.right, worldBounds.top + 700);
            ctx.lineTo(worldBounds.right, worldBounds.bottom);
            ctx.lineTo(worldBounds.left, worldBounds.bottom);
            ctx.closePath();
            ctx.fill();

            // disegna la griglia verde scuro
            ctx.fillStyle = "#004400";
            // linee verticali
            for (let x = worldBounds.left; x <= worldBounds.right; x += 200) {
                ctx.fillRect(x - 5, worldBounds.top, 10, worldH);
            }
            // linee orizzontali
            for (let y = worldBounds.top; y <= worldBounds.bottom; y += 200) {
                ctx.fillRect(worldBounds.left, y - 5, worldW, 10);
            }
    
            // disegna casse
            ctx.fillStyle = "#8B4513";
            for (let crate of this.crates) {
                if (!crate.opened) {
                    ctx.fillRect(crate.x - 25, crate.y - 25, 50, 50);
                }
            }
    
            // disegna linee permanenti marrone
            ctx.fillStyle = "#8B4513";
            for (let line of this.permanentLines) {
                if (line.direction === 'vertical') {
                    ctx.fillRect(line.x - 5, line.y, 10, 200);
                } else {
                    ctx.fillRect(line.x, line.y - 5, 200, 10);
                }
            }
    
            // disegna muro temporaneo in modalità costruzione
            if (this.buildingMode) {
                // snappo le coordinate al grid di 200
                const xSnapped = Math.round(mouseWorldX / 200) * 200;
                const ySnapped = Math.round(mouseWorldY / 200) * 200;
                const distX = Math.abs(mouseWorldX - me.x);
                const distY = Math.abs(mouseWorldY - me.y);
                const direction: 'vertical' | 'horizontal' = distX >= distY ? 'vertical' : 'horizontal';
                const materials = ['wood', 'brick', 'metal'] as const;
                const material = materials[this.buildingMaterialIndex];
                const materialColor = material === 'wood' ? '#8B4513' : material === 'brick' ? '#D2691E' : '#8CBAD3';

                ctx.fillStyle = materialColor;
                ctx.globalAlpha = 0.45;
                if (direction === 'vertical') {
                    ctx.fillRect(xSnapped - 5, ySnapped, 10, 200);
                } else {
                    ctx.fillRect(xSnapped, ySnapped - 5, 200, 10);
                }
                ctx.globalAlpha = 1.0;

                ctx.strokeStyle = materialColor;
                ctx.lineWidth = 3;
                if (direction === 'vertical') {
                    ctx.strokeRect(xSnapped - 5, ySnapped, 10, 200);
                } else {
                    ctx.strokeRect(xSnapped, ySnapped - 5, 200, 10);
                }

                ctx.fillStyle = "#fff";
                ctx.font = "bold 14px Arial";
                ctx.textAlign = "center";
                ctx.fillText(`BUILD MODE: ${material.toUpperCase()} (wheel)`, xSnapped, ySnapped - 110);
            }

            // disegna proiettili e effetti
            this.bullets.forEach(bullet => this.drawBullet(ctx, bullet));
            this.hitEffects.forEach(effect => this.drawHitEffect(ctx, effect));

            // interpola le posizioni dei giocatori avversari
            Object.values(this.people).forEach((person) => {
                if (person !== me) {
                    person.x = smoothChange(person.x, person.xTarget, dt, 0.1);
                    person.y = smoothChange(person.y, person.yTarget, dt, 0.1);
                }
            });

            // sposta le persone e disegnale
            Object.values(this.people).forEach((person) => {
                const drawPerson = getCharacterDrawFunction(person.character);
                if (!person.alive) {
                    ctx.save();
                    ctx.translate(person.x, person.y);
                    ctx.rotate(Math.PI / 2);
                    drawPerson(ctx, 0, 0, PERSON_W, PERSON_H);
                    ctx.restore();
                } else {
                    drawPerson(ctx, person.x, person.y, PERSON_W, PERSON_H);
                }

                drawPersonName(ctx, person);
                
                if (person === me && person.alive) {
                    const dx = mouseWorldX - me.x;
                    const dy = mouseWorldY - me.y;
                    const angle = Math.atan2(dy, dx);
                    this.drawWeapon(ctx, me.x, me.y, angle, me.weapon, this.getWeaponRenderSize(me.weapon));
                }
            });

            // disegna oggetti a terra
            for (let item of this.groundItems) {
                this.drawWeapon(ctx, item.x, item.y, 0, item.weapon, 36);
            }

            // disegna muri
            for (let wall of this.walls) {
                const materialColors: Record<string, string> = {
                    'wood': '#8B4513',
                    'brick': '#D2691E',
                    'metal': '#C0C0C0'
                };
                ctx.fillStyle = materialColors[wall.material] || '#888';
                ctx.fillRect(wall.x - wall.width / 2, wall.y - wall.height / 2, wall.width, wall.height);
                
                // Disegna la vita del muro se non è al massimo
                if (wall.health < wall.maxHealth) {
                    const barWidth = 50;
                    const barHeight = 8;
                    const barX = wall.x - 25;
                    const barY = wall.y - wall.height / 2 - 15;
                    
                    // Sfondo barra
                    ctx.fillStyle = '#222';
                    ctx.fillRect(barX, barY, barWidth, barHeight);
                    
                    // Barra vita (verde)
                    ctx.fillStyle = '#00ff00';
                    ctx.fillRect(barX, barY, barWidth * (wall.health / wall.maxHealth), barHeight);
                    
                    // Bordo barra
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(barX, barY, barWidth, barHeight);
                }
            }

            ctx.restore();

            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.fillRect(20, 20, 280, 100);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 20px Arial';
            ctx.textAlign = 'left';
            ctx.fillText('BATTLE ROYALE', 32, 48);
            ctx.font = '14px Arial';
            const aliveCount = Object.values(this.people).filter(p => p.alive).length;
            ctx.fillText(`Alive: ${aliveCount}/${Object.keys(this.people).length}`, 32, 70);
            ctx.fillText(`Weapon: ${weaponDef.displayName}`, 32, 92);
            if (me.reloading) {
                ctx.fillText(`Reloading...`, 32, 112);
            } else if (weaponDef.magazine > 0) {
                const reserve = me.ammoReserve[me.weapon] || 0;
                ctx.fillText(`Ammo: ${me.ammo}/${weaponDef.magazine}  Reserve: ${reserve}`, 32, 112);
            } else {
                ctx.fillText('Ammo: -', 32, 112);
            }
            ctx.restore();

            if (!me.alive) {
                ctx.save();
                ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
                ctx.fillRect(0, 0, screenW, screenH);
                ctx.fillStyle = '#ff5e5e';
                ctx.font = 'bold 60px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('ELIMINATED', screenW / 2, screenH / 2 - 20);
                ctx.font = '20px Arial';
                ctx.fillStyle = '#fff';
                ctx.fillText('Respawn not yet available', screenW / 2, screenH / 2 + 20);
                ctx.restore();
            }

            if (!this.inventoryMenuOpen && !this.buildingMode && me.alive) {
                this.drawCrosshair(ctx, mouseX, mouseY);
            }

            const barWidth = 500;
            const barHeight = 20;
            const barX = (screenW - barWidth) / 2;
            const shieldBarY = screenH - 120;
            const healthBarY = screenH - 85;

            // Barra scudo (azzurra)
            ctx.fillStyle = "#0088ff";
            ctx.fillRect(barX, shieldBarY, barWidth * (me.shield / 100), barHeight);
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.strokeRect(barX, shieldBarY, barWidth, barHeight);

            // Barra salute (verde)
            ctx.fillStyle = "#00ff00";
            ctx.fillRect(barX, healthBarY, barWidth * (me.health / 100), barHeight);
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.strokeRect(barX, healthBarY, barWidth, barHeight);

            // Valori dentro le barre a destra
            ctx.fillStyle = "#fff";
            ctx.font = "16px Arial";
            ctx.textAlign = "right";
            ctx.fillText(`${me.shield}/100`, barX + barWidth - 10, shieldBarY + barHeight - 5);
            ctx.fillText(`${me.health}/100`, barX + barWidth - 10, healthBarY + barHeight - 5);

            if (this.itemUseStartTime !== null && (me.weapon === 'medkit' || me.weapon === 'shield') && me.alive) {
                const now = Date.now();
                const elapsed = now - this.itemUseStartTime;
                const remaining = Math.max(0, (this.ITEM_USE_DURATION - elapsed) / 1000);
                const timerX = barX + barWidth / 2;
                const timerY = shieldBarY - 40;
                const radius = 24;
                const progress = 1 - (remaining / (this.ITEM_USE_DURATION / 1000));

                ctx.save();
                ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
                ctx.beginPath();
                ctx.arc(timerX, timerY, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(timerX, timerY, radius - 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
                ctx.stroke();

                ctx.fillStyle = '#fff';
                ctx.font = 'bold 16px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(remaining.toFixed(1), timerX, timerY);
                ctx.restore();
            }

            if (this.inventoryMenuOpen) {
                // Disegna il menu inventario a DESTRA e GRANDE
                const menuX = screenW - 450;
                const menuY = 20;
                const menuW = 430;
                const menuH = screenH - 100;
                ctx.fillStyle = "rgba(0,0,0,0.85)";
                ctx.fillRect(menuX, menuY, menuW, menuH);
                ctx.strokeStyle = "#0f0";
                ctx.lineWidth = 3;
                ctx.strokeRect(menuX, menuY, menuW, menuH);
                ctx.fillStyle = "#0f0";
                ctx.textAlign = "left";
                ctx.font = "bold 24px Arial";
                ctx.fillText("INVENTORY", menuX + 20, menuY + 35);

                let currentY = menuY + 60;
                const lineHeight = 25;
                const sectionSpacing = 15;

                // === SEZIONE ARMI ===
                ctx.fillStyle = "#ff8800";
                ctx.font = "bold 18px Arial";
                ctx.fillText("WEAPONS", menuX + 20, currentY);
                currentY += lineHeight + 5;

                ctx.fillStyle = "#aaa";
                ctx.font = "14px Arial";
                for (let i = 0; i < 5; i++) {
                    const weapon = me.inventory[i];
                    if (weapon) {
                        const ammo = me.ammoReserve[weapon] || 0;
                        const displayName = WEAPON_DEFINITIONS[weapon]?.displayName || weapon;
                        const ammoText = WEAPON_DEFINITIONS[weapon]?.magazine > 0 ? ` (${me.ammo}/${ammo})` : '';
                        ctx.fillText(`${i + 1}. ${displayName}${ammoText}`, menuX + 30, currentY);
                    } else {
                        ctx.fillStyle = "#555";
                        ctx.fillText(`${i + 1}. Empty`, menuX + 30, currentY);
                        ctx.fillStyle = "#aaa";
                    }
                    currentY += lineHeight;
                }

                currentY += sectionSpacing;

                // === SEZIONE MUNIZIONI ===
                ctx.fillStyle = "#ffff00";
                ctx.font = "bold 18px Arial";
                ctx.fillText("AMMUNITION", menuX + 20, currentY);
                currentY += lineHeight + 5;

                ctx.fillStyle = "#aaa";
                ctx.font = "14px Arial";
                const ammoWeapons: WeaponType[] = ['pistol', 'pump', 'sniper', 'assault'];
                for (const weapon of ammoWeapons) {
                    const ammo = me.ammoReserve[weapon] || 0;
                    const displayName = WEAPON_DEFINITIONS[weapon].displayName;
                    ctx.fillText(`${displayName}: ${ammo}`, menuX + 30, currentY);
                    currentY += lineHeight;
                }

                currentY += sectionSpacing;

                // === SEZIONE MATERIALI ===
                ctx.fillStyle = "#00ff00";
                ctx.font = "bold 18px Arial";
                ctx.fillText("MATERIALS", menuX + 20, currentY);
                currentY += lineHeight + 5;

                ctx.fillStyle = "#aaa";
                ctx.font = "14px Arial";
                const materials = [
                    { name: 'Wood', key: 'wood', color: '#8B4513' },
                    { name: 'Brick', key: 'brick', color: '#D2691E' },
                    { name: 'Metal', key: 'metal', color: '#C0C0C0' }
                ];
                for (const mat of materials) {
                    ctx.fillStyle = mat.color;
                    const amount = me.materials[mat.key as keyof typeof me.materials] || 0;
                    ctx.fillText(`${mat.name}: ${amount}`, menuX + 30, currentY);
                    currentY += lineHeight;
                }

                if (this.draggingSlotIndex !== null && this.dragWeapon) {
                    ctx.save();
                    ctx.translate(mouseX, mouseY);
                    this.drawWeapon(ctx, 0, 0, 0, this.dragWeapon, 36);
                    ctx.restore();
                }
            }

            // Disegna gli slot degli oggetti in basso a destra
            const slotSize = 50;
            const slotSpacing = 8;
            const totalSlots = 6;
            const startX = screenW - totalSlots * slotSize - (totalSlots - 1) * slotSpacing - 20;
            const startY = screenH - slotSize - 20;
            
            for (let i = 0; i < 5; i++) {
                const x = startX + i * (slotSize + slotSpacing);
                const y = startY;
                
                // Sfondo slot
                ctx.fillStyle = i === this.currentSlot ? "#444" : "#222";
                ctx.fillRect(x, y, slotSize, slotSize);
                ctx.strokeStyle = "#fff";
                ctx.lineWidth = 2;
                ctx.strokeRect(x, y, slotSize, slotSize);
                
                // Disegna oggetto se presente
                const weapon = me.inventory[i];
                if (weapon) {
                    ctx.save();
                    ctx.translate(x + slotSize / 2, y + slotSize / 2);
                    this.drawWeapon(ctx, 0, 0, 0, weapon, 36);
                    ctx.restore();
                }
            }
            
            // Slot piccone separato (sempre presente)
            const pickaxeX = startX + 5 * (slotSize + slotSpacing);
            const pickaxeY = startY;
            ctx.fillStyle = this.currentSlot === 5 ? "#444" : "#222";
            ctx.fillRect(pickaxeX, pickaxeY, slotSize, slotSize);
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.strokeRect(pickaxeX, pickaxeY, slotSize, slotSize);
            
            ctx.save();
            ctx.translate(pickaxeX + slotSize / 2, pickaxeY + slotSize / 2);
            this.drawWeapon(ctx, 0, 0, 0, 'pickaxe', 36);
            ctx.restore();
        
        // Overlay vittoria (schermo intero) se notificato dal server
        if (this.victoryName) {
            ctx.save();
            // overlay semi-trasparente
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0, 0, screenW, screenH);

            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.font = '64px sans-serif';
            ctx.fillText('Vittoria', screenW / 2, screenH / 2 - 20);
            ctx.font = '36px sans-serif';
            ctx.fillText(this.victoryName, screenW / 2, screenH / 2 + 40);
            ctx.restore();
        }

        }




    draw(ctx: CanvasRenderingContext2D, dt: number) {
        const me = this.getMe() as ClientPersonExtended | null;
        if (me) {
            this.drawLobby(ctx, me, dt);
        }
    }

    handleMessage(message: any) {
    if (message.kind === "update") {
        console.log('[handleMessage] people positions:', 
            Object.entries(message.people).map(([id, p]: any) => `${id}: (${p.x}, ${p.y})`));
        const updateMsg = message;
        const isFirstUpdate = !this.hasReceivedFirstUpdate;
        if (isFirstUpdate) this.hasReceivedFirstUpdate = true;

        Object.entries(updateMsg.people as Record<string, Person>).forEach(entry => {
            const id: string = entry[0];
            const updatedPerson: Person = entry[1];
            if (this.people[id]) {
                this.people[id].health = updatedPerson.health;
                this.people[id].shield = updatedPerson.shield;
                this.people[id].inventory = updatedPerson.inventory;
                this.people[id].alive = updatedPerson.alive;
                this.people[id].weapon = updatedPerson.weapon;
                this.people[id].ammo = updatedPerson.ammo;
                this.people[id].ammoReserve = updatedPerson.ammoReserve;
                this.people[id].reloading = updatedPerson.reloading;
                this.people[id].reloadRemaining = updatedPerson.reloadRemaining;
                this.people[id].materials = updatedPerson.materials;
                this.people[id].killerId = updatedPerson.killerId;

                this.people[id].xTarget = updatedPerson.x;
                this.people[id].yTarget = updatedPerson.y;
                if (isFirstUpdate) {
                    this.people[id].x = updatedPerson.x;
                    this.people[id].y = updatedPerson.y;
                }
                if (id === this.myId) {
                    if (!updatedPerson.alive) {
                        this.watchedKillerId = updatedPerson.killerId || this.watchedKillerId;
                    } else {
                        this.watchedKillerId = null;
                    }
                }
            } else {
                this.people[id] = {
                    ...updatedPerson,
                    xTarget: updatedPerson.x,
                    yTarget: updatedPerson.y,
                } as ClientPersonExtended;
            }
        });

        this.permanentLines = updateMsg.lines || this.permanentLines;
        this.crates = updateMsg.crates || this.crates;
        this.groundItems = updateMsg.groundItems || this.groundItems;
        this.walls = updateMsg.walls || this.walls;
        this.bullets = updateMsg.bullets || this.bullets;
        this.hitEffects = updateMsg.effects || this.hitEffects;
    } else if (message.kind === 'teamVictory') {
        this.victoryTeam = message.team || null;
        this.victoryName = message.winnerName || null;
    }
}

    flushMessages(): any[] {
        const messages: any[] = [];

        const me = this.getMe();
        if (me && me.alive) {
            messages.push({
                kind: "move",
                x: me.x,
                y: me.y
            });
        }

        messages.push(...this.pendingMessages);
        this.pendingMessages = [];

        return messages;
    }

    private sendMessage(message: any) {
        this.pendingMessages.push(message);
    }

    private getMe(): ClientPersonExtended | null {
        return this.myId ? this.people[this.myId] : null;
    }

    isFinished(): boolean {
        return false;
    }
    

}

