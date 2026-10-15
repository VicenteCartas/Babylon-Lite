import type { NpeBlockEvaluator } from "./npe-build.js";

const loadSprite = () => import("./npe-pack-sprite.js");

/** Resolve optional blocks after the base registry misses. This entire loader table is a lazy chunk. */
export async function loadExtraBlockEvaluator(className: string): Promise<NpeBlockEvaluator> {
    switch (className) {
        case "UpdateSizeBlock":
            return (await import("./blocks/update-size-block.js")).updateSizeBlock;
        case "ParticleGradientBlock":
            return (await import("./blocks/particle-gradient-block.js")).particleGradientBlock;
        case "ParticleGradientValueBlock":
            return (await import("./blocks/particle-gradient-value-block.js")).particleGradientValueBlock;
        case "SetupSpriteSheetBlock":
        case "BasicSpriteUpdateBlock":
        case "UpdateSpriteCellIndexBlock":
            return (await loadSprite()).load(className);
        default:
            return (await import("./npe-registry-extra-remaining.js")).loadRemainingBlockEvaluator(className);
    }
}

export { loadExtraBlockEvaluator as load };
