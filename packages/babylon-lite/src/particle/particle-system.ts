/**
 * Data-oriented particle system and simulation loop.
 *
 * Matches Babylon.js emission counting, update, lifetime-clamp, recycle, and creation semantics, including
 * `Math.random` consumption and creation-step order, while operating on a {@link ParticleBuffer} of columns
 * via ordered {@link ParticleStep} lists. The creation and update steps
 * are supplied by the graph build (or, in tests, hand-wired). Feature state lives in feature columns, so a
 * system pays nothing for features it does not use.
 */
import { createParticleBuffer, killParticle, spawnParticle, type ParticleBuffer } from "./particle-buffer.js";
import type { ParticleStep } from "./node/npe-value.js";
import type { Texture2D } from "../texture/texture-2d.js";
import type { Color4, Mat4 } from "../math/types.js";
import type { SceneContext } from "../scene/scene-core.js";
import type { FacingBillboardSpriteSystem } from "../sprite/billboard-sprite.js";

/** @internal Matrix retained by an emitter shape whose runtime data includes an inverse transform. */
export interface ParticleEmitterInverse {
    readonly inverse: Mat4;
}

/**
 * Minimal sprite-sheet handle carried on a system whose graph uses the sprite feature (null otherwise).
 * Holds the render cell dimensions, the per-particle cell-index column read by the billboard, and the
 * per-particle update step. The feature's columns and logic live in `sprite-columns.ts` + the sprite
 * blocks; a non-sprite system leaves this null and imports none of that.
 */
export interface ParticleSpriteHandle {
    readonly cellWidth: number;
    readonly cellHeight: number;
    readonly startCellID?: number;
    readonly endCellID?: number;
    readonly cellIndex: Uint16Array;
    readonly update: (i: number) => void;
}

/** @internal Extended lifecycle behavior installed only by systems that use it. */
export interface ParticleLifecycle {
    /** @internal Return true to defer or reject this start. */
    _beforeStart?: (delay?: number) => boolean;
    /** @internal Run after the system enters its started state. */
    _started?: () => void;
    /** @internal Return a one-shot emission count, or undefined for rate-based emission. */
    _emit?: () => number | undefined;
    /** @internal Run after particle updates and births. */
    _afterAnimate?: () => void;
    /** @internal Run before the first stop transition of one run. */
    _stopped?: () => void;
    /** @internal Release feature-owned resources. */
    _dispose?: () => void;
}

/** Pure-state data-oriented particle system. Behaviour is provided by the standalone functions below. */
export interface ParticleSystem {
    readonly buffer: ParticleBuffer;
    /** Particles emitted per simulated time unit. */
    emitRate: number;
    /** Simulation advance per frame, before the per-step ratio. */
    updateSpeed: number;
    /** When non-zero, the system stops once `_actualFrame` reaches this value. */
    targetStopDuration: number;
    /*
     * SystemBlock lifecycle properties. NPE assigns them, and start/animate honor them, only when the serialized
     * SystemBlock enables a non-default lifecycle; otherwise they stay undefined and the system uses rate-based,
     * immediate-start behavior.
     */
    /** One-shot emission count; `-1` uses rate-based emission. */
    manualEmitCount?: number;
    /** Number of synchronous simulation steps performed when the system starts. */
    preWarmCycles?: number;
    /** Step ratio used by pre-warm simulation calls. */
    preWarmStepOffset?: number;
    /** Start delay in milliseconds. */
    startDelay?: number;
    /** Dispose the system after stopped particles have drained. */
    disposeOnStop?: boolean;
    /** Prevent start calls until cleared. */
    doNoStart?: boolean;
    /** Rendering blend mode (Babylon.js BaseParticleSystem blend constants). */
    blendMode: number;
    /** Particle texture, bound after the build's async loads settle (null until then / for headless builds). */
    texture: Texture2D | null;
    /** Creation slots, run in Babylon.js fixed order on every spawned particle (null slots skipped). */
    createLifeTime: ParticleStep | null;
    createPosition: ParticleStep | null;
    createDirection: ParticleStep | null;
    createEmitPower: ParticleStep | null;
    createSize: ParticleStep | null;
    createAngle: ParticleStep | null;
    createColor: ParticleStep | null;
    createColorDead: ParticleStep | null;
    /** Update steps, run in graph order on every live particle each frame. */
    updateSteps: ParticleStep[];

