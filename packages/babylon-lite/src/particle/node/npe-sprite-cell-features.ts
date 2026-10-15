import type { CompiledParticleBlock } from "./npe-types.js";
import { NPE_FEATURE_SPRITE_CELL_VALUE_TYPES, NPE_CONTEXTUAL_SPRITE_CELL_INDEX, NPE_CONTEXTUAL_SPRITE_CELL_END } from "./npe-types.js";

/** Whether a sprite-cell Int source can reach the one value block not already detected as a typed feature. */
export function detectSpriteCellFeatures(blocks: ReadonlyMap<number, CompiledParticleBlock>): number {
    const reachable = new Set<number>();
    for (const block of blocks.values()) {
        if (
            block.customType === "BABYLON.ParticleInputBlock" &&
            typeof block.contextualValue === "number" &&
            block.contextualValue >= NPE_CONTEXTUAL_SPRITE_CELL_INDEX &&
            block.contextualValue <= NPE_CONTEXTUAL_SPRITE_CELL_END
        ) {
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
                return NPE_FEATURE_SPRITE_CELL_VALUE_TYPES;
            }
            reachable.add(block.id);
            changed = true;
        }
    }
    return 0;
}
