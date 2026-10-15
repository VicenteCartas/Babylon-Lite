import type { NpeBlockEvaluator } from "./npe-build.js";

/** Shape table loaded only by emitter-local systems. */
export async function loadLocalShapeEvaluator(className: string): Promise<NpeBlockEvaluator> {
    switch (className) {
        case "BoxShapeBlock":
            return (await import("./blocks/box-shape-local-block.js")).evaluator;
        case "PointShapeBlock":
            return (await import("./blocks/point-shape-local-block.js")).evaluator;
        case "SphereShapeBlock":
            return (await import("./blocks/sphere-shape-local-block.js")).evaluator;
        case "ConeShapeBlock":
            return (await import("./blocks/cone-shape-local-block.js")).evaluator;
        case "CylinderShapeBlock":
            return (await import("./blocks/cylinder-shape-local-block.js")).evaluator;
        case "MeshShapeBlock":
            return (await import("./blocks/mesh-shape-local-block.js")).evaluator;
        default:
            throw new Error(`NodeParticle: unsupported local shape "${className}"`);
    }
}

export { loadLocalShapeEvaluator as load };
