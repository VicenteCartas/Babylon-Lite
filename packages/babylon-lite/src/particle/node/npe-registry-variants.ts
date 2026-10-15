import type { NpeBlockEvaluator } from "./npe-build.js";
import type { ParsedParticleBlock } from "./npe-types.js";
import { detectSpriteCellFeatures } from "./npe-sprite-cell-features.js";

const loadSprite = () => import("./npe-pack-sprite.js");

/** Resolve serialized variants without retaining their runtime dispatch in compile-only consumers. */
export async function loadVariantBlockEvaluator(block: ParsedParticleBlock): Promise<NpeBlockEvaluator> {
    const contextualSource = typeof block.contextualValue === "number" ? block.contextualValue : 0;
    if (block.customType === "BABYLON.ParticleInputBlock" && contextualSource >= 0x10 && contextualSource <= 0x12) {
        return (await loadSprite()).load("ParticleInputBlock");
    }
    if (block.customType === "BABYLON.ParticleInputBlock" && contextualSource === 0x18) {
        return (await import("./blocks/particle-input-local-block.js")).evaluator;
    }
    return (await import("./npe-registry-variants-runtime.js")).load(block);
}

/** Resolve sprite blocks for programs already classified through the sprite-cell path. */
export async function loadSpriteBlockEvaluator(block: ParsedParticleBlock): Promise<NpeBlockEvaluator | undefined> {
    const className = block.customType.slice(8);
    return className.includes("Sprite") ? (await loadSprite()).load(className) : undefined;
}

export { detectSpriteCellFeatures as c, loadVariantBlockEvaluator as load, loadSpriteBlockEvaluator as s };
