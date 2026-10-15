import type { NpeBlockEvaluator } from "./npe-build.js";
import type { CompiledParticleBlock, NodeParticleSystemPlan } from "./npe-types.js";
import { decorateSubEmitterSystems, withTriggerEvaluator } from "./npe-pack-sub-emitters.js";

/** Compile reusable child-system references without adding their routing to ordinary NPE programs. */
export async function compileNodeParticleSystemPlans(
    sourceBlocks: ReadonlyMap<number, CompiledParticleBlock>,
    systemBlockIds: readonly number[],
    compileOperations: (
        blocks: ReadonlyMap<number, CompiledParticleBlock>,
        systemBlockId: number,
        operations: Array<CompiledParticleBlock | NpeBlockEvaluator>,
        loadEvaluator?: (block: CompiledParticleBlock) => Promise<NpeBlockEvaluator | undefined>
    ) => Promise<void>,
    loadEvaluator?: (block: CompiledParticleBlock) => Promise<NpeBlockEvaluator | undefined>
): Promise<NodeParticleSystemPlan[]> {
    const systems: Array<Array<CompiledParticleBlock | NpeBlockEvaluator>> = systemBlockIds.map(() => []);
    const systemPlans = new Map(systemBlockIds.map((id, index) => [id, systems[index]!]));
    let blocks: Map<number, CompiledParticleBlock> | undefined;

    for (const block of sourceBlocks.values()) {
        let references: Record<string, NodeParticleSystemPlan> | undefined;
        for (const input of block.inputs) {
            const plan = input.targetConnectionName === "system" && input.targetBlockId != null ? systemPlans.get(input.targetBlockId) : undefined;
            if (plan) {
                (references ??= {})[input.name.trim()] = plan;
            }
        }
        if (references) {
            const inputs = block.inputs.filter((input) => input.targetConnectionName !== "system" || input.targetBlockId == null || !systemPlans.has(input.targetBlockId));
            (blocks ??= new Map(sourceBlocks)).set(block.id, { ...block, inputs, _systemPlans: references });
        }
    }

    const compiledBlocks = blocks ?? sourceBlocks;
    const loadSubEmitterEvaluator = withTriggerEvaluator(loadEvaluator);
    for (let index = 0; index < systemBlockIds.length; index++) {
        await compileOperations(compiledBlocks, systemBlockIds[index]!, systems[index]!, loadSubEmitterEvaluator);
        decorateSubEmitterSystems(systems[index]!);
    }
    return systems;
}
