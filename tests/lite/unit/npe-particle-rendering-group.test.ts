import { describe, expect, it, vi } from "vitest";
import { getViewMatrix, type Camera } from "../../../packages/babylon-lite/src/camera/camera";
import type { Mat4 } from "../../../packages/babylon-lite/src/math/types";
import { applyParticleRenderingGroup } from "../../../packages/babylon-lite/src/particle/particle-rendering-group";
import type { DrawBinding, DrawUpdateContext, Renderable } from "../../../packages/babylon-lite/src/render/renderable";
import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import type { RenderTargetSignature } from "../../../packages/babylon-lite/src/engine/render-target";

function makeCamera(z: number): Camera {
    const worldMatrix = new Float64Array(16);
    worldMatrix[0] = worldMatrix[5] = worldMatrix[10] = worldMatrix[15] = 1;
    worldMatrix[14] = z;
    return {
        fov: Math.PI / 4,
        nearPlane: 0.1,
        farPlane: 100,
        children: [],
        worldMatrix: worldMatrix as unknown as Mat4,
        worldMatrixVersion: 1,
        _viewCache: new Float32Array(16),
        _projCache: new Float32Array(16),
        _vpCache: new Float32Array(16),
    };
}

function makeRenderable(center: [number, number, number], update = vi.fn()): Renderable {
    const renderable: Renderable = {
        order: 200,
        isTransparent: true,
        _worldCenter: center,
        bind: () => ({ renderable, pipeline: {} as GPURenderPipeline, update, draw: () => 1 }),
    };
    return renderable;
}

/** Mirrors the shared transparent sort distance in render-task-base. */
function sortDistance(binding: DrawBinding, camera: Camera): number {
    const view = getViewMatrix(camera);
    const center = binding.renderable._worldCenter!;
    return center[0] * view[2]! + center[1] * view[6]! + center[2] * view[10]! + view[14]!;
}

const ENGINE = {} as EngineContext;
const TARGET = {} as RenderTargetSignature;

describe("applyParticleRenderingGroup", () => {
    it("leaves group 0 renderables untouched", () => {
        const renderable = makeRenderable([0, 0, 5]);
        const bind = renderable.bind;
        applyParticleRenderingGroup(renderable, 0);

        expect(renderable.bind).toBe(bind);
    });

    it("draws later rendering groups after nearer lower-group transparents while keeping in-group distance order", () => {
        const camera = makeCamera(-10);
        const context: DrawUpdateContext = { targetWidth: 1, targetHeight: 1, _camera: camera };
        const nearGroupZero = makeRenderable([0, 0, -9]);
        const farGroupOne = makeRenderable([0, 0, 50]);
        const nearGroupOne = makeRenderable([0, 0, 5]);
        const farGroupTwo = makeRenderable([0, 0, 80]);
        applyParticleRenderingGroup(farGroupOne, 1);
        applyParticleRenderingGroup(nearGroupOne, 1);
        applyParticleRenderingGroup(farGroupTwo, 2);

        const bindings = [farGroupTwo, nearGroupOne, farGroupOne, nearGroupZero].map((renderable) => renderable.bind(ENGINE, TARGET));
        for (const binding of bindings) {
            binding.update?.(context);
        }
        const drawOrder = [...bindings].sort((a, b) => sortDistance(b, camera) - sortDistance(a, camera));

        expect(drawOrder.map((binding) => binding.renderable._worldCenter === nearGroupZero._worldCenter)).toEqual([true, false, false, false]);
        expect(drawOrder.slice(1).map((binding) => Object.getPrototypeOf(binding.renderable))).toEqual([farGroupOne, nearGroupOne, farGroupTwo]);
    });

    it("forwards updates and delegates renderable state to the sorted view", () => {
        const update = vi.fn();
        const renderable = makeRenderable([1, 2, 3], update);
        applyParticleRenderingGroup(renderable, 1);
        const binding = renderable.bind(ENGINE, TARGET);
        const context: DrawUpdateContext = { targetWidth: 1, targetHeight: 1, _camera: makeCamera(0) };
        binding.update?.(context);

        expect(update).toHaveBeenCalledWith(context);
        expect(binding.renderable.order).toBe(200);
        expect(binding.renderable.isTransparent).toBe(true);
        expect(renderable._worldCenter).toEqual([1, 2, 3]);
        expect(binding.draw({} as GPURenderPassEncoder, ENGINE)).toBe(1);
    });
});
