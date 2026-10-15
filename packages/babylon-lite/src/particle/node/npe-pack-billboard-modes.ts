import type { Color4, Vec2 } from "../../math/types.js";
import { installParticleBillboardMode } from "../particle-billboard-modes.js";
import type { ParticleBillboardMode } from "../particle-billboard-modes.js";
import type { ParticleRenderProperties } from "../particle-billboard-render-properties.js";
import type { NpeBlockEvaluator } from "./npe-build.js";
import { systemBlock } from "./blocks/system-block.js";
import { systemDynamicEmitRateBlock } from "./blocks/system-dynamic-emit-rate-block.js";

function resolveMode(isBillboardBased: unknown, serializedMode: unknown): ParticleBillboardMode {
    if (isBillboardBased === false) {
        return 0;
    }
    const mode = typeof serializedMode === "number" ? serializedMode : 7;
    if (mode === 2 || mode === 8 || mode === 9) {
        return mode;
    }
    throw new Error(`NodeParticle: unsupported billboard mode ${mode}`);
}

const systemBillboardModesBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        (ctx.isConnected(block, "emitRate") ? systemDynamicEmitRateBlock : systemBlock).build(block, ctx);
        const pivot = (ctx.input(block, "translationPivot", () => ({ x: 0, y: 0 }))(0) as Vec2 | null) || { x: 0, y: 0 };
        const mask = (ctx.input(block, "textureMask", () => ({ r: 1, g: 1, b: 1, a: 1 }))(0) as Color4 | null) ?? { r: 1, g: 1, b: 1, a: 1 };
        const properties: ParticleRenderProperties = {
            translationPivot: { x: pivot.x, y: pivot.y },
            textureMask: { r: mask.r, g: mask.g, b: mask.b, a: mask.a },
            renderingGroupId: typeof block.renderingGroupId === "number" ? block.renderingGroupId : 0,
        };
        installParticleBillboardMode(ctx.state.system!, resolveMode(block.isBillboardBased, block.billBoardMode), properties, ctx.state.isLocal, ctx.state.emitterWorldMatrix);
    },
};

/** Resolve the optional SystemBlock billboard-mode evaluator. */
export function loadBillboardModesBlockEvaluator(className: string): NpeBlockEvaluator {
    if (className === "SystemBlock") {
        return systemBillboardModesBlock;
    }
    throw new Error(`NodeParticle: unsupported billboard-modes block "${className}"`);
}

export { loadBillboardModesBlockEvaluator as load };