    /** @internal Scaled step for the current particle (= Babylon.js `_directionScale`; clamped on the dying step). */
    _scaledStep: number;
    /** @internal Emit power of the most recently created particle (set by the creation slots). */
    _emitPower: number;
    /** @internal Update speed scaled by the step ratio for the whole frame (unclamped; used by scaled colour step). */
    _scaledUpdateSpeed: number;
    /** @internal Fractional emission carry-over between steps. */
    _newPartsExcess: number;
    /** @internal Whether the system is started. */
    _started: boolean;
    /** @internal Whether the system has been stopped (drains remaining particles). */
    _stopped: boolean;
    /** @internal Whether terminal drain disposed the system. */
    _disposed: boolean;
    /** @internal Accumulated simulated time, in update-speed units. */
    _actualFrame: number;
    /** @internal Optional system-level emit-rate getter, installed only for a connected emit-rate graph. */
    _emitRateGetter?: () => number;
    /** @internal Optional feature preparation, run before every started simulation call. */
    _prepareFrame?: () => void;
    /** @internal Optional non-default lifecycle behavior and ownership cleanup. */
    _lifecycle?: ParticleLifecycle;
    /** @internal Optional live-render registration cleanup. */
    _unregister?: () => void;
    /** @internal Sprite-sheet feature handle, present only for sprite systems. */
    _spriteSheet?: ParticleSpriteHandle;
    /** @internal Optional feature writer installed only when a graph reads ColorDead. */
    _writeColorDead?: (i: number, color: Color4) => void;
    /** @internal Mesh-normal emitters leave Babylon.js's initial direction at its zero default. */
    _suppressInitialDirectionCapture?: boolean;
    /** @internal Local-position source hook installed only for emitter-local graphs that read source 0x18. */
    _seedLocalPosition?: ParticleStep;
    /** @internal Optional scene registrar installed for particle blend modes requiring specialized rendering. */
    _registerBillboard?: (scene: SceneContext, billboard: FacingBillboardSpriteSystem) => () => void;
}

/** Create a data-oriented particle system with an empty buffer of the given capacity. */
export function createParticleSystem(capacity: number, buffer: ParticleBuffer = createParticleBuffer(capacity)): ParticleSystem {
    return {
        buffer,
        emitRate: 10,
        updateSpeed: 0.0167,
        targetStopDuration: 0,
        blendMode: 2,
        texture: null,
        createLifeTime: null,
        createPosition: null,
        createDirection: null,
        createEmitPower: null,
        createSize: null,
        createAngle: null,
        createColor: null,
        createColorDead: null,
        updateSteps: [],
        _scaledStep: 0,
        _emitPower: 1,
        _scaledUpdateSpeed: 0,
        _newPartsExcess: 0,
        _started: false,
        _stopped: false,
        _disposed: false,
        _actualFrame: 0,
    };
}

/**
 * Start emission. With an installed SystemBlock lifecycle, start honors `doNoStart`, waits `delay`
 * (default `startDelay`) milliseconds, then synchronously pre-warms.
 */
export function startParticleSystem(system: ParticleSystem, delay?: number): void {
    if (system._disposed || system._lifecycle?._beforeStart?.(delay)) {
        return;
    }
    system._started = true;
    system._stopped = false;
    system._actualFrame = 0;
    system._lifecycle?._started?.();
}

/** Stop emission. Existing particles continue until they expire. */
export function stopParticleSystem(system: ParticleSystem): void {
    if (system._stopped || system._disposed) {
        return;
    }
    system._lifecycle?._stopped?.();
    system._stopped = true;
}

