import type { NpeBlockEvaluator } from "./npe-build.js";

/** Optional scalar/vector utility blocks used by converted Change graphs. */
export async function loadValueBlockEvaluator(className: string): Promise<NpeBlockEvaluator> {
    switch (className) {
        case "ParticleConditionBlock":
            return (await import("./blocks/particle-condition-block.js")).evaluator;
        case "ParticleFloatToIntBlock":
            return (await import("./blocks/particle-float-to-int-block.js")).evaluator;
        case "ParticleVectorLengthBlock":
            return (await import("./blocks/particle-vector-length-block.js")).evaluator;
        case "ParticleLocalVariableBlock":
            return (await import("./blocks/particle-local-variable-block.js")).evaluator;
        default:
            return (await import("./npe-registry-phase4b.js")).load(className);
    }
}
