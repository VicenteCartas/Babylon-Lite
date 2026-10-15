import { column } from "../../particle-buffer.js";
import type { NpeBlockEvaluator } from "../npe-build.js";
import type { NpeGetter } from "../npe-value.js";
import { NPE_CONTEXTUAL_SPRITE_CELL_INDEX, NPE_CONTEXTUAL_SPRITE_CELL_START, NPE_CONTEXTUAL_SPRITE_CELL_END } from "../npe-types.js";

/** `ParticleInputBlock` evaluator for sprite-cell contextual sources. */
export const particleInputSpriteCellBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        const source = typeof block.contextualValue === "number" ? block.contextualValue : 0;
        const system = ctx.state.system!;
        let getter: NpeGetter;
        switch (source) {
            case NPE_CONTEXTUAL_SPRITE_CELL_INDEX: {
                const cellIndex = column(ctx.state.buffer!, "sprite.cellIndex", Uint16Array);
                getter = (index) => cellIndex[index]!;
                break;
            }
            case NPE_CONTEXTUAL_SPRITE_CELL_START:
                getter = () => system._spriteSheet?.startCellID ?? 0;
                break;
            case NPE_CONTEXTUAL_SPRITE_CELL_END:
                getter = () => system._spriteSheet?.endCellID ?? 0;
                break;
            default:
                throw new Error(`NodeParticle: unsupported sprite-cell contextual source 0x${source.toString(16)}`);
        }
        ctx.setOutput(block.id, "output", getter);
    },
};

export { particleInputSpriteCellBlock as evaluator };
