import type { Color4, Vec2, Vec3 } from "../../../math/types.js";
import type { NpeBlockEvaluator } from "../npe-build.js";
import type { NpeGetter } from "../npe-value.js";

function smoothStep(value: number, edge0: number, edge1: number): number {
    const amount = Math.max(0, Math.min((value - edge0) / (edge1 - edge0), 1));
    return amount * amount * (3 - 2 * amount);
}

/** Apply scalar SmoothStep edges component-wise without allocating on reads. */
export const particleSmoothStepBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        if (!ctx.isConnected(block, "value")) {
            throw new Error(`NodeParticle: ParticleSmoothStepBlock ${block.id} input "value" is not connected`);
        }
        const value = ctx.input(block, "value");
        const edge0 = ctx.input(block, "edge0", () => 0);
        const edge1 = ctx.input(block, "edge1", () => 1);
        const vector2: Vec2 = { x: 0, y: 0 };
        const vector3: Vec3 = { x: 0, y: 0, z: 0 };
        const color4: Color4 = { r: 0, g: 0, b: 0, a: 0 };
        let firstEdge = 0;
        let secondEdge = 0;
        // Called after snapshotting the value: edge evaluation can rewrite an upstream scratch value (Babylon.js reads a fresh one).
        const readEdges = (index: number): void => {
            const first = edge0(index);
            const second = edge1(index);
            if (typeof first !== "number" || typeof second !== "number") {
                throw new Error(`NodeParticle: ParticleSmoothStepBlock ${block.id} requires scalar edges`);
            }
            firstEdge = first;
            secondEdge = second;
        };
        const getter: NpeGetter = (index) => {
            const source = value(index);
            if (typeof source === "number") {
                readEdges(index);
                return smoothStep(source, firstEdge, secondEdge);
            }
            if ("r" in source) {
                const { r, g, b, a } = source;
                readEdges(index);
                color4.r = smoothStep(r, firstEdge, secondEdge);
                color4.g = smoothStep(g, firstEdge, secondEdge);
                color4.b = smoothStep(b, firstEdge, secondEdge);
                color4.a = smoothStep(a, firstEdge, secondEdge);
                return color4;
            }
            if ("z" in source) {
                const { x, y, z } = source;
                readEdges(index);
                vector3.x = smoothStep(x, firstEdge, secondEdge);
                vector3.y = smoothStep(y, firstEdge, secondEdge);
                vector3.z = smoothStep(z, firstEdge, secondEdge);
                return vector3;
            }
            const { x, y } = source;
            readEdges(index);
            vector2.x = smoothStep(x, firstEdge, secondEdge);
            vector2.y = smoothStep(y, firstEdge, secondEdge);
            return vector2;
        };
        ctx.setOutput(block.id, "output", getter);
    },
};

export { particleSmoothStepBlock as evaluator };
