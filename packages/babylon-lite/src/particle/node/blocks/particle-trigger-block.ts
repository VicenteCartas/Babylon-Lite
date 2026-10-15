import type { NpeBlockEvaluator } from "../npe-build.js";
import type { NodeParticleSystemPlan } from "../npe-types.js";

/** `ParticleTriggerBlock` — create child systems from live particles under one block-global gate. */
export const particleTriggerBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        const system = ctx.state.system!;
        const buffer = system.buffer;
        const condition = ctx.input(block, "condition", () => 0);
        const plans = block._systemPlans as Readonly<Record<string, NodeParticleSystemPlan>> | undefined;
        const plan = plans?.system;
        const spawn = ctx._spawnSystem;
        const limit = typeof block.limit === "number" ? block.limit : 5;
        const delay = typeof block.delay === "number" ? block.delay : 250;
        let active = 0;
        let previous: number | null = null;

        system.updateSteps.push((index) => {
            if ((condition(index) as number) === 0 || !plan || !spawn || (limit !== 0 && active >= limit)) {
                return;
            }
            const now = Date.now();
            if (previous && now - previous < delay) {
                return;
            }
            const emitter = { x: buffer.posX[index]!, y: buffer.posY[index]!, z: buffer.posZ[index]! };
            previous = now;
            if (spawn(plan, emitter, () => active--)) {
                active++;
            }
        });
    },
};

export { particleTriggerBlock as evaluator };
