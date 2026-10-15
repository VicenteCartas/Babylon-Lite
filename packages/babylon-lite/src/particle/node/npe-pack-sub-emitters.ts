import type { NpeBlockEvaluator } from "./npe-build.js";
import type { CompiledParticleBlock, NodeParticleSystemPlan } from "./npe-types.js";
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

/** Extend a compiled-evaluator loader with the trigger evaluator used only by graphs with system-flow connections. */
export function withTriggerEvaluator(
    loadEvaluator: ((block: CompiledParticleBlock) => Promise<NpeBlockEvaluator | undefined>) | undefined
): (block: CompiledParticleBlock) => Promise<NpeBlockEvaluator | undefined> {
    return async (block) => (block.customType === "BABYLON.ParticleTriggerBlock" ? particleTriggerBlock : await loadEvaluator?.(block));
}

/** Decorate every compiled SystemBlock that owns onStart/onEnd child plans. */
export function decorateSubEmitterSystems(operations: Array<CompiledParticleBlock | NpeBlockEvaluator>): void {
    for (let index = 0; index < operations.length; index += 2) {
        const plans = (operations[index] as CompiledParticleBlock)._systemPlans;
        if (plans?.onStart || plans?.onEnd) {
            operations[index + 1] = withSubEmitterLifecycle(operations[index + 1] as NpeBlockEvaluator);
        }
    }
}
