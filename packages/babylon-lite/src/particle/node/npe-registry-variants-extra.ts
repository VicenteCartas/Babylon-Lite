import type { NpeBlockEvaluator } from "./npe-build.js";
import type { ParsedParticleBlock } from "./npe-types.js";

/** Resolve serialized variants outside the contextual sprite-cell family. */
export async function loadVariantBlockEvaluator(block: ParsedParticleBlock): Promise<NpeBlockEvaluator> {
    const className = block.customType.slice(8);
    switch (className) {
        case "ParticleInputBlock":
            return (await import("./npe-registry-input-extra.js")).load();
        case "ParticleMathBlock":
            return (await import("./blocks/particle-math-block.js")).evaluator;
        case "ParticleRandomBlock": {
            const valueType =
                block.inputs.find((input) => input.name.trim() === "min")?.valueType ?? block.inputs.find((input) => input.name.trim() === "max")?.valueType ?? "number";
            if (valueType[0] === "B") {
                return (await import("./blocks/particle-random-once-typed-block.js")).evaluator;
            }
            return (await import("./blocks/particle-random-once-block.js")).evaluator;
        }
        case "SystemBlock":
            return (await import("./blocks/system-dynamic-emit-rate-block.js")).evaluator;
        default:
            throw new Error(`NodeParticle: unsupported block variant "${className}"`);
    }
}

export { loadVariantBlockEvaluator as load };
