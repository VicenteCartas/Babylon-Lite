import type { CompiledParticleBlock, NodeParticleProgram, ParsedParticleBlock } from "./npe-types.js";
import { resolveParticleValueTypes } from "./blocks/particle-value-type.js";
import { loadNpeBlockEvaluator } from "./npe-registry.js";

/** Compile propagated value types and evaluator variants into copied block metadata. */
export function compileNodeParticleValueTypes(blocks: ReadonlyMap<number, ParsedParticleBlock>): ReadonlyMap<number, CompiledParticleBlock> {
    return resolveParticleValueTypes(blocks);
}

/** Resolve value-math evaluators selected by compilation. */
export const loadNodeParticleValueMathEvaluator: NonNullable<NodeParticleProgram["_loadEvaluator"]> = async (block) => {
    const evaluator = await (await import("./npe-registry-value-math.js")).loadNodeParticleValueMathEvaluator(block as CompiledParticleBlock);
    return evaluator ?? loadNpeBlockEvaluator(block.className);
};
