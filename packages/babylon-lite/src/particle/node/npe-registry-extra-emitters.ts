import type { NpeBlockEvaluator } from "./npe-build.js";

/** Optional world-space emitter shapes beyond the base box. */
export async function loadEmitterBlockEvaluator(className: string): Promise<NpeBlockEvaluator> {
    switch (className) {
        case "PointShapeBlock":
            return (await import("./blocks/point-shape-block.js")).pointShapeBlock;
        case "SphereShapeBlock":
            return (await import("./blocks/sphere-shape-block.js")).sphereShapeBlock;
        default:
            return (await import("./npe-registry-extra-complex-emitters.js")).load(className);
    }
}

export { loadEmitterBlockEvaluator as load };
