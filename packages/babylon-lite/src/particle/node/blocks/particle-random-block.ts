import type { Vec2, Vec3, Color4 } from "../../../math/types.js";
import type { NpeBlockEvaluator } from "../npe-build.js";
import type { NpeGetter, NpeValue } from "../npe-value.js";

const LOCK_NONE = 0;
const LOCK_PER_PARTICLE = 1;
const LOCK_PER_SYSTEM = 2;

function randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

/** Build the zero-allocation random draw for a block's min/max getters. */
export function createRandomDraw(minGetter: NpeGetter, maxGetter: NpeGetter): NpeGetter {
    const vector3: Vec3 = { x: 0, y: 0, z: 0 };
    const color4: Color4 = { r: 0, g: 0, b: 0, a: 0 };
    const vector2: Vec2 = { x: 0, y: 0 };

    return (i) => {
        const min = minGetter(i);
        if (typeof min === "number") {
            const max = maxGetter(i);
            const hi = typeof max === "number" ? max : 0;
            return randomBetween(min, hi);
        }
        const result = "r" in min ? color4 : "z" in min ? vector3 : vector2;
        const low = min as unknown as Record<string, number>;
        const output = result as unknown as Record<string, number>;
        for (const key in output) {
            output[key] = low[key]!;
        }
        const max = maxGetter(i);
        const sameShape = typeof max !== "number" && ("r" in result ? "r" in max : "z" in result ? "z" in max : !("r" in max) && !("z" in max));
        const high = sameShape ? (max as unknown as Record<string, number>) : null;
        for (const key in output) {
            output[key] = randomBetween(output[key]!, high?.[key] ?? 0);
        }
        return result;
    };
}

/**
 * `ParticleRandomBlock` — a random value with a lock controlling re-draw frequency. `PerParticle`
 * (the default) draws once per particle, keyed by the particle id (read lazily from the buffer, since this
 * block can build before the buffer exists). Draws per component and never short-circuits. Vector/colour
 * results use reused scratch values.
 */
export const particleRandomBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        const minGetter = ctx.input(block, "min", () => 0);
        const maxGetter = ctx.input(block, "max", () => 1);
        const lockMode = typeof block.lockMode === "number" ? block.lockMode : LOCK_PER_PARTICLE;

        const buffer = ctx.state.buffer!;
        let stored: NpeValue = 0;
        let currentLockId = -2;
        const draw = createRandomDraw(minGetter, maxGetter);

        const getter: NpeGetter = (i) => {
            let lockId = -2;
            if (lockMode === LOCK_PER_PARTICLE) {
                lockId = buffer.id[i]!;
            } else if (lockMode === LOCK_PER_SYSTEM) {
                lockId = 0;
            }
            if (lockMode === LOCK_NONE || currentLockId !== lockId) {
                if (lockMode !== LOCK_NONE) {
                    currentLockId = lockId;
                }
                stored = draw(i);
            }
            return stored;
        };

        ctx.setOutput(block.id, "output", getter);
    },
};

export { particleRandomBlock as evaluator };
