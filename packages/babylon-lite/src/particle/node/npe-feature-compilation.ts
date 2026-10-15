import type { NpeBlockEvaluator } from "./npe-build.js";
import type { CompilableNodeParticleGraph, CompiledParticleBlock, NodeParticleSystemPlan } from "./npe-types.js";
import { NPE_FEATURE_GENERAL, NPE_FEATURE_FLOW_MAP, NPE_FEATURE_NOISE, NODE_PARTICLE_UPDATE_KIND_INDEX } from "./npe-types.js";

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
    const flowEvaluator = parsed._features & NPE_FEATURE_FLOW_MAP ? (await import("./blocks/update-flow-map-block.js")).updateFlowMapBlock : undefined;
    const noiseEvaluator = parsed._features & NPE_FEATURE_NOISE ? (await import("./blocks/update-noise-block.js")).updateNoiseBlock : undefined;
    if (flowEvaluator || noiseEvaluator) {
        const fallback = loadEvaluator;
        // Full class-name dispatch adds 40 B here; retain the trusted Update{FlowMap,Noise} discriminant within the scene budget.
        loadEvaluator = async (block) =>
            block.customType[NODE_PARTICLE_UPDATE_KIND_INDEX] === "F"
                ? flowEvaluator
                : block.customType[NODE_PARTICLE_UPDATE_KIND_INDEX] === "N"
                  ? noiseEvaluator
                  : fallback?.(block);
    }

    let blocks: ReadonlyMap<number, CompiledParticleBlock> = parsed.blocks;
    let systemBlockIds = parsed.systemBlockIds;
    if (parsed._features & NPE_FEATURE_GENERAL) {
        const general = await (await import("./npe-general-feature-compilation.js")).compileNodeParticleGeneralFeatures(parsed, loadEvaluator);
        blocks = general.blocks;
        systemBlockIds = general.systemBlockIds;
        loadEvaluator = general.loadEvaluator;
    }
    const systems: Array<Array<CompiledParticleBlock | NpeBlockEvaluator>> = [];
    for (const systemBlockId of systemBlockIds) {
        const operations: Array<CompiledParticleBlock | NpeBlockEvaluator> = [];
        await compileOperations(blocks, systemBlockId, operations, loadEvaluator);
        systems.push(operations);
    }
    return { blocks, systems };
}

// Dynamic-import namespace keys survive minification; this alias avoids repeating the long implementation name.
export { compileNodeParticleFeatures as compile };
