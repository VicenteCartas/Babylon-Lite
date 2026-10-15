import type { NpeBlockEvaluator } from "./npe-build.js";
import type { CompilableNodeParticleGraph, CompiledParticleBlock, NodeParticleSystemPlan } from "./npe-types.js";

/** Compile graph features that are absent from ordinary NPE programs. */
export async function compileNodeParticleFeatures(
    parsed: CompilableNodeParticleGraph,
    compileOperations: (
        blocks: ReadonlyMap<number, CompiledParticleBlock>,
        systemBlockId: number,
        operations: Array<CompiledParticleBlock | NpeBlockEvaluator>,
        loadEvaluator?: (block: CompiledParticleBlock) => Promise<NpeBlockEvaluator | undefined>
    ) => Promise<void>,
    loadEvaluator?: (block: CompiledParticleBlock) => Promise<NpeBlockEvaluator | undefined>
): Promise<{
    blocks: ReadonlyMap<number, CompiledParticleBlock>;
    systems: NodeParticleSystemPlan[];
}> {
    const flowEvaluator = parsed._features & 2 ? (await import("./blocks/update-flow-map-block.js")).updateFlowMapBlock : undefined;
    const noiseEvaluator = parsed._features & 4 ? (await import("./blocks/update-noise-block.js")).updateNoiseBlock : undefined;
    if (flowEvaluator || noiseEvaluator) {
        const fallback = loadEvaluator;
        loadEvaluator = async (block) => (block.customType[14] === "F" ? flowEvaluator : block.customType[14] === "N" ? noiseEvaluator : fallback?.(block));
    }

    let blocks: ReadonlyMap<number, CompiledParticleBlock> = parsed.blocks;
    let systemBlockIds = parsed.systemBlockIds;
    if (parsed._features & 1) {
        const general = await (await import("./npe-general-feature-compilation.js")).compileNodeParticleGeneralFeatures(parsed, loadEvaluator);
        blocks = general.blocks;
        systemBlockIds = general.systemBlockIds;
        loadEvaluator = general.loadEvaluator;
    }
    if (parsed._features & 8) {
        const systems = await (await import("./npe-system-plan-compilation.js")).compileNodeParticleSystemPlans(blocks, systemBlockIds, compileOperations, loadEvaluator);
        return { blocks, systems };
    }
    const systems: Array<Array<CompiledParticleBlock | NpeBlockEvaluator>> = [];
    for (const systemBlockId of systemBlockIds) {
        const operations: Array<CompiledParticleBlock | NpeBlockEvaluator> = [];
        await compileOperations(blocks, systemBlockId, operations, loadEvaluator);
        systems.push(operations);
    }
    return { blocks, systems };
}

export { compileNodeParticleFeatures as compile };
