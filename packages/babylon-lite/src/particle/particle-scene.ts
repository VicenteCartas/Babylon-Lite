import { animateParticleSystem, disposeParticleSystem, startParticleSystem, type ParticleSystem } from "./particle-system.js";
import { createParticleBillboard, syncParticleBillboard } from "./particle-billboard.js";
import { addParticleSceneRenderable } from "./particle-scene-renderable.js";
import type { SceneContext } from "../scene/scene.js";
import type { FacingBillboardSpriteSystem } from "../sprite/billboard-sprite.js";
import type { NodeParticleSet } from "./node/node-particle.js";

/** One simulated frame at 60 fps, used to convert frame delta time to an update-speed ratio. */
const FRAME_MS = 1000 / 60;

/** Options for {@link registerNodeParticleSet}. */
export interface RegisterNodeParticleOptions {
    /** Start emission immediately (default `true`). */
    autoStart?: boolean;
}

function addParticleBillboard(scene: SceneContext, billboard: FacingBillboardSpriteSystem): () => void {
    return addParticleSceneRenderable(
        scene,
        billboard,
        () => import("../picking/billboard-pick-pipeline.js"),
        async (engine) => (await import("./particle-billboard-renderer.js")).buildBillboardRenderable(engine, billboard, false)
    );
}

function registerSystem(scene: SceneContext, system: ParticleSystem): void {
    if (system._disposed || system._unregister) {
        return;
    }
    const billboard = createParticleBillboard(system);
    const unregisterBillboard = (system._registerBillboard ?? addParticleBillboard)(scene, billboard);
    let active = true;
    const tick = (deltaMs: number) => {
        if (!active) {
            return;
        }
        const ratio = deltaMs > 0 ? deltaMs / FRAME_MS : 1;
        animateParticleSystem(system, ratio);
        (system._syncBillboard ?? syncParticleBillboard)(system, billboard);
    };
    scene._beforeRender.push(tick);
    system._unregister = () => {
        active = false;
        // Systems can dispose from inside a tick; splicing now would skip the next callback of the frame loop.
        queueMicrotask(() => {
            const index = scene._beforeRender.indexOf(tick);
            if (index !== -1) {
                scene._beforeRender.splice(index, 1);
            }
        });
        unregisterBillboard();
    };
}

/**
 * Register a built node particle set with the scene: each system is rendered as a camera-facing billboard
 * system and advanced once per frame (scaled by the real frame delta). Use this for live/interactive scenes.
 * Deterministic parity scenes drive the simulation manually instead (seed RNG → step N → sync → freeze).
 */
export function registerNodeParticleSet(scene: SceneContext, set: NodeParticleSet, options: RegisterNodeParticleOptions = {}): void {
    const autoStart = options.autoStart ?? true;
    for (const system of set.systems) {
        registerSystem(scene, system);
    }
    if (autoStart) {
        for (const system of set.systems) {
            startParticleSystem(system);
        }
    }

    scene._disposables.push(() => {
        for (const system of set.systems) {
            disposeParticleSystem(system);
        }
    });
}
