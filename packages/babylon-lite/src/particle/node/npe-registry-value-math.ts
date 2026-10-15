import type { NpeBlockEvaluator } from "./npe-build.js";
import type { CompiledParticleBlock } from "./npe-types.js";
import { NODE_PARTICLE_CLASS_PREFIX_LENGTH } from "./npe-types.js";

/** Resolve optional value-math evaluators from compiled block metadata. */
export async function loadNodeParticleValueMathEvaluator(block: CompiledParticleBlock): Promise<NpeBlockEvaluator | undefined> {
    switch (block._evaluatorClassName ?? block.customType.slice(NODE_PARTICLE_CLASS_PREFIX_LENGTH)) {
        case "ParticleNumberMathBlock":
            return (await import("./blocks/particle-number-math-block.js")).particleNumberMathBlock;
        case "ParticleIntMathBlock":
            return (await import("./blocks/particle-math-int-block.js")).particleIntMathBlock;
        case "ParticleIntMathAliasBlock":
            return (await import("./blocks/particle-math-int-block.js")).particleIntMathAliasBlock;
        case "ParticleClampBlock":
            return (await import("./blocks/particle-clamp-block.js")).particleClampBlock;
        case "ParticleStepBlock":
            return (await import("./blocks/particle-step-block.js")).particleStepBlock;
        default:
            return undefined;
    }
}
