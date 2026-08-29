import type { NpeBuildState } from "./npe-build.js";
import type { CompiledParticleBlock, NodeParticleSystemEffectManifest, NodeParticleSystemTemplate } from "./npe-types.js";

/** @internal Compile the frame effects required by one system root. */
export function compileNodeParticleSystemEffects(blocks: ReadonlyMap<number, CompiledParticleBlock>, systemBlockId: number): NodeParticleSystemEffectManifest | undefined {
    const visited = new Set<number>();
    const stack = [systemBlockId];
    while (stack.length) {
        const blockId = stack.pop()!;
        if (visited.has(blockId)) {
            continue;
        }
        visited.add(blockId);
        const block = blocks.get(blockId);
        if (!block) {
            continue;
        }
        if (block.className === "ParticleLocalVariableBlock" && block.serialized.scope !== 0) {
            return { prepareFrame: ["localVariableLoopEpoch"] };
        }
        for (const input of block.inputs) {
            if (input.targetBlockId !== null && input.targetConnectionName !== null) {
                stack.push(input.targetBlockId);
            }
        }
    }
    return undefined;
}

/** @internal Install one compiled system template's lifecycle effects. */
export function installNodeParticleSystemEffects(template: NodeParticleSystemTemplate, state: NpeBuildState): void {
    for (const effect of template.effects?.prepareFrame ?? []) {
        if (effect === "localVariableLoopEpoch") {
            const epoch = { value: 0 };
            state._localVariableLoopEpoch = epoch;
            const previous = state.system!._prepareFrame;
            state.system!._prepareFrame = previous
                ? () => {
                      previous();
                      epoch.value++;
                  }
                : () => {
                      epoch.value++;
                  };
        }
    }
}
