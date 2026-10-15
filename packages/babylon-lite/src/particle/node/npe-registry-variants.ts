import type { NpeBlockEvaluator } from "./npe-build.js";
import type { ParsedParticleBlock } from "./npe-types.js";
import { NODE_PARTICLE_CLASS_PREFIX_LENGTH, NPE_CONTEXTUAL_SPRITE_CELL_INDEX, NPE_CONTEXTUAL_SPRITE_CELL_END, NPE_CONTEXTUAL_LOCAL_POSITION_UPDATED } from "./npe-types.js";
import { detectSpriteCellFeatures } from "./npe-sprite-cell-features.js";

const loadSprite = () => import("./npe-pack-sprite.js");

/** Resolve serialized variants without retaining their runtime dispatch in compile-only consumers. */
export async function loadVariantBlockEvaluator(block: ParsedParticleBlock): Promise<NpeBlockEvaluator> {
    const contextualSource = typeof block.contextualValue === "number" ? block.contextualValue : 0;
    if (block.customType === "BABYLON.ParticleInputBlock" && contextualSource >= NPE_CONTEXTUAL_SPRITE_CELL_INDEX && contextualSource <= NPE_CONTEXTUAL_SPRITE_CELL_END) {
        return (await loadSprite()).load("ParticleInputBlock");
    }
    if (block.customType === "BABYLON.ParticleInputBlock" && contextualSource === NPE_CONTEXTUAL_LOCAL_POSITION_UPDATED) {
        return (await import("./blocks/particle-input-local-block.js")).evaluator;
    }
    return (await import("./npe-registry-variants-runtime.js")).load(block);
}

/** Resolve sprite blocks for programs already classified through the sprite-cell path. */
export async function loadSpriteBlockEvaluator(block: ParsedParticleBlock): Promise<NpeBlockEvaluator | undefined> {
    const className = block.customType.slice(NODE_PARTICLE_CLASS_PREFIX_LENGTH);
    return className.includes("Sprite") ? (await loadSprite()).load(className) : undefined;
}

// Dynamic-import namespace keys survive minification; compact aliases keep every NPE caller's payload small.
export { detectSpriteCellFeatures as c, loadVariantBlockEvaluator as load, loadSpriteBlockEvaluator as loadSprite };
