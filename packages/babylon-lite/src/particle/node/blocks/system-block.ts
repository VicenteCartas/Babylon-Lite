import type { NpeBlockEvaluator } from "../npe-build.js";

/**
 * `SystemBlock` — the graph root. Applies update speed, blend mode, emit rate, and target stop
 * duration onto the {@link ParticleSystem} built by the upstream `particle` chain. The texture is bound by the
 * texture-source block. Connected emit-rate graphs use the serialized variant evaluator, which installs
 * an optional per-step getter after applying this shared configuration.
 */
export const systemBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        const system = ctx.state.system!;

        const serialized = block;
        if (typeof serialized.updateSpeed === "number") {
            system.updateSpeed = serialized.updateSpeed;
        }
        if (typeof serialized.blendMode === "number") {
            system.blendMode = serialized.blendMode;
        }
        system.manualEmitCount = typeof serialized.manualEmitCount === "number" ? serialized.manualEmitCount : -1;
        system.preWarmCycles = typeof serialized.preWarmCycles === "number" ? serialized.preWarmCycles : 0;
        system.preWarmStepOffset = typeof serialized.preWarmStepOffset === "number" ? serialized.preWarmStepOffset : 0;
        system.startDelay = typeof serialized.startDelay === "number" ? serialized.startDelay : 0;
        system.disposeOnStop = serialized.disposeOnStop === true;
        system.doNoStart = !!serialized.doNoStart;

        if (!ctx.isConnected(block, "emitRate")) {
            const emitRate = ctx.input(block, "emitRate", () => 10)(0);
            if (typeof emitRate === "number") {
                system.emitRate = emitRate;
            }
        }

        const targetStop = ctx.input(block, "targetStopDuration", () => 0)(0);
        if (typeof targetStop === "number") {
            system.targetStopDuration = targetStop;
        }
    },
};

export { systemBlock as evaluator };
