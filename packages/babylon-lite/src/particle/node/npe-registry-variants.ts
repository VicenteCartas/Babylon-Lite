import type { NpeBlockEvaluator } from "./npe-build.js";
import type { CompiledParticleBlock, ParsedParticleBlock } from "./npe-types.js";

const loadSprite = () => import("./npe-pack-sprite.js");

/** Detect value compilation needed by contextual sprite-cell Int sources. */
export async function c(blocks: ReadonlyMap<number, CompiledParticleBlock>): Promise<0 | 0x11> {
    return (await loadSprite()).detect(blocks);
}

/** Resolve serialized variants that should add zero loader bytes to ordinary block instances. */
export async function loadVariantBlockEvaluator(block: ParsedParticleBlock): Promise<NpeBlockEvaluator> {
    if (block.customType === "BABYLON.ParticleInputBlock" && typeof block.contextualValue === "number" && block.contextualValue >= 0x10 && block.contextualValue <= 0x12) {
        return (await loadSprite()).load("ParticleInputBlock");
    }
    if (block.customType === "BABYLON.ParticleInputBlock" && block.contextualValue === 0x18) {
        return (await import("./blocks/particle-input-local-block.js")).evaluator;
    }
    if (block.customType === "BABYLON.SetupSpriteSheetBlock" && block.randomStartCell === true) {
        return (await loadSprite()).loadRandomStartSpriteBlockEvaluator();
    }
    return (await import("./npe-registry-variants-extra.js")).load(block);
}

export { loadVariantBlockEvaluator as load };
