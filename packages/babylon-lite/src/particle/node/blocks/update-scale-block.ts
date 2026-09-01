import type { Vec2 } from "../../../math/types.js";
import type { NpeBlockEvaluator } from "../npe-build.js";

/** `UpdateScaleBlock` — copy the evaluated scale into the standard scale columns. */
export const updateScaleBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        if (!ctx.isConnected(block, "scale")) {
            return;
        }
        const buffer = ctx.state.buffer!;
        const scaleGetter = ctx.input(block, "scale");
        ctx.state.system!.updateSteps.push((i) => {
            const scale = scaleGetter(i) as Vec2;
            buffer.scaleX[i] = scale.x;
            buffer.scaleY[i] = scale.y;
        });
    },
};
