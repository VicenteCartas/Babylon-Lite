import {
    buildNodeParticleSet,
    createArcRotateCamera,
    createEngine,
    createSceneContext,
    parseNodeParticleSource,
    registerNodeParticleSet,
    registerScene,
    startEngine,
    startParticleSystem,
    type ParticleSystem,
} from "babylon-lite";
import { createNpeSprite2DFlareUrl } from "../shared/npe-sprite2d-fixture.js";
import { createscene330TriggerGraph, createscene331LifecycleGraph } from "../shared/scene330-sub-emitter-npe.js";

async function buildGraph(engine: Parameters<typeof buildNodeParticleSet>[0], scene: Parameters<typeof buildNodeParticleSet>[1], graph: object, x: number) {
    return buildNodeParticleSet(engine, scene, parseNodeParticleSource(graph), { emitter: { x, y: -0.6, z: 0 } });
}

function rootSystem(systems: readonly ParticleSystem[]): ParticleSystem {
    const system = systems.find((candidate) => !candidate.doNoStart);
    if (!system) {
        throw new Error("NPE sub-emitter demo has no root system");
    }
    return system;
}

async function main(): Promise<void> {
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const restart = document.getElementById("restartLifecycle") as HTMLButtonElement;
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    scene.clearColor = { r: 0.012, g: 0.018, b: 0.025, a: 1 };
    scene.camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 2, 5, { x: 0, y: 0.35, z: 0 });

    const flareUrl = await createNpeSprite2DFlareUrl();
    const [triggerSet, lifecycleSet] = await Promise.all([
        buildGraph(engine, scene, createscene330TriggerGraph(flareUrl, 120), -1.15),
        buildGraph(engine, scene, createscene331LifecycleGraph(flareUrl), 1.15),
    ]);

    registerNodeParticleSet(scene, triggerSet);
    registerNodeParticleSet(scene, lifecycleSet);
    const lifecycleRoot = rootSystem(lifecycleSet.systems);
    restart.addEventListener("click", () => startParticleSystem(lifecycleRoot));

    await registerScene(scene);
    await startEngine(engine);
    document.getElementById("loading")?.classList.add("is-hidden");
    canvas.dataset.ready = "true";
}

main().catch((error: unknown) => {
    console.error(error);
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
    if (canvas) {
        canvas.dataset.error = error instanceof Error ? error.message : String(error);
    }
});
