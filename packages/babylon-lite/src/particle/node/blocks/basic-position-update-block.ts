import type { NpeBlockEvaluator } from "../npe-build.js";

/** `BasicPositionUpdateBlock` — integrate direction with the lifetime-clamped particle step. */
export const basicPositionUpdateBlock: NpeBlockEvaluator = {
    build(_block, ctx) {
        const system = ctx.state.system!;
        const buffer = ctx.state.buffer!;
        const posX = buffer.posX;
        const posY = buffer.posY;
        const posZ = buffer.posZ;
        const dirX = buffer.dirX;
        const dirY = buffer.dirY;
        const dirZ = buffer.dirZ;
        system.updateSteps.push((i) => {
            const step = system._scaledStep;
            posX[i] = posX[i]! + dirX[i]! * step;
            posY[i] = posY[i]! + dirY[i]! * step;
            posZ[i] = posZ[i]! + dirZ[i]! * step;
        });
    },
};
