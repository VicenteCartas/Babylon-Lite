import { column } from "../../particle-buffer.js";
import type { NpeBlockEvaluator } from "../npe-build.js";
import type { CompiledParticleBlock } from "../npe-types.js";
import type { NpeGetter } from "../npe-value.js";

const SPRITE_CELL_INDEX = 0x0010;
const SPRITE_CELL_START = 0x0011;
const SPRITE_CELL_END = 0x0012;

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

/** `ParticleInputBlock` evaluator for sprite-cell contextual sources. */
export const particleInputSpriteCellBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        const source = typeof block.contextualValue === "number" ? block.contextualValue : 0;
        const system = ctx.state.system!;
        let getter: NpeGetter;
        switch (source) {
            case SPRITE_CELL_INDEX: {
                const cellIndex = column(ctx.state.buffer!, "sprite.cellIndex", Uint16Array);
                getter = (index) => cellIndex[index]!;
                break;
            }
            case SPRITE_CELL_START:
                getter = () => system._spriteSheet?.startCellID ?? 0;
                break;
            case SPRITE_CELL_END:
                getter = () => system._spriteSheet?.endCellID ?? 0;
                break;
            default:
                throw new Error(`NodeParticle: unsupported sprite-cell contextual source 0x${source.toString(16)}`);
        }
        ctx.setOutput(block.id, "output", getter);
    },
};

export { particleInputSpriteCellBlock as evaluator };
