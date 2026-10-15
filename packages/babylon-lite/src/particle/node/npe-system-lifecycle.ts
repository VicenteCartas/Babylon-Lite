import { animateParticleSystem, disposeParticleSystem, startParticleSystem, stopParticleSystem, type ParticleSystem } from "../particle-system.js";
import type { NpeBlockEvaluator } from "./npe-build.js";

function installLifecycle(system: ParticleSystem): void {
    const lifecycle = (system._lifecycle ??= {});
    lifecycle._beforeStart = (delay) => {
        if (system.doNoStart) {
            return true;
        }
        if (delay) {
            system.startDelay = delay;
            setTimeout(() => startParticleSystem(system, 0), delay);
            return true;
        }
        return false;
    };
    lifecycle._started = () => {
        for (let index = 0; index < system.preWarmCycles; index++) {
            animateParticleSystem(system, system.preWarmStepOffset);
        }
    };
    lifecycle._emit = () => {
        if (system.manualEmitCount < 0) {
            return undefined;
        }
        const count = system.manualEmitCount;
        system._newPartsExcess = 0;
        system.manualEmitCount = 0;
        return count;
    };
    lifecycle._afterAnimate = () => {
        if (!system.disposeOnStop) {
            return;
        }
        if (!system._started) {
            disposeParticleSystem(system);
        } else if (system.manualEmitCount === 0) {
            stopParticleSystem(system);
        }
    };
}

/** Decorate a SystemBlock evaluator with non-default serialized lifecycle behavior. */
export function withSystemLifecycle(systemEvaluator: NpeBlockEvaluator): NpeBlockEvaluator {
    return {
        build(block, ctx) {
            systemEvaluator.build(block, ctx);
            const system = ctx.state.system!;
            system.manualEmitCount = typeof block.manualEmitCount === "number" ? block.manualEmitCount : -1;
            system.preWarmCycles = typeof block.preWarmCycles === "number" ? block.preWarmCycles : 0;
            system.preWarmStepOffset = typeof block.preWarmStepOffset === "number" ? block.preWarmStepOffset : 0;
            system.startDelay = typeof block.startDelay === "number" ? block.startDelay : 0;
            system.disposeOnStop = block.disposeOnStop === true;
            system.doNoStart = !!block.doNoStart;
            installLifecycle(system);
        },
    };
}
