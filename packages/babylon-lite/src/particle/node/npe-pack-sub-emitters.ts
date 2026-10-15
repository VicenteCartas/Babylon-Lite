import type { NpeBlockEvaluator } from "./npe-build.js";
import type { NodeParticleSystemPlan } from "./npe-types.js";
import { particleTriggerBlock } from "./blocks/particle-trigger-block.js";

/** Decorate the already-selected SystemBlock variant with lifecycle child plans. */
export function withSubEmitterLifecycle(systemEvaluator: NpeBlockEvaluator): NpeBlockEvaluator {
    return {
        build(block, ctx) {
            systemEvaluator.build(block, ctx);
            const spawn = ctx._spawnSystem!;
            const system = ctx.state.system!;
            const emitter = ctx.state.emitter;
            const plans = block._systemPlans as Readonly<Record<string, NodeParticleSystemPlan>> | undefined;
            const onStart = plans?.onStart;
            const onEnd = plans?.onEnd;
            let pendingEnds = 0;
            const lifecycle = (system._lifecycle ??= {});
            if (onStart || onEnd) {
                const started = lifecycle._started;
                lifecycle._started = () => {
                    started?.();
                    if (onEnd) {
                        pendingEnds++;
                    }
                    if (onStart) {
                        spawn(onStart, emitter);
                    }
                };
            }
            if (onEnd) {
                const stopped = lifecycle._stopped;
                lifecycle._stopped = () => {
                    stopped?.();
                    while (pendingEnds > 0) {
                        pendingEnds--;
                        spawn(onEnd, emitter);
                    }
                };
            }
        },
    };
}

/** Resolve trigger evaluators used only by graphs with system-flow connections. */
export function loadSubEmitterBlockEvaluator(className: string): NpeBlockEvaluator {
    if (className === "ParticleTriggerBlock") {
        return particleTriggerBlock;
    }
    throw new Error(`NodeParticle: unsupported sub-emitter block "${className}"`);
}

export { loadSubEmitterBlockEvaluator as load };
