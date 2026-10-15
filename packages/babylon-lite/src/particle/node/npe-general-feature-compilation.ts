import type { NpeBlockEvaluator } from "./npe-build.js";
import type { CompilableNodeParticleGraph, CompiledParticleBlock } from "./npe-types.js";
import { NODE_PARTICLE_CLASS_PREFIX_LENGTH, NPE_FEATURE_CONTEXTUAL_INT, NPE_TYPE_INT, NPE_CONTEXTUAL_SPRITE_CELL_INDEX, NPE_CONTEXTUAL_SPRITE_CELL_END } from "./npe-types.js";

/** Compile-away routing blocks require topology normalization. */
const GENERAL_FEATURE_TOPOLOGY = 1;
/** Int values require propagated value types and typed math evaluators. */
const GENERAL_FEATURE_VALUE_TYPES = 2;
/** Local variables install their optional evaluator after topology normalization. */
const GENERAL_FEATURE_LOCAL_VARIABLES = 4;

/** Compile graph topology and propagated value types behind the general feature boundary. */
export async function compileNodeParticleGeneralFeatures(
    parsed: CompilableNodeParticleGraph,
    loadEvaluator?: (block: CompiledParticleBlock) => Promise<NpeBlockEvaluator | undefined>
): Promise<{
    blocks: ReadonlyMap<number, CompiledParticleBlock>;
    systemBlockIds: readonly number[];
    loadEvaluator?: (block: CompiledParticleBlock) => Promise<NpeBlockEvaluator | undefined>;
}> {
    let features = parsed._features & NPE_FEATURE_CONTEXTUAL_INT ? GENERAL_FEATURE_VALUE_TYPES : 0;
    for (const block of parsed.blocks.values()) {
        const className = block.customType.slice(NODE_PARTICLE_CLASS_PREFIX_LENGTH);
        // These named block families share serialized affixes; explicit switches/arrays exceed the measured scene budget.
        features |= /^Particle(TeleportOut|LocalVariable|Elbow|Debug)Block$/.test(className)
            ? className === "ParticleLocalVariableBlock"
                ? GENERAL_FEATURE_TOPOLOGY | GENERAL_FEATURE_LOCAL_VARIABLES
                : GENERAL_FEATURE_TOPOLOGY
            : 0;
        features |=
            (className === "ParticleInputBlock" &&
                block.type === NPE_TYPE_INT &&
                !(
                    typeof block.contextualValue === "number" &&
                    block.contextualValue >= NPE_CONTEXTUAL_SPRITE_CELL_INDEX &&
                    block.contextualValue <= NPE_CONTEXTUAL_SPRITE_CELL_END
                )) ||
            /^Particle(FloatToInt|NumberMath|Clamp|Step)Block$/.test(className) ||
            block.inputs.some((input) => input.valueType === "int")
                ? GENERAL_FEATURE_VALUE_TYPES
                : 0;
    }

    const graph = features & GENERAL_FEATURE_TOPOLOGY ? (await import("./npe-graph-plumbing-runtime.js")).compileNodeParticleTopology(parsed) : parsed;
    if (features & GENERAL_FEATURE_LOCAL_VARIABLES) {
        const localVariableEvaluator = (await import("./blocks/particle-local-variable-block.js")).evaluator;
        const fallback = loadEvaluator;
        loadEvaluator = async (block) => (block.customType === "BABYLON.ParticleLocalVariableBlock" ? localVariableEvaluator : fallback?.(block));
    }
    let blocks: ReadonlyMap<number, CompiledParticleBlock> = graph.blocks;
    if (features & GENERAL_FEATURE_VALUE_TYPES) {
        const valueCompilation = await import("./npe-value-compilation.js");
        blocks = valueCompilation.compileNodeParticleValueTypes(blocks);
        if (loadEvaluator) {
            const extraEvaluator = loadEvaluator;
            loadEvaluator = async (block) => (await valueCompilation.loadNodeParticleValueMathEvaluator(block)) ?? extraEvaluator(block);
        } else {
            loadEvaluator = valueCompilation.loadNodeParticleValueMathEvaluator;
        }
    }
    return { blocks, systemBlockIds: graph.systemBlockIds, loadEvaluator };
}
