import type { NpeBlockEvaluator } from "../npe-build.js";
import type { ScalarGetter } from "../npe-value.js";

/** Evaluate scalar operations that require two Vector3 inputs. */
export const particleVectorMathBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        if (!ctx.isConnected(block, "left")) {
            throw new Error(`NodeParticle: ParticleVectorMathBlock ${block.id} input "left" is not connected`);
        }
        if (!ctx.isConnected(block, "right")) {
            throw new Error(`NodeParticle: ParticleVectorMathBlock ${block.id} input "right" is not connected`);
        }
        const operation = typeof block.operation === "number" ? block.operation : 0;
        if (operation !== 0 && operation !== 1) {
            throw new Error(`NodeParticle: ParticleVectorMathBlock ${block.id} has unsupported operation ${operation}`);
        }
        const left = ctx.input(block, "left");
        const right = ctx.input(block, "right");
        const getter: ScalarGetter = (index) => {
            const leftValue = left(index);
            if (typeof leftValue === "number" || !("z" in leftValue)) {
                throw new Error(`NodeParticle: ParticleVectorMathBlock ${block.id} requires Vector3 inputs`);
            }
            const leftX = leftValue.x;
            const leftY = leftValue.y;
            const leftZ = leftValue.z;
            const rightValue = right(index);
            if (typeof rightValue === "number" || !("z" in rightValue)) {
                throw new Error(`NodeParticle: ParticleVectorMathBlock ${block.id} requires Vector3 inputs`);
            }
            if (operation === 0) {
                return leftX * rightValue.x + leftY * rightValue.y + leftZ * rightValue.z;
            }
            const x = leftX - rightValue.x;
            const y = leftY - rightValue.y;
            const z = leftZ - rightValue.z;
            return Math.sqrt(x * x + y * y + z * z);
        };
        ctx.setOutput(block.id, "output", getter);
    },
};

export { particleVectorMathBlock as evaluator };
