import {
    animateParticleSystem,
    buildNodeParticleSet,
    createArcRotateCamera,
    createEngine,
    createSceneContext,
    parseNodeParticleSource,
    registerNodeParticleSet,
    registerScene,
    startEngine,
    startParticleSystem,
} from "babylon-lite";
import { createFeatureGraph } from "../shared/scene332-features-npe.js";

export async function runFeatureScene(sceneId: number): Promise<void> {
    const initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const largeWorld = sceneId === 337;
    const offset = largeWorld ? 1_000_000 : 0;
    const engine = await createEngine(canvas, largeWorld ? { useHighPrecisionMatrix: true, useFloatingOrigin: true } : {});
    const scene = createSceneContext(engine);
    scene.clearColor = { r: 0.008, g: 0.012, b: 0.018, a: 1 };
    scene.camera = createArcRotateCamera(-1.15, 1.1, 7, { x: offset, y: 0.3, z: offset });
    scene.camera.nearPlane = largeWorld ? 1 : 0.1;
    scene.camera.farPlane = 100;
    const set = await buildNodeParticleSet(engine, scene, parseNodeParticleSource(createFeatureGraph(sceneId, "https://playground.babylonjs.com/textures/flare.png")), {
        emitter: { x: offset, y: 0, z: offset },
    });
    let seed = 1;
    Math.random = () => {
        const value = Math.sin(seed++) * 10000;
        return value - Math.floor(value);
    };
    const seekTime = Number(new URLSearchParams(location.search).get("seekTime") ?? 1);
    for (const system of set.systems) {
        startParticleSystem(system);
        // Scene 333's screenshot is exclusively the synchronous prewarm state.
        if (sceneId !== 333) {
            for (let step = 0; step < Math.round(seekTime * 60); step++) {
                animateParticleSystem(system, 1);
            }
        }
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
