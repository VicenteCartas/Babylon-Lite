import type { CompiledParticleBlock, ParsedParticleBlock } from "./npe-types.js";
import { resolveParticleValueTypes } from "./blocks/particle-value-type.js";
export { loadNodeParticleValueMathEvaluator } from "./npe-registry-value-math.js";

/** Compile propagated value types and evaluator variants into temporary block metadata. */
export function compileNodeParticleValueTypes(blocks: ReadonlyMap<number, ParsedParticleBlock>): ReadonlyMap<number, CompiledParticleBlock> {
    return resolveParticleValueTypes(blocks);
}
