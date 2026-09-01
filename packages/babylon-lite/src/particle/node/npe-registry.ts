import type { NpeBlockEvaluator } from "./npe-build.js";

const loadExtra = () => import("./npe-registry-extra.js");
const loadLifecycle = () => import("./npe-pack-lifecycle.js");
const loadStandardValues = () => import("./npe-pack-standard-values.js");

/**
 * Node-particle block registry — side-effect-free lazy dispatch.
 *
 * Base blocks are routed here. Optional feature families are routed through small extra registries so
 * adding feature blocks does not add their loader stubs to every particle scene. This mirrors NME's
 * `node-registry.ts` pattern; callers only provide a class name and never assemble a registry themselves.
 */
export async function loadNpeBlockEvaluator(className: string): Promise<NpeBlockEvaluator> {
    switch (className) {
        case "SystemBlock":
        case "CreateParticleBlock":
        case "UpdatePositionBlock":
        case "ParticleTextureSourceBlock":
            return (await loadLifecycle()).load(className);
        case "ParticleInputBlock":
        case "ParticleRandomBlock":
        case "ParticleMathBlock":
        case "ParticleLerpBlock":
        case "ParticleConverterBlock":
        case "UpdateColorBlock":
            return (await loadStandardValues()).load(className);
        case "BoxShapeBlock":
            return (await import("./blocks/box-shape-block.js")).evaluator;
        default:
            return className.endsWith("ShapeBlock") ? (await import("./npe-registry-extra-emitters.js")).load(className) : (await loadExtra()).load(className);
    }
}
