import { allocateMat4 } from "../../math/_matrix-allocator.js";
import { getViewMatrix } from "../../camera/camera.js";
import { transformNormalToRef } from "../../math/mat4-transform.js";
import type { Mat4Storage, Vec3 } from "../../math/types.js";
import type { SceneContext } from "../../scene/scene.js";
import type { NpeBlockEvaluator, NpeBuildState } from "./npe-build.js";

type CameraBinding = NonNullable<NpeBuildState["_cameraBinding"]>;

function refreshCameraBinding(binding: CameraBinding, scene: SceneContext): void {
    const camera = scene.camera;
    const position = binding.position;
    if (!camera) {
        position.x = 0;
        position.y = 0;
        position.z = 0;
        binding.ready = false;
        return;
    }

    const world = camera.worldMatrix;
    position.x = world[12]!;
    position.y = world[13]!;
    position.z = world[14]!;
    binding.ready = true;
    if (binding.view) {
        (binding.view as unknown as Mat4Storage).set(getViewMatrix(camera) as unknown as Mat4Storage);
    }
}

function getCameraBinding(state: NpeBuildState, needsView: boolean): CameraBinding {
    let binding = state._cameraBinding;
    if (!binding) {
        binding = { position: { x: 0, y: 0, z: 0 }, ready: false };
        state._cameraBinding = binding;
        const previous = state.system!._prepareFrame;
        const scene = state.scene;
        const created = binding;
        state.system!._prepareFrame = () => {
            previous?.();
            refreshCameraBinding(created, scene);
        };
    }
    if (needsView && !binding.view) {
        binding.view = allocateMat4();
    }
    refreshCameraBinding(binding, state.scene);
    return binding;
}

const cameraPositionBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        const position = getCameraBinding(ctx.state, false).position;
        ctx.setOutput(block.id, "output", () => position);
    },
};

const alignAngleBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        const binding = getCameraBinding(ctx.state, true);
        const transformed: Vec3 = { x: 0, y: 0, z: 0 };
        const alignment = typeof block.alignment === "number" ? block.alignment : Math.PI / 2;
        const buffer = ctx.state.buffer!;
        ctx.state.system!.updateSteps.push((index) => {
            if (!binding.ready) {
                return;
            }
            transformNormalToRef(buffer.dirX[index]!, buffer.dirY[index]!, buffer.dirZ[index]!, binding.view!, transformed);
            buffer.angle[index] = Math.atan2(transformed.y, transformed.x) + alignment;
        });
    },
};

/** Resolve camera-dependent input and update evaluators from one optional pack. */
export function loadCameraBlockEvaluator(className: string): NpeBlockEvaluator {
    switch (className) {
        case "ParticleInputBlock":
            return cameraPositionBlock;
        case "AlignAngleBlock":
            return alignAngleBlock;
        default:
            throw new Error(`NodeParticle: unsupported camera block "${className}"`);
    }
}

export { loadCameraBlockEvaluator as load };
