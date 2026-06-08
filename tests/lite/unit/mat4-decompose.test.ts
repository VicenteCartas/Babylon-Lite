import { describe, expect, it } from "vitest";

import { mat4Decompose } from "../../../packages/babylon-lite/src/math/mat4-decompose";
import { mat4Compose } from "../../../packages/babylon-lite/src/math/mat4-compose";
import type { Mat4 } from "../../../packages/babylon-lite/src/math/types";

function near(a: number, b: number, eps = 1e-5): boolean {
    return Math.abs(a - b) <= eps;
}

describe("mat4Decompose", () => {
    it("round-trips a translation+rotation+scale matrix", () => {
        // 90° about Y, translation (1,2,3), uniform scale 2.
        const qx = 0,
            qy = Math.sin(Math.PI / 4),
            qz = 0,
            qw = Math.cos(Math.PI / 4);
        const m = mat4Compose(1, 2, 3, qx, qy, qz, qw, 2, 2, 2);

        const t: [number, number, number] = [0, 0, 0];
        const r: [number, number, number, number] = [0, 0, 0, 1];
        const s: [number, number, number] = [0, 0, 0];
        mat4Decompose(m, t, r, s);

        expect(near(t[0], 1) && near(t[1], 2) && near(t[2], 3)).toBe(true);
        expect(near(s[0], 2) && near(s[1], 2) && near(s[2], 2)).toBe(true);
        // Quaternion may come back negated (same rotation); compare up to sign.
        const sign = r[3] * qw < 0 ? -1 : 1;
        expect(near(r[0] * sign, qx) && near(r[1] * sign, qy) && near(r[2] * sign, qz) && near(r[3] * sign, qw)).toBe(true);
    });

    it("folds a negative determinant into the X scale and keeps a proper rotation", () => {
        // Identity rotation with a −1 X scale (a mirror). Decompose should yield a
        // proper unit quaternion (det of the recovered rotation basis = +1) with the
        // sign captured in scale.x.
        const m = mat4Compose(0, 0, 0, 0, 0, 0, 1, -1, 1, 1);
        const t: [number, number, number] = [0, 0, 0];
        const r: [number, number, number, number] = [0, 0, 0, 1];
        const s: [number, number, number] = [0, 0, 0];
        mat4Decompose(m as Mat4, t, r, s);

        expect(s[0]).toBeLessThan(0); // mirror captured in X scale
        // Quaternion stays unit length (a valid rotation, not a reflection).
        const len = Math.hypot(r[0], r[1], r[2], r[3]);
        expect(near(len, 1)).toBe(true);
    });
});
