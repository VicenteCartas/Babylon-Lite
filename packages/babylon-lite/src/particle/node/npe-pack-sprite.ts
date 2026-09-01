import { basicSpriteUpdateBlock } from "./blocks/basic-sprite-update-block.js";
import { detectSpriteCellFeatures, particleInputSpriteCellBlock } from "./blocks/particle-input-sprite-cell-block.js";
import { setupSpriteSheetBlock } from "./blocks/setup-sprite-sheet-block.js";
import { updateSpriteCellIndexBlock } from "./blocks/update-sprite-cell-index-block.js";
import type { NpeBlockEvaluator } from "./npe-build.js";

/** Resolve sprite-sheet setup, updates, contextual values, and serialized setup variants. */
export function loadSpriteBlockEvaluator(className: string): NpeBlockEvaluator {
    switch (className) {
        case "SetupSpriteSheetBlock":
            return setupSpriteSheetBlock;
        case "BasicSpriteUpdateBlock":
            return basicSpriteUpdateBlock;
        case "UpdateSpriteCellIndexBlock":
            return updateSpriteCellIndexBlock;
        case "ParticleInputBlock":
            return particleInputSpriteCellBlock;
        default:
            throw new Error(`NodeParticle: unsupported sprite block "${className}"`);
    }
}

/** Load the mutually exclusive random-start setup leaf only when selected by serialized data. */
export async function loadRandomStartSpriteBlockEvaluator(): Promise<NpeBlockEvaluator> {
    return (await import("./blocks/setup-sprite-sheet-random-block.js")).setupSpriteSheetRandomBlock;
}

export { detectSpriteCellFeatures as detect, loadSpriteBlockEvaluator as load };
