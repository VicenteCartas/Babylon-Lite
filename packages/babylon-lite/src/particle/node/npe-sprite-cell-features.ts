import type { CompiledParticleBlock } from "./npe-types.js";

/** Whether a sprite-cell Int source can reach the one value block not already detected as a typed feature. */
export function detectSpriteCellFeatures(blocks: ReadonlyMap<number, CompiledParticleBlock>): 0 | 0x11 {
    const reachable = new Set<number>();
    for (const block of blocks.values()) {
        if (block.customType === "BABYLON.ParticleInputBlock" && typeof block.contextualValue === "number" && block.contextualValue >= 0x10 && block.contextualValue <= 0x12) {
            reachable.add(block.id);
        }
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const block of blocks.values()) {
            if (reachable.has(block.id) || !block.inputs.some((input) => input.targetBlockId != null && reachable.has(input.targetBlockId))) {
                continue;
            }
            if (block.customType === "BABYLON.ParticleMathBlock") {
                return 0x11;
            }
            reachable.add(block.id);
            changed = true;
        }
    }
    return 0;
}
