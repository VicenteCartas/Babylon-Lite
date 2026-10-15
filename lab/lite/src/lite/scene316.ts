// Scene 316: ParticleTriggerBlock creates child systems at the updated parent-particle position.

import {
    animateParticleSystem,
    buildNodeParticleSet,
    compileNodeParticleGraph,
    createArcRotateCamera,
    createEngine,
    createSceneContext,
    parseNodeParticleSource,
    registerNodeParticleSet,
    registerScene,
    startEngine,
    startParticleSystem,
    type NodeParticleSet,
    type ParticleSystem,
} from "babylon-lite";
import { createScene316TriggerGraph } from "../shared/scene316-sub-emitter-npe.js";

const STEPS = 14;
const TEXTURE_URL = "https://playground.babylonjs.com/textures/flare.png";

function rootSystem(set: NodeParticleSet): ParticleSystem {
    const system = set.systems.find((candidate) => !candidate.doNoStart);
    if (!system) {
        throw new Error("Scene 316 has no root particle system");
    }
    return system;
}

async function main(): Promise<void> {
    const initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.clearColor = { r: 0.008, g: 0.012, b: 0.018, a: 1 };
    scene.camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 2, 4.6, { x: 0.05, y: 0.3, z: 0 });

    const program = await compileNodeParticleGraph(parseNodeParticleSource(createScene316TriggerGraph(TEXTURE_URL)));
    const set = await buildNodeParticleSet(engine, scene, program, { emitter: { x: -0.65, y: -0.45, z: 0 } });
    const root = rootSystem(set);

    let seed = 1;
    Math.random = () => {
        const value = Math.sin(seed++) * 10000;
        return value - Math.floor(value);
    };

    startParticleSystem(root);
    for (let step = 0; step < STEPS; step++) {
        animateParticleSystem(root, 1);
        for (const child of [...(set._children ?? [])]) {
            animateParticleSystem(child, 1);
        }
    }
    for (const system of [...set.systems, ...(set._children ?? [])]) {
        system.updateSpeed = 0;
    }

    registerNodeParticleSet(scene, set, { autoStart: false });
    await registerScene(scene);
    await startEngine(engine);

    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.initMs = String(performance.now() - initStart);
    canvas.dataset.animationFrozen = "true";
    canvas.dataset.ready = "true";
}

main().catch((error) => {
    console.error(error);
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
    if (canvas) {
        canvas.dataset.error = String(error instanceof Error ? error.message : error);
    }
});
