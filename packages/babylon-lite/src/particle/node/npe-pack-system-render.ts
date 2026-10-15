import type { Color4, Vec2 } from "../../math/types.js";
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

/** Optional SystemBlock rendering; selection is performed once by the compiler. */
export const systemRenderBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        (ctx.isConnected(block, "emitRate") ? systemDynamicEmitRateBlock : systemBlock).build(block, ctx);
        const pivot = (ctx.input(block, "translationPivot", () => ({ x: 0, y: 0 }))(0) as Vec2 | null) || { x: 0, y: 0 };
        const mask = (ctx.input(block, "textureMask", () => ({ r: 1, g: 1, b: 1, a: 1 }))(0) as Color4 | null) ?? { r: 1, g: 1, b: 1, a: 1 };
        const properties: ParticleRenderProperties = {
            translationPivot: { x: pivot.x, y: pivot.y },
            textureMask: { r: mask.r, g: mask.g, b: mask.b, a: mask.a },
            renderingGroupId: typeof block.renderingGroupId === "number" ? block.renderingGroupId : 0,
        };
        const { system, isLocal, emitterWorldMatrix } = ctx.state;
        if (block.isBillboardBased === false || (block.billBoardMode ?? 7) !== 7) {
            const mode = resolveMode(block.isBillboardBased, block.billBoardMode);
            ctx.addBuildPromise(
                import("../particle-billboard-modes.js").then(({ installParticleBillboardMode }) =>
                    installParticleBillboardMode(system!, mode, properties, isLocal, emitterWorldMatrix)
                )
            );
        } else {
            ctx.addBuildPromise(
                import("../particle-billboard-render-properties.js").then(async ({ addFacingBillboardSystemWithParticleRenderProperties, loadParticleRenderPropertyResources }) => {
                    const resources = await loadParticleRenderPropertyResources();
                    system!._registerBillboard = (scene, billboard) =>
                        addFacingBillboardSystemWithParticleRenderProperties(scene, billboard, system!.blendMode, properties, resources);
                })
            );
        }
    },
};
