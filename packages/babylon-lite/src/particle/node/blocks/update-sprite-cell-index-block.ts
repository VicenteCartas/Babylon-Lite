import { column } from "../../particle-buffer.js";
import type { NpeBlockEvaluator } from "../npe-build.js";

/** `UpdateSpriteCellIndexBlock` — floor and write the evaluated cell index in graph order. */
export const updateSpriteCellIndexBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        if (!ctx.isConnected(block, "cellIndex")) {
            return;
        }
        const value = ctx.input(block, "cellIndex");
        const cellIndex = column(ctx.state.buffer!, "sprite.cellIndex", Uint16Array);
        ctx.state.system!.updateSteps.push((index) => {
            cellIndex[index] = Math.floor(value(index) as number);
        });
    },
};

export { updateSpriteCellIndexBlock as evaluator };
