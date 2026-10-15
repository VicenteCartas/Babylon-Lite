import type { NpeBlockEvaluator } from "../npe-build.js";
import type { NpeGetter } from "../npe-value.js";
import { makeContextualGetter } from "../npe-contextual.js";
import { parseParticleInputValue } from "../npe-input.js";

const TYPE_FLOAT = 0x0002;

const SYS_TIME = 1;
const SYS_DELTA = 2;
const SYS_EMITTER = 3;

/** `ParticleInputBlock` — a constant, a contextual source, or a system source. */
export const particleInputBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        const contextual = typeof block.contextualValue === "number" ? block.contextualValue : 0;
        const systemSource = typeof block.systemSource === "number" ? block.systemSource : 0;

        let getter: NpeGetter;
        if (contextual !== 0) {
            getter = makeContextualGetter(ctx.state.buffer!, ctx.state.system!, contextual)!;
        } else if (systemSource !== 0) {
            const system = ctx.state.system!;
            const emitter = ctx.state.emitter;
            switch (systemSource) {
                case SYS_TIME:
                    getter = () => system._actualFrame;
                    break;
                case SYS_DELTA:
                    getter = () => system._scaledUpdateSpeed;
                    break;
                case SYS_EMITTER:
                    getter = () => emitter;
                    break;
                default:
                    throw new Error(`NodeParticle: unsupported system source ${systemSource}`);
            }
        } else {
            const type = typeof block.type === "number" ? block.type : TYPE_FLOAT;
            const constant = parseParticleInputValue(type, block.value);
            getter = () => constant;
        }

        ctx.setOutput(block.id, "output", getter);
    },
};

export { particleInputBlock as evaluator };
