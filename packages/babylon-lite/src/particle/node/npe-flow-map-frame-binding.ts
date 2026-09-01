import { getEffectiveAspectRatio, getViewProjectionMatrix } from "../../camera/camera.js";
import { allocateMat4 } from "../../math/_matrix-allocator.js";
import type { Mat4, Mat4Storage } from "../../math/types.js";
import type { NpeBuildState } from "./npe-build.js";

/** @internal Per-instance camera state consumed by an UpdateFlowMap evaluator. */
export interface FlowMapViewProjectionBinding {
    readonly matrix: Mat4;
    ready: boolean;
}

/** @internal Create one per-instance camera binding for an UpdateFlowMap evaluator. */
export function createNodeParticleFlowMapBinding(state: NpeBuildState): FlowMapViewProjectionBinding {
    const matrix = allocateMat4();
    const matrixStorage = matrix as unknown as Mat4Storage;
    const binding: FlowMapViewProjectionBinding = { matrix, ready: false };
    const prepare = (): void => {
        const camera = state.scene.camera;
        if (!camera) {
            binding.ready = false;
            return;
        }
        const canvas = state.scene.surface.canvas;
        const targetWidth = Number.isFinite(canvas.width) && canvas.width > 0 ? Math.max(1, canvas.width) : 1;
        const targetHeight = Number.isFinite(canvas.height) && canvas.height > 0 ? Math.max(1, canvas.height) : 1;
        matrixStorage.set(getViewProjectionMatrix(camera, getEffectiveAspectRatio(camera, targetWidth, targetHeight)) as unknown as Mat4Storage);
        binding.ready = true;
    };
    prepare();
    state.scene._beforeRender.push(prepare);
    return binding;
}