/** Dispose a particle system and release its owner-managed resources. */
export function disposeParticleSystem(system: ParticleSystem): void {
    if (system._disposed) {
        return;
    }
    system._disposed = true;
    system._started = false;
    system._stopped = true;
    system.buffer.alive = 0;
    const unregister = system._unregister;
    system._unregister = undefined;
    unregister?.();
    const lifecycle = system._lifecycle;
    system._lifecycle = undefined;
    lifecycle?._dispose?.();
}

/**
 * Advance the simulation by one step. `scaledRatio` multiplies the system's `updateSpeed`
 * (scene animation ratio for a live frame, or the pre-warm step offset).
 */
export function animateParticleSystem(system: ParticleSystem, scaledRatio: number): void {
    if (!system._started) {
        return;
    }

    system._prepareFrame?.();

    const scaledUpdateSpeed = system.updateSpeed * scaledRatio;
    system._scaledUpdateSpeed = scaledUpdateSpeed;
    let newParticles = system._lifecycle?._emit?.();
    if (newParticles === undefined) {
        const emitRate = system._emitRateGetter ? system._emitRateGetter() : system.emitRate;
        const emission = emitRate * scaledUpdateSpeed;
        newParticles = emission >> 0;
        system._newPartsExcess += emission - newParticles;
    }
    if (system._newPartsExcess > 1.0) {
        const extra = system._newPartsExcess >> 0;
        newParticles += extra;
        system._newPartsExcess -= extra;
    }

    if (system._stopped) {
        newParticles = 0;
    } else {
        system._actualFrame += scaledUpdateSpeed;
        if (system.targetStopDuration && system._actualFrame >= system.targetStopDuration) {
            stopParticleSystem(system);
        }
    }

    updateExisting(system, scaledUpdateSpeed);
    createNew(system, newParticles);

    if (system._stopped && system.buffer.alive === 0) {
        system._started = false;
    }
    system._lifecycle?._afterAnimate?.();
}

function updateExisting(system: ParticleSystem, scaledUpdateSpeed: number): void {
    const buffer = system.buffer;
    const age = buffer.age;
    const lifeTime = buffer.lifeTime;
    const steps = system.updateSteps;

    for (let i = 0; i < buffer.alive; i++) {
        let stepSpeed = scaledUpdateSpeed;
        const previousAge = age[i]!;
        age[i] = previousAge + stepSpeed;

        // Clamp the final partial step so a particle dies exactly at its lifetime (matches Babylon.js).
        if (age[i]! > lifeTime[i]!) {
            const diff = age[i]! - previousAge;
            const oldDiff = lifeTime[i]! - previousAge;
            stepSpeed = (oldDiff * stepSpeed) / diff;
            age[i] = lifeTime[i]!;
        }

        system._scaledStep = stepSpeed;
        for (let s = 0; s < steps.length; s++) {
            steps[s]!(i);
        }

        if (age[i]! >= lifeTime[i]!) {
            killParticle(buffer, i);
            i--;
        }
    }
}

function createNew(system: ParticleSystem, count: number): void {
    const buffer = system.buffer;

    for (let n = 0; n < count; n++) {
        const i = spawnParticle(buffer);
        if (i < 0) {
            break;
        }
        // Fixed Babylon.js creation-slot order (not graph order) — this is what keeps the per-particle
        // `Math.random()` sequence aligned with Babylon.js.
        if (system.createLifeTime) {
            system.createLifeTime(i);
        }
        if (system.createPosition) {
            system.createPosition(i);
        }
        if (system.createDirection) {
            system.createDirection(i);
        }
        if (system.createEmitPower) {
            system.createEmitPower(i);
        }
        if (system.createSize) {
            system.createSize(i);
        }
        if (system.createAngle) {
            system.createAngle(i);
        }
        if (system.createColor) {
            system.createColor(i);
        }
        if (system.createColorDead) {
            system.createColorDead(i);
        }
    }
}
