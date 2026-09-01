import { basicColorUpdateBlock } from "./blocks/basic-color-update-block.js";
import { basicPositionUpdateBlock } from "./blocks/basic-position-update-block.js";
import { updateAgeBlock } from "./blocks/update-age-block.js";
import { updateScaleBlock } from "./blocks/update-scale-block.js";
import type { NpeBlockEvaluator } from "./npe-build.js";

/** Core particle updates, kept in one lazy pack because these small blocks commonly form one update chain. */
export function loadCoreUpdateBlockEvaluator(className: string): NpeBlockEvaluator {
    switch (className) {
        case "UpdateScaleBlock":
            return updateScaleBlock;
        case "UpdateAgeBlock":
            return updateAgeBlock;
        case "BasicPositionUpdateBlock":
            return basicPositionUpdateBlock;
        case "BasicColorUpdateBlock":
            return basicColorUpdateBlock;
        default:
            throw new Error(`NodeParticle: unsupported core update block "${className}"`);
    }
}

export { loadCoreUpdateBlockEvaluator as load };
