import type { CompiledParticleBlock, NodeParticleBindingManifest } from "./npe-types.js";

/** @internal Compile the frame bindings required by one system root. */
export function compileNodeParticleFrameBindings(blocks: ReadonlyMap<number, CompiledParticleBlock>, systemBlockId: number): NodeParticleBindingManifest | undefined {
    const frame: NodeParticleBindingManifest["frame"][number][] = [];
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
        if (block.className === "UpdateFlowMapBlock") {
            frame.push({ blockId: block.id, kind: "flowMapViewProjection" });
        }
        for (const input of block.inputs) {
            if (input.targetBlockId !== null && input.targetConnectionName !== null) {
                stack.push(input.targetBlockId);
            }
        }
    }
    if (!frame.length) {
        return undefined;
    }
    frame.sort((left, right) => left.blockId - right.blockId);
    return { frame };
}
