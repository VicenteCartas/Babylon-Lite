import type { NpeBlockEvaluator } from "../npe-build.js";

/** `BasicColorUpdateBlock` — integrate color with the unclamped system step and clamp alpha at zero. */
export const basicColorUpdateBlock: NpeBlockEvaluator = {
    build(_block, ctx) {
        const system = ctx.state.system!;
        const buffer = ctx.state.buffer!;
        const colorR = buffer.colorR;
        const colorG = buffer.colorG;
        const colorB = buffer.colorB;
        const colorA = buffer.colorA;
        const colorStepR = buffer.colorStepR;
        const colorStepG = buffer.colorStepG;
        const colorStepB = buffer.colorStepB;
        const colorStepA = buffer.colorStepA;
        system.updateSteps.push((i) => {
            const step = system._scaledUpdateSpeed;
            colorR[i] = colorR[i]! + colorStepR[i]! * step;
            colorG[i] = colorG[i]! + colorStepG[i]! * step;
            colorB[i] = colorB[i]! + colorStepB[i]! * step;
            const alpha = colorA[i]! + colorStepA[i]! * step;
            colorA[i] = alpha < 0 ? 0 : alpha;
        });
    },
};
