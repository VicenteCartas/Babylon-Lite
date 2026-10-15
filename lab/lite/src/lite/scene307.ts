// Scene 307: SystemBlock onStart and onEnd create distinct child particle systems.

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
    stopParticleSystem,
    type NodeParticleSet,
    type ParticleSystem,
} from "babylon-lite";
import { createScene307LifecycleGraph } from "../shared/scene306-sub-emitter-npe.js";

const START_STEPS = 6;
const END_STEPS = 9;
const TEXTURE_URL = "https://playground.babylonjs.com/textures/flare.png";

function rootSystem(set: NodeParticleSet): ParticleSystem {
    const system = set.systems.find((candidate) => !candidate.doNoStart);
    if (!system) {
        throw new Error("Scene 307 has no root particle system");
    }
    return system;
}

function stepSet(set: NodeParticleSet, root: ParticleSystem): void {
    animateParticleSystem(root, 1);
    for (const child of [...(set._children ?? [])]) {
        animateParticleSystem(child, 1);
    }
}

async function main(): Promise<void> {
    const initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.clearColor = { r: 0.008, g: 0.012, b: 0.018, a: 1 };
    scene.camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 2, 4.4, { x: 0, y: -0.05, z: 0 });

    const program = await compileNodeParticleGraph(parseNodeParticleSource(createScene307LifecycleGraph(TEXTURE_URL, 0)));
    const set = await buildNodeParticleSet(engine, scene, program, { emitter: { x: 0, y: -0.15, z: 0 } });
    const root = rootSystem(set);

    let seed = 1;
    Math.random = () => {
        const value = Math.sin(seed++) * 10000;
        return value - Math.floor(value);
    };

    startParticleSystem(root);
    for (let step = 0; step < START_STEPS; step++) {
        stepSet(set, root);
    }
    stopParticleSystem(root);
    for (let step = 0; step < END_STEPS; step++) {
        stepSet(set, root);
    }
    await Promise.all((set._childInstances ?? []).map((instance) => instance.ready));
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
