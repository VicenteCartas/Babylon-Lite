import type { NpeBlockEvaluator } from "../npe-build.js";

/** `UpdateAgeBlock` — overwrite the F64 age column in update-queue order. */
export const updateAgeBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        if (!ctx.isConnected(block, "age")) {
            return;
        }
        const ageGetter = ctx.input(block, "age");
        const age = ctx.state.buffer!.age;
        ctx.state.system!.updateSteps.push((i) => {
            age[i] = ageGetter(i) as number;
        });
    },
};
