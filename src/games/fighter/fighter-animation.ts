import { CombatEvent, PlayerState } from './fighter';

export type PoseKeyframe = {
    armAngle: number;
    legAngle: number;
    bodyTilt: number;
    armExtension: number;
    duration: number;
    armSide: 'front' | 'back';
    opacity: number;
};

type Animation = {
    keyframes: PoseKeyframe[];
    loop: boolean;
    hitFrame?: number;
};

// Positional shorthand — opacity and armSide almost never deviate from defaults
function f(
    armAngle: number,
    legAngle: number,
    bodyTilt: number,
    armExtension: number,
    duration: number,
    armSide: 'front' | 'back' = 'front',
    opacity = 1
): PoseKeyframe {
    return { armAngle, legAngle, bodyTilt, armExtension, duration, armSide, opacity };
}

const DEFAULT_POSE: PoseKeyframe = f(0, 0, 0, 0, 1 / 12);

export class AnimationManager {
    private animations: Partial<Record<PlayerState, Animation>> = {};
    private state: PlayerState = "IDLE";
    private elapsed = 0;

    public frame = 0;
    public facing: 'left' | 'right' = 'right';
    public pose: PoseKeyframe = DEFAULT_POSE;

    addAnimation(state: PlayerState, keyframes: PoseKeyframe[], loop = false, hitFrame?: number): void {
        this.animations[state] = { keyframes, loop, hitFrame };
    }
    
    flipSprite(direction: 'left' | 'right'): void {
        this.facing = direction;
    }

    setState(state: PlayerState): void {
        if (this.state === state) return;
        this.state = state;
        this.elapsed = 0;
        this.frame = 0;
        this.pose = this.animations[state]?.keyframes[0] ?? DEFAULT_POSE;
    }

    update(dt: number): CombatEvent[] {
        const anim = this.animations[this.state];
        if (!anim || anim.keyframes.length === 0) {
            this.pose = DEFAULT_POSE;
            return [];
        }

        this.elapsed += dt;
        const events: CombatEvent[] = [];

        if (this.elapsed >= anim.keyframes[this.frame].duration) {
            this.elapsed = 0;
            this.frame++;
            if (this.frame >= anim.keyframes.length)
                this.frame = anim.loop ? 0 : anim.keyframes.length - 1;
            if (this.frame === anim.hitFrame)
                events.push("HitboxActive" as CombatEvent);
        }

        this.pose = anim.keyframes[this.frame];
        return events;
    }
}

export function createDefaultFighterAnimationManager(): AnimationManager {
    const m = new AnimationManager();

    m.addAnimation("IDLE", [
        f(  0,   0,   0,     0, 0.15),
        f( -5,  -2,   1,     0, 0.15),
        f(  0,   0,   0,     0, 0.15),
    ], true);

    m.addAnimation("WALKING", [
        f( 15,  10,   2,  0.10, 0.1),
        f(-15, -10,  -2,  0.05, 0.1),
        f( 10,   5,   1,  0.08, 0.1),
    ], true);

    m.addAnimation("JUMPING", [
        f(-30, -25,  -5,  0.20, 0.3),
    ], true);

    m.addAnimation("CROUCHING", [
        f( 10,  40,  20, -0.10, 0.2),
    ]);

    m.addAnimation("DASHING", [
        f(  5, -15, -10,  0.15, 0.08),
        f(-10,  20,  15,  0.10, 0.08),
    ], true);

    m.addAnimation("DODGING", [
        f(-45, -30, -20, -0.20, 0.15, 'front', 0.9),
        f( 30,  25,  15,  0.10, 0.15),
    ]);

    m.addAnimation("CHARGING", [
        f(-20,   5,   5,  0.30, 0.12),
        f(-25,   5,   5,  0.35, 0.12),
    ], true);

    m.addAnimation("ATTACKING_LIGHT", [
        f(-15,   5,  -5, -0.10, 0.08, 'back'),
        f( 45,   5,  10,  0.40, 0.06),
        f( 20,   5,   5,  0.20, 0.10),
    ], false, 1);

    m.addAnimation("ATTACKING_HEAVY", [
        f(-30,  10, -15, -0.20, 0.12, 'back'),
        f( 60,  15,  30,  0.50, 0.08),
        f( 30,  10,  15,  0.25, 0.14),
    ], false, 1);

    m.addAnimation("ATTACKING_AERIAL", [
        f(-60, -20, -25,  0.10, 0.10, 'back'),
        f( 50, -15,  20,  0.45, 0.08),
        f(  0, -10,   0,  0.00, 0.12),
    ], false, 1);

    m.addAnimation("ATTACKING_SWEEP", [
        f(  0,  45,  25,  0.00, 0.12),
        f( 10,  60,  35,  0.10, 0.08),
        f(  5,  40,  20,  0.05, 0.15),
    ], false, 1);

    m.addAnimation("SPECIAL", [
        f(-45, -10, -20, -0.15, 0.10, 'back'),
        f( 80,  20,  40,  0.55, 0.08),
        f( 60,  25,  30,  0.40, 0.12),
    ], false, 1);

    m.addAnimation("HIT", [
        f( 20, -10, -10,  0.00, 0.10, 'front', 0.85),
    ]);

    m.addAnimation("BLOCKING", [
        f(-30,  10, -15,  0.25, 0.15),
    ], true);

    m.addAnimation("KNOCKDOWN", [
        f( 45,  60,  90,  0.20, 0.20),
    ]);

    m.addAnimation("KO", [
        f( 45,  60,  90,  0.20, 0.50, 'front', 0.7),
    ]);

    return m;
}
