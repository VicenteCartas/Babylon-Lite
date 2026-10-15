import type { Vec2, Vec3, Color4 } from "../../../math/types.js";
import type { NpeBlockEvaluator } from "../npe-build.js";
import type { NpeGetter } from "../npe-value.js";

function apply(operation: number, left: number, right: number): number {
    switch (operation) {
        case 0:
            return left + right;
        case 1:
            return left - right;
        case 2:
            return left * right;
        case 3:
            return left / right;
        case 4:
            return Math.max(left, right);
        case 5:
            return Math.min(left, right);
        default:
            return left;
    }
}

/** Compact math evaluator for distinct source blocks, whose result scratches cannot alias. */
export const particleMathCompactBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        const operation = typeof block.operation === "number" ? block.operation : 0;
        const left = ctx.input(block, "left");
        const right = ctx.input(block, "right");
        const vector2: Vec2 = { x: 0, y: 0 };
        const vector3: Vec3 = { x: 0, y: 0, z: 0 };
        const color4: Color4 = { r: 0, g: 0, b: 0, a: 0 };
        const getter: NpeGetter = (i) => {
            const a = left(i);
            const b = right(i);
            const aScalar = typeof a === "number";
            const bScalar = typeof b === "number";
            if (aScalar && bScalar) {
                return apply(operation, a, b);
            }
            const shape = aScalar ? b : a;
            if (typeof shape === "number") {
                return shape;
            }
            const result = "r" in shape ? color4 : "z" in shape ? vector3 : vector2;
            const output = result as unknown as Record<string, number>;
            const leftValue = a as unknown as Record<string, number>;
            const rightValue = b as unknown as Record<string, number>;
            for (const key in output) {
                output[key] = apply(operation, aScalar ? a : leftValue[key]!, bScalar ? b : rightValue[key]!);
            }
            return result;
        };
        ctx.setOutput(block.id, "output", getter);
    },
};

export { particleMathCompactBlock as evaluator };
