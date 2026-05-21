export const ROOM = {
  width: 16,
  height: 9,
};

/** Altezza totale della mappa in unità mondo. */
export const MAP_HEIGHT = ROOM.height * 8; // 8 "stanze" impilate verticalmente = 72 unità

/** Parametri fisici e di controllo del giocatore. */
export const PLAYER = {
  width: 0.62,
  height: 0.82,

  // Movimento a terra: il giocatore non si muove liberamente in aria (stile Jump King)
  groundMoveSpeed: 2.15,

  // Fisica aria: nessun controllo direzionale dopo il lancio (autentico Jump King)
  airDrag: 0.0,

  // Gravità più pesante per un feel "di piombo"
  gravity: 30,
  terminalVelocity: 18,

  // Salto a carica
  maxChargeSeconds: 0.85,
  maxJumpVelocity: 13.5,
  maxHorizontalVelocity: 5.8,

  // Tolleranze
  coyoteSeconds: 0.07,
  jumpBufferSeconds: 0.1,
  wallSkin: 0.001,

  // Effetto "bump" quando si tocca il soffitto (rimbalzo leggermente laterale)
  ceilBounceVy: 0.5,
};

/** Parametri fisici del motore. */
export const PHYSICS = {
  maxStepSeconds: 1 / 20,
  inputDeadZone: 0.2,
  topLandingTolerance: 0.1,
  groundedSnapDistance: 0.35,
};

/** Palette colori. */
export const COLORS = {
  void: "#05070c",
  skyTop: "#24324a",
  skyBottom: "#667f8a",
  stone: "#5d6667",
  stoneTop: "#9ba18f",
  oneWay: "#7f7146",
  oneWayTop: "#d6bd6a",
  moving: "#487a7c",
  movingTop: "#90d1c6",
  slope: "#7d5a45",
  slopeTop: "#d69b67",
  text: "#f4f0d9",
  shadow: "rgba(0, 0, 0, 0.34)",
  charge: "#f3d45f",
  chargeBack: "rgba(0,0,0,0.55)",
};


export const SPRITE_SHEET = {
  url: "/assets/PolloAMolla/PolloSaltante.png",
  frameSize: 195,

  frames: {
    idle: { x: 0, y: 0, w: 195, h: 195 },
    charge: { x: 195, y: 0, w: 195, h: 195 },
    airborne: { x: 390, y: 0, w: 195, h: 195 },
    land: { x: 0, y: 195, w: 195, h: 195 },
    win: { x: 195 * 6 , y: 0, w: 225, h: 225 },
  },
};

export const SPRITE_RENDER = {
  scaleX: 1.9,
  scaleY: 1.65,
  pivotX: 0.45,
  pivotY: 0.75,
};
