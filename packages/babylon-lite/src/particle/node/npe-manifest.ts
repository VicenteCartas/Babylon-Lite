import type { NpeBlockEvaluator } from "./npe-build.js";

/**
 * Node-particle block manifest — one lazy entry per supported Babylon.js block class.
 *
 * Each block module owns every serialized property and input form of its class; heavy optional paths are
 * block-local lazy imports, so the builder never routes on block properties. Adding a block adds one case.
 * Graph-plumbing classes (teleports, elbows, debug) are removed by `normalizeNodeParticleGraph` and are
 * intentionally absent.
 */
export async function loadNpeBlock(className: string): Promise<NpeBlockEvaluator> {
    switch (className) {
        case "SystemBlock":
            return (await import("./blocks/system-block.js")).systemBlock;
        case "CreateParticleBlock":
            return (await import("./blocks/create-particle-block.js")).createParticleBlock;
        case "BoxShapeBlock":
            return (await import("./blocks/box-shape-block.js")).boxShapeBlock;
        case "PointShapeBlock":
            return (await import("./blocks/point-shape-block.js")).pointShapeBlock;
        case "SphereShapeBlock":
            return (await import("./blocks/sphere-shape-block.js")).sphereShapeBlock;
        case "ConeShapeBlock":
            return (await import("./blocks/cone-shape-block.js")).coneShapeBlock;
        case "CylinderShapeBlock":
            return (await import("./blocks/cylinder-shape-block.js")).cylinderShapeBlock;
        case "MeshShapeBlock":
            return (await import("./blocks/mesh-shape-block.js")).meshShapeBlock;
        case "UpdatePositionBlock":
            return (await import("./blocks/update-position-block.js")).updatePositionBlock;
        case "UpdateColorBlock":
            return (await import("./blocks/update-color-block.js")).updateColorBlock;
        case "UpdateSizeBlock":
            return (await import("./blocks/update-size-block.js")).updateSizeBlock;
        case "UpdateDirectionBlock":
            return (await import("./blocks/update-direction-block.js")).updateDirectionBlock;
        case "UpdateAngleBlock":
            return (await import("./blocks/update-angle-block.js")).updateAngleBlock;
        case "UpdateAttractorBlock":
            return (await import("./blocks/update-attractor-block.js")).updateAttractorBlock;
        case "UpdateFlowMapBlock":
            return (await import("./blocks/update-flow-map-block.js")).updateFlowMapBlock;
        case "UpdateNoiseBlock":
            return (await import("./blocks/update-noise-block.js")).updateNoiseBlock;
        case "SetupSpriteSheetBlock":
            return (await import("./blocks/setup-sprite-sheet-block.js")).setupSpriteSheetBlock;
        case "BasicSpriteUpdateBlock":
            return (await import("./blocks/basic-sprite-update-block.js")).basicSpriteUpdateBlock;
        case "ParticleTextureSourceBlock":
            return (await import("./blocks/texture-source-block.js")).particleTextureSourceBlock;
        case "ParticleInputBlock":
            return (await import("./blocks/particle-input-block.js")).particleInputBlock;
        case "ParticleMathBlock":
            return (await import("./blocks/particle-math-block.js")).particleMathBlock;
        case "ParticleLerpBlock":
            return (await import("./blocks/particle-lerp-block.js")).particleLerpBlock;
        case "ParticleConverterBlock":
            return (await import("./blocks/particle-converter-block.js")).particleConverterBlock;
        case "ParticleRandomBlock":
            return (await import("./blocks/particle-random-block.js")).particleRandomBlock;
        case "ParticleGradientBlock":
            return (await import("./blocks/particle-gradient-block.js")).particleGradientBlock;
        case "ParticleGradientValueBlock":
            return (await import("./blocks/particle-gradient-value-block.js")).particleGradientValueBlock;
        case "ParticleConditionBlock":
            return (await import("./blocks/particle-condition-block.js")).particleConditionBlock;
        case "ParticleFloatToIntBlock":
            return (await import("./blocks/particle-float-to-int-block.js")).particleFloatToIntBlock;
        case "ParticleVectorLengthBlock":
            return (await import("./blocks/particle-vector-length-block.js")).particleVectorLengthBlock;
        case "ParticleLocalVariableBlock":
            return (await import("./blocks/particle-local-variable-block.js")).particleLocalVariableBlock;
        default:
            throw new Error(`NodeParticle: unsupported block "${className}"`);
    }
}
