import { createParticleBlock } from "./blocks/create-particle-block.js";
import { systemBlock } from "./blocks/system-block.js";
import { particleTextureSourceBlock } from "./blocks/texture-source-block.js";
import { updatePositionBlock } from "./blocks/update-position-block.js";
import type { NpeBlockEvaluator } from "./npe-build.js";

/** Resolve evaluators that occur in every representative NPE runtime. */
export function loadLifecycleBlockEvaluator(className: string): NpeBlockEvaluator {
    switch (className) {
        case "SystemBlock":
            return systemBlock;
        case "CreateParticleBlock":
            return createParticleBlock;
        case "ParticleTextureSourceBlock":
            return particleTextureSourceBlock;
        case "UpdatePositionBlock":
            return updatePositionBlock;
        default:
            throw new Error(`NodeParticle: unsupported lifecycle block "${className}"`);
    }
}

export { loadLifecycleBlockEvaluator as load };
