import type { Mat4 } from "./types.js";

/** Decompose a column-major TRS matrix into translation + rotation quaternion +
 *  scale. Assumes an affine TRS matrix (no shear/projection), which is what the
 *  scene graph and skeleton produce. Negative determinant is folded into the X
 *  scale so the returned quaternion stays a proper (right-handed) rotation.
 *
 *  Writes into the provided 3-tuple (translation/scale) and 4-tuple (quaternion,
 *  xyzw) outputs to avoid allocation; pass fresh arrays if you need to retain
 *  the result. */
export function mat4Decompose(m: Mat4, outTranslation: [number, number, number], outRotation: [number, number, number, number], outScale: [number, number, number]): void {
    outTranslation[0] = m[12]!;
    outTranslation[1] = m[13]!;
    outTranslation[2] = m[14]!;

    // Column lengths = scale magnitudes.
    let sx = Math.hypot(m[0]!, m[1]!, m[2]!);
    const sy = Math.hypot(m[4]!, m[5]!, m[6]!);
    const sz = Math.hypot(m[8]!, m[9]!, m[10]!);

    // A negative determinant means an odd number of mirror axes; fold the sign
    // into X so the remaining basis is a proper rotation.
    const det = m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) + m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!);
    if (det < 0) {
        sx = -sx;
    }

    outScale[0] = sx;
    outScale[1] = sy;
    outScale[2] = sz;

    // Normalise the basis columns to remove scale, then read the quaternion.
    const isx = sx !== 0 ? 1 / sx : 0;
    const isy = sy !== 0 ? 1 / sy : 0;
    const isz = sz !== 0 ? 1 / sz : 0;
    const r00 = m[0]! * isx,
        r01 = m[1]! * isx,
        r02 = m[2]! * isx;
    const r10 = m[4]! * isy,
        r11 = m[5]! * isy,
        r12 = m[6]! * isy;
    const r20 = m[8]! * isz,
        r21 = m[9]! * isz,
        r22 = m[10]! * isz;

    // Standard branch-by-largest-diagonal quaternion extraction.
    const trace = r00 + r11 + r22;
    let qx: number, qy: number, qz: number, qw: number;
    if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1);
        qw = 0.25 / s;
        qx = (r12 - r21) * s;
        qy = (r20 - r02) * s;
        qz = (r01 - r10) * s;
    } else if (r00 > r11 && r00 > r22) {
        const s = 2 * Math.sqrt(1 + r00 - r11 - r22);
        qw = (r12 - r21) / s;
        qx = 0.25 * s;
        qy = (r10 + r01) / s;
        qz = (r20 + r02) / s;
    } else if (r11 > r22) {
        const s = 2 * Math.sqrt(1 + r11 - r00 - r22);
        qw = (r20 - r02) / s;
        qx = (r10 + r01) / s;
        qy = 0.25 * s;
        qz = (r21 + r12) / s;
    } else {
        const s = 2 * Math.sqrt(1 + r22 - r00 - r11);
        qw = (r01 - r10) / s;
        qx = (r20 + r02) / s;
        qy = (r21 + r12) / s;
        qz = 0.25 * s;
    }
    outRotation[0] = qx;
    outRotation[1] = qy;
    outRotation[2] = qz;
    outRotation[3] = qw;
}
