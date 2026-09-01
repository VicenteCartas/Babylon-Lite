import { particleConverterBlock } from "./blocks/particle-converter-block.js";
import { particleInputBlock } from "./blocks/particle-input-block.js";
import { particleLerpBlock } from "./blocks/particle-lerp-block.js";
import { particleMathCompactBlock } from "./blocks/particle-math-compact-block.js";
import { particleRandomBlock } from "./blocks/particle-random-block.js";
import { updateColorBlock } from "./blocks/update-color-block.js";
import type { NpeBlockEvaluator } from "./npe-build.js";

/** Resolve the ordinary value chain shared by value-driven NPE graphs. */
export function loadStandardValueBlockEvaluator(className: string): NpeBlockEvaluator {
    switch (className) {
        case "ParticleInputBlock":
            return particleInputBlock;
        case "ParticleRandomBlock":
            return particleRandomBlock;
        case "ParticleMathBlock":
            return particleMathCompactBlock;
        case "ParticleLerpBlock":
            return particleLerpBlock;
        case "ParticleConverterBlock":
            return particleConverterBlock;
        case "UpdateColorBlock":
            return updateColorBlock;
        default:
            throw new Error(`NodeParticle: unsupported standard value block "${className}"`);
    }
}

export { loadStandardValueBlockEvaluator as load };
