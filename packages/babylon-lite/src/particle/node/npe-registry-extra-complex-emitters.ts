import type { NpeBlockEvaluator } from "./npe-build.js";

/** Resolve less common world-space emitter shapes. */
export async function loadComplexEmitterBlockEvaluator(className: string): Promise<NpeBlockEvaluator> {
    switch (className) {
        case "ConeShapeBlock":
            return (await import("./blocks/cone-shape-block.js")).coneShapeBlock;
        case "CylinderShapeBlock":
            return (await import("./blocks/cylinder-shape-block.js")).cylinderShapeBlock;
        case "MeshShapeBlock":
            return (await import("./blocks/mesh-shape-block.js")).meshShapeBlock;
        default:
            throw new Error(`NodeParticle: unsupported emitter block "${className}"`);
    }
}

export { loadComplexEmitterBlockEvaluator as load };
