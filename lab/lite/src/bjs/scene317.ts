// Babylon.js reference for Scene 317. It consumes the same serialized SystemBlock lifecycle graph as Lite.

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { NodeParticleSystemSet } from "@babylonjs/core/Particles/Node/nodeParticleSystemSet";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Particles/Node/Blocks";
import "@babylonjs/core/Shaders/particles.fragment";
import "@babylonjs/core/Shaders/particles.vertex";
import { createScene317LifecycleGraph } from "../shared/scene316-sub-emitter-npe.js";

const START_STEPS = 6;
const END_STEPS = 9;
const TEXTURE_URL = "https://playground.babylonjs.com/textures/flare.png";

(async function () {
    const initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
    await engine.initAsync();
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.008, 0.012, 0.018, 1);
    const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2, 4.4, new Vector3(0, -0.05, 0), scene);
    camera.minZ = 0.1;
    camera.maxZ = 100;

    const set = NodeParticleSystemSet.Parse(createScene317LifecycleGraph(TEXTURE_URL, 0));
    const built = await set.buildAsync(scene);
    const root = built.systems.at(-1) as ParticleSystem | undefined;
    if (!root) {
        throw new Error("Scene 317 has no root particle system");
    }
    root.emitter = new Vector3(0, -0.15, 0);

    let seed = 1;
    Math.random = () => {
        const value = Math.sin(seed++) * 10000;
        return value - Math.floor(value);
    };

    const stepChildren = () => {
        root.animate(true);
        for (const child of [...scene.particleSystems].filter((system) => !built.systems.includes(system))) {
            (child as ParticleSystem).animate(true);
        }
    };
    root.start();
    for (let step = 0; step < START_STEPS; step++) {
        stepChildren();
    }
    root.stop();
    for (let step = 0; step < END_STEPS; step++) {
        stepChildren();
    }
    await scene.whenReadyAsync();
    for (const system of scene.particleSystems) {
        system.updateSpeed = 0;
    }

    const engineWithDrawCalls = engine as unknown as { _drawCalls?: { current: number; fetchNewFrame?: () => void } };
    scene.onBeforeRenderObservable.add(() => engineWithDrawCalls._drawCalls?.fetchNewFrame?.());
    scene.onAfterRenderObservable.add(() => (canvas.dataset.drawCalls = String(engineWithDrawCalls._drawCalls?.current ?? 0)));
    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());
    await new Promise<void>((resolve) => scene.onAfterRenderObservable.addOnce(() => resolve()));
    canvas.dataset.initMs = String(performance.now() - initStart);
    canvas.dataset.animationFrozen = "true";
    canvas.dataset.ready = "true";
})().catch((error) => {
    console.error(error);
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
    if (canvas) {
        canvas.dataset.error = String(error);
    }
});
