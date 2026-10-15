import type { Vec2, Vec3, Color4 } from "../../../math/types.js";
import type { NpeBlockEvaluator } from "../npe-build.js";
import type { NpeGetter, NpeValue } from "../npe-value.js";

/** Interpolate two lazy values into caller-owned scratch, copying the left before reading the right. */
export function lerpGetters(left: NpeGetter, right: NpeGetter, i: number, amount: number, vector2: Vec2, vector3: Vec3, color4: Color4): NpeValue {
    const start = left(i);
    if (typeof start === "number") {
        const end = right(i);
        const endNumber = typeof end === "number" ? end : 0;
        return start + (endNumber - start) * amount;
    }
    const result = "r" in start ? color4 : "z" in start ? vector3 : vector2;
    const from = start as unknown as Record<string, number>;
    const output = result as unknown as Record<string, number>;
    for (const key in output) {
        output[key] = from[key]!;
    }
    const end = right(i);
    const sameShape = typeof end !== "number" && ("r" in result ? "r" in end : "z" in result ? "z" in end : !("r" in end) && !("z" in end));
    const to = sameShape ? (end as unknown as Record<string, number>) : null;
    for (const key in output) {
        const value = output[key]!;
        output[key] = value + ((to?.[key] ?? 0) - value) * amount;
    }
    return result;
}

/** `ParticleLerpBlock` — component-wise linear interpolation `left + (right - left) * gradient`, into scratch. */
export const particleLerpBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        const left = ctx.input(block, "left");
        const right = ctx.input(block, "right");
        const gradient = ctx.input(block, "gradient", () => 0);
        const v3: Vec3 = { x: 0, y: 0, z: 0 };
        const c4: Color4 = { r: 0, g: 0, b: 0, a: 0 };
        const v2: Vec2 = { x: 0, y: 0 };

        const getter: NpeGetter = (i) => {
            const g = gradient(i);
            const t = typeof g === "number" ? g : 0;
            return lerpGetters(left, right, i, t, v2, v3, c4);
        };

        ctx.setOutput(block.id, "output", getter);
    },
};

export { particleLerpBlock as evaluator };
