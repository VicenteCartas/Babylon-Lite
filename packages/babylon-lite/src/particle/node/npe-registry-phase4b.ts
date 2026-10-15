import type { NpeBlockEvaluator } from "./npe-build.js";

/** Resolve Phase 4B value blocks only after ordinary value evaluators miss. */
export async function loadPhase4BValueBlockEvaluator(className: string): Promise<NpeBlockEvaluator> {
    switch (className) {
        case "ParticleTrigonometryBlock":
            return (await import("./blocks/particle-trigonometry-block.js")).evaluator;
        case "ParticleVectorMathBlock":
            return (await import("./blocks/particle-vector-math-block.js")).evaluator;
        case "ParticleSmoothStepBlock":
            return (await import("./blocks/particle-smooth-step-block.js")).evaluator;
        case "ParticleNLerpBlock":
            return (await import("./blocks/particle-nlerp-block.js")).evaluator;
        default:
            throw new Error(`NodeParticle: unsupported value block "${className}"`);
    }
}

export { loadPhase4BValueBlockEvaluator as load };
