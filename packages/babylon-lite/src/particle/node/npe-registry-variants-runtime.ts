import type { NpeBlockEvaluator } from "./npe-build.js";
import type { ParsedParticleBlock } from "./npe-types.js";

const loadSprite = () => import("./npe-pack-sprite.js");

/** Resolve serialized variants outside the direct contextual-input paths. */
export async function loadVariantBlockEvaluator(block: ParsedParticleBlock): Promise<NpeBlockEvaluator> {
    if (block.customType === "BABYLON.SetupSpriteSheetBlock" && block.randomStartCell === true) {
        return (await loadSprite()).loadRandomStartSpriteBlockEvaluator();
    }
    return (await import("./npe-registry-variants-extra.js")).load(block);
}

export { loadVariantBlockEvaluator as load };
