import { getEffectiveAspectRatio, getViewProjectionMatrix } from "../../camera/camera.js";
import { allocateMat4 } from "../../math/_matrix-allocator.js";
import type { Mat4, Mat4Storage } from "../../math/types.js";
import type { NpeBuildState } from "./npe-build.js";
import type { NodeParticleSystemTemplate } from "./npe-types.js";

/** @internal Per-instance camera state consumed by an UpdateFlowMap evaluator. */
export interface FlowMapViewProjectionBinding {
    readonly matrix: Mat4;
    ready: boolean;
}

/** @internal Install the flow-map bindings declared by one system template. */
export function installNodeParticleFlowMapBindings(template: NodeParticleSystemTemplate, state: NpeBuildState): void {
    const requirements = template.bindings?.frame;
    if (!requirements?.length) {
        return;
    }
    const bindings = state._frameBindings ?? new Map<number, unknown>();
    state._frameBindings = bindings;
    for (const requirement of requirements) {
        if (requirement.kind !== "flowMapViewProjection") {
            continue;
        }
        const matrix = allocateMat4();
        const matrixStorage = matrix as unknown as Mat4Storage;
        const binding: FlowMapViewProjectionBinding = { matrix, ready: false };
        bindings.set(requirement.blockId, binding);
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
    }
}
