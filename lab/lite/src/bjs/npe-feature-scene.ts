import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { NodeParticleSystemSet } from "@babylonjs/core/Particles/Node/nodeParticleSystemSet";
import type { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Particles/Node/Blocks";
import "@babylonjs/core/Shaders/particles.fragment";
import "@babylonjs/core/Shaders/particles.vertex";
import { createFeatureGraph } from "../shared/scene332-features-npe.js";

export async function runFeatureScene(sceneId: number): Promise<void> {
    const initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const largeWorld = sceneId === 337;
    const offset = largeWorld ? 1_000_000 : 0;
    const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true, useLargeWorldRendering: largeWorld });
    await engine.initAsync();
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.008, 0.012, 0.018, 1);
    const camera = new ArcRotateCamera("camera", -1.15, 1.1, 7, new Vector3(offset, 0.3, offset), scene);
    camera.minZ = largeWorld ? 1 : 0.1;
    camera.maxZ = 100;
    scene.updateTransformMatrix(true);
    const set = NodeParticleSystemSet.Parse(createFeatureGraph(sceneId, "https://playground.babylonjs.com/textures/flare.png"));
    const built = await set.buildAsync(scene);
    for (const system of built.systems) {
        system.emitter = new Vector3(offset, 0, offset);
    }
    let seed = 1;
    Math.random = () => {
        const value = Math.sin(seed++) * 10000;
        return value - Math.floor(value);
    };
    const seekTime = Number(new URLSearchParams(location.search).get("seekTime") ?? 1);
    for (const system of built.systems) {
        system.start();
        if (sceneId !== 333) {
            for (let step = 0; step < Math.round(seekTime * 60); step++) {
                (system as ParticleSystem).animate(true);
            }
        }
        system.updateSpeed = 0;
    }
    await scene.whenReadyAsync();
    const engineWithDrawCalls = engine as unknown as { _drawCalls?: { current: number; fetchNewFrame?: () => void } };
    scene.onBeforeRenderObservable.add(() => engineWithDrawCalls._drawCalls?.fetchNewFrame?.());
    scene.onAfterRenderObservable.add(() => (canvas.dataset.drawCalls = String(engineWithDrawCalls._drawCalls?.current ?? 0)));
    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());
    await new Promise<void>((resolve) => scene.onAfterRenderObservable.addOnce(() => resolve()));
    canvas.dataset.initMs = String(performance.now() - initStart);
    canvas.dataset.animationFrozen = "true";
    canvas.dataset.ready = "true";
}
