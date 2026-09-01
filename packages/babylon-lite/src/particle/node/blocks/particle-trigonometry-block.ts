import type { Color4, Vec2, Vec3 } from "../../../math/types.js";
import type { NpeBlockEvaluator } from "../npe-build.js";
import type { NpeGetter } from "../npe-value.js";

function evaluate(operation: number, value: number): number {
    switch (operation) {
        case 0:
            return Math.cos(value);
        case 1:
            return Math.sin(value);
        case 2:
            return Math.abs(value);
        case 3:
            return Math.exp(value);
        case 4:
            return Math.pow(2, value);
        case 5:
            return Math.round(value);
        case 6:
            return Math.floor(value);
        case 7:
            return Math.ceil(value);
        case 8:
            return Math.sqrt(value);
        case 9:
            return Math.log(value);
        case 10:
            return Math.tan(value);
        case 11:
            return Math.atan(value);
        case 12:
            return Math.acos(value);
        case 13:
            return Math.asin(value);
        case 14:
            return Math.sign(value);
        case 15:
            return -value;
        case 16:
            return 1 - value;
        case 17:
            return 1 / value;
        case 18:
            return (value * 180) / Math.PI;
        case 19:
            return (value * Math.PI) / 180;
        case 20:
            return value >= 0 ? value - Math.floor(value) : value - Math.ceil(value);
        default:
            return value;
    }
}

/** Apply one scalar operation component-wise without allocating on reads. */
export const particleTrigonometryBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        if (!ctx.isConnected(block, "input")) {
            throw new Error(`NodeParticle: ParticleTrigonometryBlock ${block.id} input "input" is not connected`);
        }
        const operation = typeof block.operation === "number" ? block.operation : 0;
        if (!Number.isInteger(operation) || operation < 0 || operation > 20) {
            throw new Error(`NodeParticle: ParticleTrigonometryBlock ${block.id} has unsupported operation ${operation}`);
        }
        const input = ctx.input(block, "input");
        const vector2: Vec2 = { x: 0, y: 0 };
        const vector3: Vec3 = { x: 0, y: 0, z: 0 };
        const color4: Color4 = { r: 0, g: 0, b: 0, a: 0 };
        const getter: NpeGetter = (index) => {
            const source = input(index);
            if (typeof source === "number") {
                return evaluate(operation, source);
            }
            if ("r" in source) {
                color4.r = evaluate(operation, source.r);
                color4.g = evaluate(operation, source.g);
                color4.b = evaluate(operation, source.b);
                color4.a = evaluate(operation, source.a);
                return color4;
            }
            if ("z" in source) {
                vector3.x = evaluate(operation, source.x);
                vector3.y = evaluate(operation, source.y);
                vector3.z = evaluate(operation, source.z);
                return vector3;
            }
            vector2.x = evaluate(operation, source.x);
            vector2.y = evaluate(operation, source.y);
            return vector2;
        };
        ctx.setOutput(block.id, "output", getter);
    },
};

export { particleTrigonometryBlock as evaluator };
