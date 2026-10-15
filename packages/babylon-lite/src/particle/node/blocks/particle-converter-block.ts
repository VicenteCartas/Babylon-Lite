import type { Vec2, Vec3, Color4 } from "../../../math/types.js";
import type { NpeBlockEvaluator } from "../npe-build.js";
import type { NpeValue } from "../npe-value.js";

const NAMES = ["color", "xyz", "xy", "zw", "x", "y", "z", "w"] as const;

/**
 * `ParticleConverterBlock` — composes a Color4 from component inputs and exposes every projection
 * (`color`, `xyz`, `xy`, `zw`, `x`, `y`, `z`, `w`), r↔x g↔y b↔z a↔w. Fills reused scratch values.
 */
export const particleConverterBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        const getters = NAMES.map((name) => ctx.input(block, name));
        const connected = NAMES.map((name) => ctx.isConnected(block, name));

        const data: Color4 = { r: 0, g: 0, b: 0, a: 0 };
        const fill = (i: number): void => {
            if (connected[0]) {
                const c = getters[0]!(i) as Color4;
                data.r = c.r;
                data.g = c.g;
                data.b = c.b;
                data.a = c.a;
                return;
            }
            let x = connected[4] ? (getters[4]!(i) as number) : 0;
            let y = connected[5] ? (getters[5]!(i) as number) : 0;
            let z = connected[6] ? (getters[6]!(i) as number) : 0;
            let w = connected[7] ? (getters[7]!(i) as number) : 0;
            if (connected[2]) {
                const t = getters[2]!(i) as Vec2 | null;
                if (t) {
                    x = t.x;
                    y = t.y;
                }
            }
            if (connected[3]) {
                const t = getters[3]!(i) as Vec2 | null;
                if (t) {
                    z = t.x;
                    w = t.y;
                }
            }
            if (connected[1]) {
                const t = getters[1]!(i) as Vec3 | null;
                if (t) {
                    x = t.x;
                    y = t.y;
                    z = t.z;
                }
            }
            data.r = x;
            data.g = y;
            data.b = z;
            data.a = w;
        };

        const v3: Vec3 = { x: 0, y: 0, z: 0 };
        const v2a: Vec2 = { x: 0, y: 0 };
        const v2b: Vec2 = { x: 0, y: 0 };
        const values: NpeValue[] = [data, v3, v2a, v2b, 0, 0, 0, 0];
        for (let output = 0; output < NAMES.length; output++) {
            ctx.setOutput(block.id, NAMES[output]!, (i) => {
                fill(i);
                v3.x = v2a.x = data.r;
                v3.y = v2a.y = data.g;
                v3.z = v2b.x = data.b;
                v2b.y = data.a;
                values[4] = data.r;
                values[5] = data.g;
                values[6] = data.b;
                values[7] = data.a;
                return values[output]!;
            });
        }
    },
};

export { particleConverterBlock as evaluator };
