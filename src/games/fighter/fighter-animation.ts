import { PlayerState } from './fighter';

export type PoseKeyframe = {
    bodyTilt:  number;
    duration:  number;
    armSide:   'front' | 'back';
    opacity:   number;
};

function f(
    bodyTilt: number,
    duration: number,
    armSide: 'front' | 'back' = 'front',
    opacity = 1
): PoseKeyframe {
    return { bodyTilt, duration, armSide, opacity };
}

type Animation = {
    keyframes: PoseKeyframe[];
    loop:      boolean;
};

const DEFAULT_POSE: PoseKeyframe = f(0, 1 / 12);

export class AnimationManager {
    private animations: Partial<Record<PlayerState, Animation>> = {};
    private state: PlayerState = 'IDLE';
    private elapsed = 0;

    public currentAnimationFrame = 0;
    public facing: 'left' | 'right' = 'right';
    public poseData: PoseKeyframe = DEFAULT_POSE;

    addAnimation(state: PlayerState, keyframes: PoseKeyframe[], loop = false): void {
        this.animations[state] = { keyframes, loop };
    }

    flipSprite(direction: 'left' | 'right'): void {
        this.facing = direction;
    }

    setState(state: PlayerState): void {
        if (this.state === state) return;
        this.state   = state;
        this.elapsed = 0;
        this.currentAnimationFrame = 0;
        this.poseData = this.animations[state]?.keyframes[0] ?? DEFAULT_POSE;
    }

    updateAnimation(dt: number): void {
        const anim = this.animations[this.state];
        if (!anim || anim.keyframes.length === 0) { this.poseData = DEFAULT_POSE; return; }

        this.elapsed += dt;
        const frameDuration = anim.keyframes[this.currentAnimationFrame].duration;

        if (this.elapsed >= frameDuration) {
            this.elapsed = 0;
            this.currentAnimationFrame++;
            if (this.currentAnimationFrame >= anim.keyframes.length)
                this.currentAnimationFrame = anim.loop ? 0 : anim.keyframes.length - 1;
        }

        this.poseData = anim.keyframes[this.currentAnimationFrame];
    }
}

export function createDefaultFighterAnimationManager(): AnimationManager {
    const m = new AnimationManager();

    m.addAnimation('IDLE', [
        f(  0, 0.15),
        f(  1, 0.15),
        f(  0, 0.15),
    ], true);

    m.addAnimation('MOVE', [
        f(  5, 0.10),
        f( -5, 0.10),
    ], true);

    m.addAnimation('JUMP', [
        f( -5, 0.30),
    ], true);

    m.addAnimation('CROUCHING', [
        f( 20, 0.20),
    ]);

    m.addAnimation('DASHING', [
        f(-10, 0.08),
        f( 15, 0.08),
    ], true);

    m.addAnimation('DODGING', [
        f(-20, 0.15, 'front', 0.9),
        f( 15, 0.15),
    ]);

    m.addAnimation('CHARGING', [
        f(  5, 0.12),
        f(  5, 0.12),
    ], true);

    m.addAnimation('ATTACK', [
        f( -5, 0.08, 'back'),
        f( 20, 0.07, 'front'),
        f(  5, 0.12, 'front'),
    ]);

    m.addAnimation('SHORYUKEN', [
        f( -8, 0.06, 'back'),
        f(-25, 0.10, 'front'),
        f(-15, 0.14, 'front'),
        f(  5, 0.14, 'front'),
    ]);

    m.addAnimation('BLOCK', [
        f(-15, 0.15),
    ], true);

    m.addAnimation('HIT', [
        f(-10, 0.10, 'front', 0.85),
    ]);

    m.addAnimation('KNOCKDOWN', [
        f( 90, 0.20),
    ]);

    m.addAnimation('KO', [
        f( 90, 0.50, 'front', 0.7),
    ]);

    return m;
}
