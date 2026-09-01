import type { NpeBlockEvaluator } from "./npe-build.js";
import type { CompilableNodeParticleGraph, CompiledParticleBlock } from "./npe-types.js";

/** Compile graph topology and propagated value types behind the general feature boundary. */
export async function compileNodeParticleGeneralFeatures(
    parsed: CompilableNodeParticleGraph,
    loadEvaluator?: (block: CompiledParticleBlock) => Promise<NpeBlockEvaluator | undefined>
): Promise<{
    blocks: ReadonlyMap<number, CompiledParticleBlock>;
    systemBlockIds: readonly number[];
    loadEvaluator?: (block: CompiledParticleBlock) => Promise<NpeBlockEvaluator | undefined>;
}> {
    let features = parsed._features & 0x10 ? 2 : 0;
    for (const block of parsed.blocks.values()) {
        const className = block.customType.slice(8);
        features |= /^Particle(TeleportOut|LocalVariable|Elbow|Debug)Block$/.test(className) ? 1 : 0;
        features |=
            (className === "ParticleInputBlock" &&
                block.type === 0x0001 &&
                !(typeof block.contextualValue === "number" && block.contextualValue >= 0x10 && block.contextualValue <= 0x12)) ||
            /^Particle(FloatToInt|NumberMath|Clamp|Step)Block$/.test(className) ||
            block.inputs.some((input) => input.valueType === "int")
                ? 2
                : 0;
    }

    const graph = features & 1 ? (await import("./npe-graph-plumbing-runtime.js")).compileNodeParticleTopology(parsed) : parsed;
    let blocks: ReadonlyMap<number, CompiledParticleBlock> = graph.blocks;
    if (features & 2) {
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
