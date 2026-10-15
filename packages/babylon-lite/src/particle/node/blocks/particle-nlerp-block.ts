import type { Color4, Vec2, Vec3 } from "../../../math/types.js";
import type { NpeBlockEvaluator } from "../npe-build.js";
import type { NpeGetter } from "../npe-value.js";

function interpolate(left: number, right: number, gradient: number): number {
    return (1 - gradient) * left + gradient * right;
}

/** Interpolate matching values and normalize vector or color results. */
export const particleNLerpBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        if (!ctx.isConnected(block, "left")) {
            throw new Error(`NodeParticle: ParticleNLerpBlock ${block.id} input "left" is not connected`);
        }
        if (!ctx.isConnected(block, "right")) {
            throw new Error(`NodeParticle: ParticleNLerpBlock ${block.id} input "right" is not connected`);
        }
        const left = ctx.input(block, "left");
        const right = ctx.input(block, "right");
        const gradient = ctx.input(block, "gradient", () => 0);
        const vector2: Vec2 = { x: 0, y: 0 };
        const vector3: Vec3 = { x: 0, y: 0, z: 0 };
        const color4: Color4 = { r: 0, g: 0, b: 0, a: 0 };
        const getter: NpeGetter = (index) => {
            const leftValue = left(index);
            if (typeof leftValue === "number") {
                const rightValue = right(index);
                const amount = gradient(index);
                if (typeof rightValue !== "number" || typeof amount !== "number") {
                    throw new Error(`NodeParticle: ParticleNLerpBlock ${block.id} received mismatched inputs`);
                }
                return interpolate(leftValue, rightValue, amount);
            }
            if ("r" in leftValue) {
                const leftR = leftValue.r;
                const leftG = leftValue.g;
                const leftB = leftValue.b;
                const leftA = leftValue.a;
                const rightValue = right(index);
                const amount = gradient(index);
                if (typeof rightValue === "number" || !("r" in rightValue) || typeof amount !== "number") {
                    throw new Error(`NodeParticle: ParticleNLerpBlock ${block.id} received mismatched inputs`);
                }
                color4.r = interpolate(leftR, rightValue.r, amount);
                color4.g = interpolate(leftG, rightValue.g, amount);
                color4.b = interpolate(leftB, rightValue.b, amount);
                color4.a = interpolate(leftA, rightValue.a, amount);
                const length = Math.sqrt(color4.r * color4.r + color4.g * color4.g + color4.b * color4.b + color4.a * color4.a);
                if (length !== 0) {
                    const scale = 1 / length;
                    color4.r *= scale;
                    color4.g *= scale;
                    color4.b *= scale;
                    color4.a *= scale;
                }
                return color4;
            }
            if ("z" in leftValue) {
                const leftX = leftValue.x;
                const leftY = leftValue.y;
                const leftZ = leftValue.z;
                const rightValue = right(index);
                const amount = gradient(index);
                if (typeof rightValue === "number" || !("z" in rightValue) || typeof amount !== "number") {
                    throw new Error(`NodeParticle: ParticleNLerpBlock ${block.id} received mismatched inputs`);
                }
                vector3.x = interpolate(leftX, rightValue.x, amount);
                vector3.y = interpolate(leftY, rightValue.y, amount);
                vector3.z = interpolate(leftZ, rightValue.z, amount);
                const length = Math.sqrt(vector3.x * vector3.x + vector3.y * vector3.y + vector3.z * vector3.z);
                if (length !== 0) {
                    const scale = 1 / length;
                    vector3.x *= scale;
                    vector3.y *= scale;
                    vector3.z *= scale;
                }
                return vector3;
            }
            const leftX = leftValue.x;
            const leftY = leftValue.y;
            const rightValue = right(index);
            const amount = gradient(index);
            if (typeof rightValue === "number" || "r" in rightValue || "z" in rightValue || typeof amount !== "number") {
                throw new Error(`NodeParticle: ParticleNLerpBlock ${block.id} received mismatched inputs`);
            }
            vector2.x = interpolate(leftX, rightValue.x, amount);
            vector2.y = interpolate(leftY, rightValue.y, amount);
            const length = Math.sqrt(vector2.x * vector2.x + vector2.y * vector2.y);
            if (length !== 0) {
                const scale = 1 / length;
                vector2.x *= scale;
                vector2.y *= scale;
            }
            return vector2;
        };
        ctx.setOutput(block.id, "output", getter);
    },
};

export { particleNLerpBlock as evaluator };
