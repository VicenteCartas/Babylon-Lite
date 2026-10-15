import type { Color4, Vec2 } from "../../math/types.js";
import { addFacingBillboardSystemWithParticleRenderProperties } from "../particle-billboard-render-properties.js";
import type { NpeBlockEvaluator } from "./npe-build.js";
import { systemBlock } from "./blocks/system-block.js";
import { systemDynamicEmitRateBlock } from "./blocks/system-dynamic-emit-rate-block.js";

const systemRenderPropertiesBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        (ctx.isConnected(block, "emitRate") ? systemDynamicEmitRateBlock : systemBlock).build(block, ctx);
        const pivot = (ctx.input(block, "translationPivot", () => ({ x: 0, y: 0 }))(0) as Vec2 | null) || { x: 0, y: 0 };
        const mask = (ctx.input(block, "textureMask", () => ({ r: 1, g: 1, b: 1, a: 1 }))(0) as Color4 | null) ?? { r: 1, g: 1, b: 1, a: 1 };
        const properties = {
            translationPivot: { x: pivot.x, y: pivot.y },
            textureMask: { r: mask.r, g: mask.g, b: mask.b, a: mask.a },
            renderingGroupId: typeof block.renderingGroupId === "number" ? block.renderingGroupId : 0,
        };
        const system = ctx.state.system!;
        system._registerBillboard = (scene, billboard) => addFacingBillboardSystemWithParticleRenderProperties(scene, billboard, system.blendMode, properties);
    },
};

/** Resolve the optional SystemBlock render-properties evaluator. */
export function loadRenderPropertiesBlockEvaluator(className: string): NpeBlockEvaluator {
    if (className === "SystemBlock") {
        return systemRenderPropertiesBlock;
    }
    throw new Error(`NodeParticle: unsupported render-properties block "${className}"`);
}

export { loadRenderPropertiesBlockEvaluator as load };
