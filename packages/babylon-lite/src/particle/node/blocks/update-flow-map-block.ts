import { transformCoordinatesToRef } from "../../../math/mat4-transform.js";
import type { Mat4, Vec3 } from "../../../math/types.js";
import type { ParticleBuffer } from "../../particle-buffer.js";
import type { NpeBlockEvaluator } from "../npe-build.js";
import type { FlowMapViewProjectionBinding } from "../npe-flow-map-frame-binding.js";
import { loadNpeTextureContent } from "../npe-texture-content.js";
import type { NpeTextureContent, NpeTextureValue } from "../npe-value.js";

/** Apply one screen-space flow-map sample to a particle direction. */
function applyFlowMapToParticle(map: NpeTextureContent, matrix: Mat4, scaledStrength: number, buffer: ParticleBuffer, i: number, screen: Vec3): void {
    transformCoordinatesToRef(buffer.posX[i]!, buffer.posY[i]!, buffer.posZ[i]!, matrix, screen);
    const x = Math.floor((screen.x * 0.5 + 0.5) * map.width);
    const y = Math.floor((1 - (screen.y * 0.5 + 0.5)) * map.height);
    if (x < 0 || x >= map.width || y < 0 || y >= map.height) {
        return;
    }

    const index = (y * map.width + x) * 4;
    const scale = scaledStrength * (map.data[index + 3]! / 255);
    buffer.dirX[i] = buffer.dirX[i]! + ((map.data[index]! / 255) * 2 - 1) * scale;
    buffer.dirY[i] = buffer.dirY[i]! + ((map.data[index + 1]! / 255) * 2 - 1) * scale;
    buffer.dirZ[i] = buffer.dirZ[i]! + ((map.data[index + 2]! / 255) * 2 - 1) * scale;
}

/** `UpdateFlowMapBlock` — update particle direction from a projected RGBA flow field. */
export const updateFlowMapBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        const system = ctx.state.system!;
        const buffer = ctx.state.buffer!;
        const sourceValue = ctx.input(block, "flowMap")(0) as unknown as NpeTextureValue;
        const strengthGetter = ctx.input(block, "strength", () => 1);
        const screen: Vec3 = { x: 0, y: 0, z: 0 };
        const binding = ctx.state._frameBindings?.get(block.id) as FlowMapViewProjectionBinding | undefined;
        if (!binding) {
            throw new Error(`NodeParticle: UpdateFlowMapBlock ${block.id} requires its compiled frame binding`);
        }
        let flowMap: NpeTextureContent | null = null;

        if (sourceValue?.url) {
            ctx.addBuildPromise(
                loadNpeTextureContent(sourceValue)
                    .then((content) => {
                        flowMap = content;
                    })
                    .catch(() => undefined)
            );
        }

        system.updateSteps.push((i) => {
            if (!flowMap || !binding.ready) {
                return;
            }
            applyFlowMapToParticle(flowMap, binding.matrix, (strengthGetter(i) as number) * system._scaledStep, buffer, i, screen);
        });
    },
};
